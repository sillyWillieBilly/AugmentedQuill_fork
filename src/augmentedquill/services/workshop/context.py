# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Build the exact read-only message set sent to the Workshop model."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from augmentedquill.core.prompts import get_system_message
from augmentedquill.models.workshop import (
    WorkshopBudgetEstimate,
    WorkshopContextBudget,
    WorkshopEditorSnapshot,
    WorkshopInspectorMessage,
    WorkshopMessage,
    WorkshopTargetSnapshot,
)
from augmentedquill.services.exceptions import BadRequestError
from augmentedquill.services.workshop.editor_context import live_editor_context
from augmentedquill.services.workshop.readonly import LoreSelection, select_lore

# Keep Workshop request construction bounded even when a provider advertises a
# very large context window.  The configured model limit remains separately
# visible in the inspector and is still enforced as the outer safety check.
_MAX_WORKSHOP_INPUT_TOKENS = 32_768


@dataclass(frozen=True)
class WorkshopPrompt:
    """Provider messages and their context accounting."""

    messages: list[dict[str, str]]
    inspector_messages: list[WorkshopInspectorMessage]
    lore: LoreSelection
    budget: WorkshopBudgetEstimate
    warnings: list[str]


def _model_context_tokens(machine: dict[str, Any], selected_name: str | None) -> int:
    """Read a configured context window, with a bounded local fallback."""
    models: list[dict[str, Any]] = []
    for provider in ("openai", "anthropic", "google"):
        cfg = machine.get(provider)
        if not isinstance(cfg, dict) or not isinstance(cfg.get("models"), list):
            continue
        models.extend(item for item in cfg["models"] if isinstance(item, dict))

    chosen = next(
        (
            item
            for item in models
            if selected_name and item.get("name") == selected_name
        ),
        None,
    )
    if chosen is None and models:
        chosen = models[0]
    if isinstance(chosen, dict):
        for key in (
            # This is the canonical persisted settings field.  Keep it ahead
            # of legacy aliases so the inspector reflects the value shown in
            # the provider settings UI (including large local-model windows).
            "context_window_tokens",
            "context_length",
            "context_window",
            "context_size",
            "n_ctx",
            "max_context_tokens",
        ):
            try:
                value = int(chosen.get(key))
            except (TypeError, ValueError):
                continue
            # The persisted canonical field follows machine.schema.json's
            # 2048-token minimum.  Keep the older aliases' previous 256-token
            # lower bound for compatible test fixtures and legacy callers.
            minimum = 2_048 if key == "context_window_tokens" else 256
            if value >= minimum:
                return value
    # A fixed fallback preserves a finite budget when model metadata is absent.
    return 8_192


def _estimate_tokens(value: str) -> int:
    """Estimate tokens from UTF-8 bytes for deterministic safety accounting.

    This is a bounded planning estimate rather than a provider tokenizer.  A
    byte-based unit leaves room for non-ASCII prose and JSON punctuation while
    keeping the result reproducible for the inspector.
    """
    if not value:
        return 0
    return (len(value.encode("utf-8")) + 2) // 3


def _estimate_messages(messages: list[dict[str, str]]) -> int:
    """Estimate message tokens including a small per-message framing cost."""
    # The framing allowance is explicit so raw text size cannot consume the
    # complete model input window.
    return 2 + sum(_estimate_tokens(message["content"]) + 4 for message in messages)


def _fit_optional(
    value: str,
    *,
    max_chars: int,
    max_tokens: int,
    label: str,
    warnings: list[str],
) -> str:
    """Fit optional context without cutting a mandatory JSON block."""
    if not value:
        return ""
    if max_chars <= 0 or max_tokens <= 0:
        warnings.append(f"{label} omitted because the context budget is exhausted")
        return ""

    candidate = value[:max_chars]
    changed = len(candidate) != len(value)
    if _estimate_tokens(candidate) > max_tokens:
        # Find the longest code-point prefix that satisfies the byte estimate;
        # optional prose may be shortened, while the exact target and lore JSON
        # use a separate mandatory path below.
        low, high = 0, len(candidate)
        while low < high:
            middle = (low + high + 1) // 2
            if _estimate_tokens(candidate[:middle]) <= max_tokens:
                low = middle
            else:
                high = middle - 1
        candidate = candidate[:low]
        changed = True
    if not candidate:
        warnings.append(f"{label} omitted because the context budget is exhausted")
        return ""
    if changed:
        warnings.append(f"{label} truncated to {len(candidate)} characters")
    return candidate


def _target_context(
    target: WorkshopTargetSnapshot,
    story: dict[str, Any],
    *,
    author_viewpoint: str | None,
    timeline: str | None,
    timeline_position: int | None,
    lore: LoreSelection,
    context_chars: int,
    context_tokens: int,
    include_optional: bool = True,
    warnings: list[str],
    editor_context: str = "",
) -> str:
    """Format target and read-only story/lore material for the model.

    The selected passage and serialized lore are mandatory.  They are checked
    as complete units before optional overview and neighboring prose are
    added, so neither an exact target nor a JSON record can be clipped in
    half.
    """
    project_title = str(story.get("project_title") or "")
    story_summary = str(story.get("story_summary") or "")
    tags = story.get("tags")
    tags_text = ", ".join(str(tag) for tag in tags) if isinstance(tags, list) else ""
    overview = "\n".join(
        item
        for item in (
            f"Project: {project_title}" if project_title else "",
            f"Story summary: {story_summary}" if story_summary else "",
            f"Story tags: {tags_text}" if tags_text else "",
        )
    )
    metadata_lines = [
        f"Scope: {target.scope}",
        f"Chapter: {target.chapter_title}" if target.chapter_title else "",
        f"Scene: {target.scene_id}" if target.scene_id else "",
    ]
    if author_viewpoint:
        metadata_lines.append(f"Author viewpoint: {author_viewpoint}")
    if timeline:
        metadata_lines.append(f"Timeline: {timeline}")
    if timeline_position is not None:
        metadata_lines.append(f"Timeline position: {timeline_position}")
    lore_text = json.dumps(
        lore.selected, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    mandatory = "\n\n".join(
        (
            f"Pinned passage (exact proposal target):\n{target.original_text}",
            f"Selected lore (read-only):\n{lore_text}",
            editor_context,
        )
    )
    if len(mandatory) > context_chars:
        raise BadRequestError(
            "The exact selected passage and complete lore JSON require "
            f"{len(mandatory)} context characters, exceeding max_context_chars="
            f"{context_chars}; increase the Workshop context cap."
        )
    mandatory_tokens = _estimate_tokens(mandatory)
    if mandatory_tokens > context_tokens:
        raise BadRequestError(
            "The exact selected passage and complete lore JSON require an "
            f"estimated {mandatory_tokens} input tokens, exceeding the available "
            f"Workshop context budget of {context_tokens}; increase the context "
            "budget or reduce the selected lore."
        )
    if not include_optional:
        return mandatory

    parts = [overview, *metadata_lines]
    parts.extend(
        (
            f"Before passage:\n{target.context_before}",
            f"After passage:\n{target.context_after}",
        )
    )
    material = mandatory
    used_chars = len(material)
    used_tokens = mandatory_tokens
    for index, part in enumerate(item for item in parts if item):
        separator = "\n\n"
        remaining_chars = context_chars - used_chars - len(separator)
        remaining_tokens = context_tokens - used_tokens - _estimate_tokens(separator)
        fitted = _fit_optional(
            part,
            max_chars=remaining_chars,
            max_tokens=remaining_tokens,
            label=(
                "story overview" if index == 0 and overview else "target context detail"
            ),
            warnings=warnings,
        )
        if not fitted:
            continue
        material = f"{material}{separator}{fitted}"
        used_chars = len(material)
        used_tokens = _estimate_tokens(material)
    return material


def build_workshop_prompt(
    *,
    target: WorkshopTargetSnapshot,
    story: dict[str, Any],
    machine: dict[str, Any],
    selected_model_name: str | None,
    model_overrides: dict[str, str] | None,
    history: list[WorkshopMessage],
    author_viewpoint: str | None,
    timeline: str | None,
    timeline_position: int | None,
    lore_query: str | None,
    project_dir: Any,
    budget: WorkshopContextBudget,
    editor_context: WorkshopEditorSnapshot | None = None,
) -> WorkshopPrompt:
    """Build bounded provider messages and the exact inspector copy."""
    warnings: list[str] = []
    editor_text = live_editor_context(editor_context, target)
    usable_history = [message for message in history if message.role != "system"]
    # The current author request is mandatory, even when prior history is
    # disabled. Reserve it before optional context so a long summary cannot
    # turn a cursor question into an unsolicited critique of the pinned text.
    latest_author = (
        usable_history.pop().content
        if usable_history and usable_history[-1].role == "user"
        else ""
    )
    current_user_suffix = (
        f"\n\nAuthor's latest message (answer this):\n{latest_author}"
        if latest_author
        else ""
    )
    configured_context = _model_context_tokens(machine, selected_model_name)
    output_reserve = budget.output_tokens
    if output_reserve >= configured_context:
        raise BadRequestError(
            "The configured model context window is smaller than the requested "
            "Workshop output reserve."
        )
    model_input_capacity = configured_context - output_reserve
    available_context = min(model_input_capacity, _MAX_WORKSHOP_INPUT_TOKENS)
    if model_input_capacity > _MAX_WORKSHOP_INPUT_TOKENS:
        warnings.append(
            "Workshop input allocation capped at "
            f"{_MAX_WORKSHOP_INPUT_TOKENS} estimated tokens; the configured "
            f"model context limit is {configured_context} tokens."
        )
    if budget.context_tokens is not None:
        available_context = min(available_context, budget.context_tokens)
    if available_context <= 0:
        raise BadRequestError(
            "The configured Workshop model has no input capacity after reserving "
            f"{output_reserve} output tokens."
        )

    system = get_system_message(
        "workshop_discussion",
        model_overrides=model_overrides,
        language=target.language,
    )
    if not system:
        system = (
            "You are a non-mutating manuscript workshop assistant. "
            "Return only the requested JSON object and never call tools."
        )

    current_user_prefix = (
        "Reference context for the author's latest message. Answer that message "
        "directly using the live editor context when relevant. The pinned passage "
        "and its lore remain the target for replacement proposals.\n\n"
    )
    target_chars_limit = budget.max_context_chars - len(current_user_prefix)
    if target_chars_limit <= 0:
        raise BadRequestError(
            "max_context_chars is too small to include the Workshop request "
            "prefix and the exact selected passage."
        )

    # Establish the minimum user message first.  The system instruction is a
    # mandatory safety boundary, so it must remain whole.  This early check
    # produces a useful request error before lore selection or optional context
    # work when even the exact target cannot fit beside it.
    minimum_target = _target_context(
        target,
        story,
        author_viewpoint=author_viewpoint,
        timeline=timeline,
        timeline_position=timeline_position,
        lore=LoreSelection(
            selected=[],
            excluded=[],
            decisions=[],
            unsupported_options=[],
            serialized_chars=0,
            warnings=[],
            estimated_tokens=0,
        ),
        context_chars=target_chars_limit,
        context_tokens=available_context,
        include_optional=False,
        warnings=warnings,
        editor_context=editor_text,
    )
    system_token_limit = (
        available_context
        - _estimate_tokens(current_user_prefix + minimum_target + current_user_suffix)
        - 10
    )
    if latest_author and system_token_limit < _estimate_tokens(system):
        raise BadRequestError(
            "The exact latest author message cannot fit alongside the complete "
            "Workshop instructions, pinned passage and live editor context; "
            "shorten the message or increase the context budget."
        )
    if system_token_limit <= 0:
        raise BadRequestError(
            "The complete Workshop system instructions and exact selected passage "
            "cannot fit after reserving "
            f"{output_reserve} output tokens (available input budget: "
            f"{available_context} estimated tokens); reduce the passage/context "
            "or choose a model with a larger context window."
        )
    if _estimate_tokens(system) > system_token_limit:
        raise BadRequestError(
            "The complete Workshop system instructions cannot fit alongside the "
            "exact selected passage within the requested context budget; reduce "
            "the configured prompt override or choose a model with a larger "
            "context window."
        )

    # Keep the newest bounded turns, preserving their order.  System messages
    # are forbidden as caller history so the internal system instruction cannot
    # be overridden by request data.
    if budget.max_history_messages == 0:
        if usable_history:
            warnings.append("history disabled by the context budget")
        usable_history = []
    elif len(usable_history) > budget.max_history_messages:
        warnings.append(
            f"history capped at {budget.max_history_messages} messages; older turns omitted"
        )
        usable_history = usable_history[-budget.max_history_messages :]
    lore = select_lore(
        project_dir,
        story,
        target,
        query=lore_query,
        budget=budget,
        viewpoint=author_viewpoint,
        timeline=timeline,
        timeline_position=timeline_position,
    )
    warnings.extend(lore.warnings)
    target_token_budget = (
        available_context
        - _estimate_tokens(system)
        - _estimate_tokens(current_user_prefix + current_user_suffix)
        - 10
    )
    target_text = _target_context(
        target,
        story,
        author_viewpoint=author_viewpoint,
        timeline=timeline,
        timeline_position=timeline_position,
        lore=lore,
        context_chars=target_chars_limit,
        context_tokens=target_token_budget,
        warnings=warnings,
        editor_context=editor_text,
    )
    current_user = {
        "role": "user",
        "content": current_user_prefix + target_text + current_user_suffix,
    }
    base_messages = [{"role": "system", "content": system}, current_user]
    history_newest: list[dict[str, str]] = []
    for message in reversed(usable_history):
        trial_messages = [
            base_messages[0],
            *history_newest,
            current_user,
        ]
        remaining = available_context - _estimate_messages(trial_messages)
        if remaining <= 4:
            warnings.append("history omitted because the context budget is exhausted")
            continue
        clipped = _fit_optional(
            message.content,
            max_chars=min(8_000, budget.max_context_chars),
            max_tokens=remaining - 4,
            label="history message",
            warnings=warnings,
        )
        if not clipped:
            continue
        candidate = {"role": message.role, "content": clipped}
        candidate_messages = [
            base_messages[0],
            candidate,
            *history_newest,
            current_user,
        ]
        if _estimate_messages(candidate_messages) > available_context:
            warnings.append(
                "history message omitted because the context budget is exhausted"
            )
            continue
        history_newest.append(candidate)
    history_dicts = list(reversed(history_newest))
    messages = [{"role": "system", "content": system}, *history_dicts, current_user]
    inspector = [
        WorkshopInspectorMessage.model_validate(message) for message in messages
    ]
    target_chars = len(target_text)
    history_chars = sum(len(message["content"]) for message in history_dicts)
    total_chars = sum(len(message["content"]) for message in messages)
    prompt_tokens = _estimate_messages(messages)
    if prompt_tokens > available_context:
        raise BadRequestError(
            "The final Workshop messages exceed the requested input context "
            f"budget ({prompt_tokens} estimated tokens > {available_context})."
        )
    if prompt_tokens + output_reserve > configured_context:
        raise BadRequestError(
            "The final Workshop prompt plus output reserve exceeds the configured "
            f"model context ({prompt_tokens} + {output_reserve} > {configured_context})."
        )
    if budget.context_tokens is not None and prompt_tokens > budget.context_tokens:
        raise BadRequestError(
            "The final Workshop prompt exceeds the requested context cap "
            f"({prompt_tokens} estimated tokens > {budget.context_tokens})."
        )
    budget_estimate = WorkshopBudgetEstimate(
        system_chars=len(system),
        history_chars=history_chars,
        target_chars=target_chars,
        lore_chars=lore.serialized_chars,
        total_chars=total_chars,
        context_limit_tokens=configured_context,
        context_budget_tokens=available_context,
        estimated_prompt_tokens=prompt_tokens,
        output_reserve_tokens=output_reserve,
        output_tokens=output_reserve,
    )
    return WorkshopPrompt(
        messages=messages,
        inspector_messages=inspector,
        lore=lore,
        budget=budget_estimate,
        warnings=warnings,
    )
