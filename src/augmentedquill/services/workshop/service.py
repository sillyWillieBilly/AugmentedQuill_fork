# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Non-mutating Workshop orchestration and model-output validation."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
from typing import Any
from uuid import uuid4

import httpx

from augmentedquill.core.config import load_machine_config
from augmentedquill.core.prompts import load_model_prompt_overrides
from augmentedquill.models.workshop import (
    WorkshopAlternative,
    WorkshopContextInspector,
    WorkshopDiscussRequest,
    WorkshopDiscussResponse,
)
from augmentedquill.services.exceptions import (
    BadRequestError,
    ConfigurationError,
    ServiceError,
    UpstreamError,
)
from augmentedquill.services.llm import llm
from augmentedquill.services.llm.llm import resolve_openai_credentials
from augmentedquill.services.workshop.context import build_workshop_prompt
from augmentedquill.services.workshop.readonly import (
    ReadonlyContextError,
    load_story_json_readonly,
)
from augmentedquill.utils.json_repair import try_parse_json_robust
from augmentedquill.utils.llm_parsing import parse_tool_calls_from_content

_INTERNAL_MARKER_RE = re.compile(
    r"<!--\s*(?:scene|annotation):[^>]+-->", flags=re.IGNORECASE
)
_MAX_ALTERNATIVES = 8
_MAX_DISCUSSION_CHARS = 100_000
# Leave room for the frontend's decision map when it serializes an assistant
# response into the next request's history message.
_MAX_SERIALIZED_TURN_CHARS = 96_000
_DEFAULT_WORKSHOP_TIMEOUT_S = 60.0


class WorkshopTargetConflict(BadRequestError):
    """Raised when the immutable target snapshot is internally inconsistent."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail, status_code=409)


class WorkshopOutputError(UpstreamError):
    """Raised when a provider returns unsafe or malformed Workshop output."""


def _workshop_timeout_seconds(value: Any) -> float:
    """Return a finite positive provider deadline for one Workshop request.

    ``resolve_openai_credentials`` normally returns an integer, but keeping the
    boundary defensive prevents malformed machine settings or test adapters
    from turning the request into an immediate timeout or an unbounded wait.
    """
    if isinstance(value, bool):
        return _DEFAULT_WORKSHOP_TIMEOUT_S
    try:
        timeout = float(value)
    except (TypeError, ValueError):
        return _DEFAULT_WORKSHOP_TIMEOUT_S
    if not math.isfinite(timeout) or timeout <= 0:
        return _DEFAULT_WORKSHOP_TIMEOUT_S
    return timeout


def _utf16_length(value: str) -> int:
    """Return JavaScript's UTF-16 code-unit length for *value*."""
    return len(value.encode("utf-16-le")) // 2


def _utf16_to_index(value: str, offset: int, field_name: str) -> int:
    """Convert a UTF-16 boundary to a Python code-point boundary.

    Splitting a surrogate pair is rejected rather than silently corrupting an
    emoji or another astral character.
    """
    if offset < 0 or offset > _utf16_length(value):
        raise WorkshopTargetConflict(f"{field_name} is outside the target text")
    position = 0
    for index, character in enumerate(value):
        if offset == position:
            return index
        next_position = position + (2 if ord(character) > 0xFFFF else 1)
        if position < offset < next_position:
            raise WorkshopTargetConflict(f"{field_name} splits a UTF-16 surrogate pair")
        position = next_position
    return len(value)


def _strip_internal_markers(value: str) -> str:
    """Match the frontend's marker-stripped target view for validation."""
    return _INTERNAL_MARKER_RE.sub("", value)


def _validate_document_key(document_key: str) -> None:
    """Reject path-like keys that could be mistaken for filesystem input."""
    if "\x00" in document_key or document_key.startswith(("/", "\\")):
        raise WorkshopTargetConflict("document_key is not a project-relative key")
    if any(part == ".." for part in re.split(r"[/\\:]", document_key)):
        raise WorkshopTargetConflict("document_key cannot contain parent traversal")


def validate_target(request: WorkshopDiscussRequest, project_name: str) -> None:
    """Validate exact target ranges, identity, and SHA-256 before model work."""
    target = request.target
    if target.project_id != project_name:
        raise WorkshopTargetConflict(
            "The target belongs to a different project than the request route"
        )
    _validate_document_key(target.document_key)
    if target.from_offset > target.to_offset:
        raise BadRequestError("Target visible range has reversed boundaries")
    if target.raw_from > target.raw_to:
        raise BadRequestError("Target raw range has reversed boundaries")

    actual_fingerprint = hashlib.sha256(target.content.encode("utf-8")).hexdigest()
    if actual_fingerprint.casefold() != target.fingerprint.casefold():
        raise WorkshopTargetConflict("Target fingerprint does not match its content")

    visible = _strip_internal_markers(target.content)
    visible_from = _utf16_to_index(visible, target.from_offset, "from")
    visible_to = _utf16_to_index(visible, target.to_offset, "to")
    raw_from = _utf16_to_index(target.content, target.raw_from, "rawFrom")
    raw_to = _utf16_to_index(target.content, target.raw_to, "rawTo")
    if visible_from > visible_to or raw_from > raw_to:
        raise BadRequestError("Target range has reversed boundaries")
    if visible[visible_from:visible_to] != target.original_text:
        raise WorkshopTargetConflict(
            "Target visible range no longer contains the captured original text"
        )
    if _strip_internal_markers(target.content[raw_from:raw_to]) != target.original_text:
        raise WorkshopTargetConflict(
            "Target raw range no longer maps to the captured original text"
        )


def _parse_alternatives(payload: Any) -> list[WorkshopAlternative]:
    """Validate structured alternatives and reject marker-bearing replacements."""
    if not isinstance(payload, list) or len(payload) > _MAX_ALTERNATIVES:
        raise WorkshopOutputError(
            f"Model alternatives must be an array of at most {_MAX_ALTERNATIVES} items"
        )
    alternatives: list[WorkshopAlternative] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise WorkshopOutputError("Each Workshop alternative must be an object")
        identifier = item.get("id")
        label = item.get("label")
        replacement = item.get("replacement")
        # IDs are application metadata, not creative output. Providers often
        # number alternatives with integers or omit their IDs entirely.
        if not isinstance(identifier, str) or not identifier.strip():
            identifier = f"alternative-{index}-{uuid4().hex[:12]}"
        if not isinstance(label, str) or not label.strip():
            raise WorkshopOutputError(
                "Each Workshop alternative needs a non-empty label"
            )
        if not isinstance(replacement, str):
            raise WorkshopOutputError(
                "Each Workshop alternative needs a string replacement"
            )
        identifier = identifier.strip()
        if identifier in seen_ids:
            identifier = f"alternative-{index}-{uuid4().hex[:12]}"
        if _INTERNAL_MARKER_RE.search(replacement):
            raise WorkshopOutputError(
                "Workshop replacements cannot introduce scene or annotation markers"
            )
        if len(replacement) > 100_000:
            raise WorkshopOutputError("Workshop replacement exceeds the size limit")
        seen_ids.add(identifier)
        alternatives.append(
            WorkshopAlternative(
                id=identifier,
                label=label.strip(),
                replacement=replacement,
            )
        )
    return alternatives


def _parse_model_output(result: Any) -> tuple[str, list[WorkshopAlternative]]:
    """Parse a strict JSON response and reject any tool-call channel."""
    if not isinstance(result, dict):
        raise WorkshopOutputError("Model returned no structured Workshop response")
    tool_calls = result.get("tool_calls")
    if tool_calls:
        raise WorkshopOutputError("Workshop models are not permitted to call tools")
    raw = result.get("raw")
    if isinstance(raw, dict):
        choices = raw.get("choices")
        if isinstance(choices, list) and any(
            isinstance(choice, dict)
            and isinstance(choice.get("message"), dict)
            and choice["message"].get("tool_calls")
            for choice in choices
        ):
            raise WorkshopOutputError("Workshop models are not permitted to call tools")
    content = result.get("content")
    if not isinstance(content, str) or not content.strip():
        raise WorkshopOutputError("Model returned an empty Workshop response")
    if parse_tool_calls_from_content(content):
        raise WorkshopOutputError("Workshop models are not permitted to call tools")
    try:
        parsed = try_parse_json_robust(content)
    except Exception as exc:
        raise WorkshopOutputError("Model returned malformed Workshop JSON") from exc
    if not isinstance(parsed, dict):
        raise WorkshopOutputError("Workshop response must be a JSON object")
    if parsed.get("tool_calls"):
        raise WorkshopOutputError("Workshop models are not permitted to call tools")
    discussion = parsed.get("discussion")
    if not isinstance(discussion, str) or not discussion.strip():
        raise WorkshopOutputError("Workshop response needs a discussion string")
    if len(discussion) > _MAX_DISCUSSION_CHARS:
        raise WorkshopOutputError("Workshop discussion exceeds the size limit")
    alternatives = _parse_alternatives(parsed.get("alternatives"))
    serialized_turn = json.dumps(
        {
            "discussion": discussion,
            "alternatives": [item.model_dump(mode="json") for item in alternatives],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    if len(serialized_turn) > _MAX_SERIALIZED_TURN_CHARS:
        raise WorkshopOutputError(
            "Workshop response is too large to retain as a bounded conversation turn"
        )
    return discussion, alternatives


async def discuss_workshop(
    project_dir: Any,
    request: WorkshopDiscussRequest,
) -> WorkshopDiscussResponse:
    """Discuss a checked snapshot without writing any project state."""
    project_name = getattr(project_dir, "name", "")
    validate_target(request, str(project_name))
    if any(message.role == "system" for message in request.messages):
        raise BadRequestError(
            "Workshop history may contain only user and assistant messages"
        )
    try:
        story = load_story_json_readonly(project_dir)
    except ReadonlyContextError as exc:
        raise BadRequestError(str(exc)) from exc

    # Resolve only configured model names.  The request has no provider URL,
    # credentials, tools, or arbitrary extra body fields by design.
    machine = load_machine_config() or {}
    try:
        base_url, api_key, model_id, timeout_s, selected_name = (
            resolve_openai_credentials(
                {"model_name": request.model_name} if request.model_name else {},
                request.model_type,
            )
        )
    except ConfigurationError:
        raise
    except ServiceError:
        raise
    except Exception as exc:
        raise ConfigurationError(
            "Unable to resolve the configured Workshop model"
        ) from exc

    try:
        prompt = build_workshop_prompt(
            target=request.target,
            story=story,
            machine=machine,
            selected_model_name=selected_name,
            model_overrides=load_model_prompt_overrides(machine, selected_name),
            history=request.messages,
            author_viewpoint=request.author_viewpoint,
            timeline=request.timeline,
            timeline_position=request.timeline_position,
            lore_query=request.lore_query,
            project_dir=project_dir,
            budget=request.budget,
        )
    except ReadonlyContextError as exc:
        raise BadRequestError(str(exc)) from exc
    deadline_s = _workshop_timeout_seconds(timeout_s)
    try:
        result = await asyncio.wait_for(
            llm.unified_chat_complete(
                caller_id="api.workshop.discuss",
                model_type=request.model_type,
                messages=prompt.messages,
                base_url=base_url,
                api_key=api_key,
                model_id=model_id,
                timeout_s=deadline_s,
                model_name=selected_name,
                supports_function_calling=False,
                tools=None,
                tool_choice=None,
                temperature=0.35,
                max_tokens=request.budget.output_tokens,
                extra_body=None,
                skip_validation=False,
            ),
            timeout=deadline_s,
        )
    except asyncio.CancelledError:
        # Client disconnect cancellation must reach the provider task.  Do not
        # turn it into a synthetic Workshop error or allow a write path to run.
        raise
    except TimeoutError as exc:
        raise WorkshopOutputError(
            f"Workshop model request timed out after {deadline_s:g} seconds; "
            "retry or increase the configured model timeout"
        ) from exc
    except ConfigurationError:
        raise
    except ServiceError:
        raise
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        if status_code is None:
            detail = "Workshop model returned an HTTP error"
        else:
            detail = f"Workshop model returned HTTP status {status_code}"
        raise WorkshopOutputError(detail) from exc
    except httpx.TimeoutException as exc:
        raise WorkshopOutputError(
            "Workshop model provider timed out before completing the request; "
            "retry or increase the configured model timeout"
        ) from exc
    except httpx.RequestError as exc:
        raise WorkshopOutputError(
            "Workshop model connection failed; verify the configured provider and retry"
        ) from exc
    except ValueError as exc:
        raise ConfigurationError(
            "Workshop model configuration is invalid; check the selected provider"
        ) from exc
    except Exception as exc:
        # Keep unexpected provider/client failures actionable without exposing
        # credentials or an arbitrary upstream response body.
        raise WorkshopOutputError("Workshop model request failed unexpectedly") from exc

    discussion, alternatives = _parse_model_output(result)
    target_id = request.target.id or f"target-{request.target.fingerprint[:16]}"
    inspector = WorkshopContextInspector(
        messages=prompt.inspector_messages,
        selected_lore=prompt.lore.selected,
        excluded_lore=prompt.lore.excluded,
        lore_decisions=prompt.lore.decisions,
        unsupported_options=prompt.lore.unsupported_options,
        budget=prompt.budget,
        warnings=prompt.warnings,
    )
    return WorkshopDiscussResponse(
        discussion=discussion,
        alternatives=alternatives,
        target_id=target_id,
        fingerprint=request.target.fingerprint.lower(),
        context=inspector,
    )
