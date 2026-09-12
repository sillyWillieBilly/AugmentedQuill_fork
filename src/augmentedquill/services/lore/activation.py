# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Deterministic, inspectable lore activation.

This module implements a small pure subset of SillyTavern World Info.  It does
not import or execute SillyTavern code: browser state, random probability
rolls, chat-index timed effects, and prompt insertion positions are deliberately
outside this service's contract.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Sequence
from copy import deepcopy
from pathlib import Path
from typing import Any

from augmentedquill.services.lore.models import (
    LoreActivation,
    LoreDecision,
    LoreEntry,
    LoreScope,
    LoreSelectionResult,
    LoreStatus,
)
from augmentedquill.services.lore.storage import (
    list_world_info_books,
    read_world_info,
    unsupported_world_info_options,
)

_CATEGORY_TO_KIND = {
    "character": "character",
    "location": "location",
    "organization": "organization",
    "item": "object",
    "event": "event",
    "lore": "rule",
    "time travel": "event",
}


def estimate_lore_tokens(text: str) -> int:
    """Return a deliberately labelled, deterministic token estimate.

    The exact model tokenizer is not available to this pure service.  Four
    UTF-8 characters per token is useful for budget inspection while callers
    must continue to present this value as an estimate.
    """

    return max(1, math.ceil(len(text) / 4)) if text else 0


def _scope_from_metadata(metadata: dict[str, Any]) -> LoreScope:
    raw_scope = metadata.get("scope")
    if isinstance(raw_scope, dict):
        try:
            return LoreScope.model_validate(raw_scope)
        except Exception:
            pass
    return LoreScope()


def _activation_from_metadata(
    metadata: dict[str, Any], *, name: str, aliases: list[str], keywords: list[str]
) -> LoreActivation:
    raw_activation = metadata.get("activation")
    payload = dict(raw_activation) if isinstance(raw_activation, dict) else {}
    if not payload.get("primary_keys"):
        payload["primary_keys"] = [name, *aliases, *keywords]
    try:
        return LoreActivation.model_validate(payload)
    except Exception:
        return LoreActivation(primary_keys=[name, *aliases, *keywords])


def _status_from_metadata(metadata: dict[str, Any]) -> LoreStatus:
    try:
        return LoreStatus(str(metadata.get("status", LoreStatus.CANON.value)))
    except ValueError:
        return LoreStatus.CANON


def _native_relations(name: str, story: dict[str, Any]) -> list[dict[str, Any]]:
    """Return both directed views of existing Sourcebook relations."""

    output: list[dict[str, Any]] = []
    for relation in story.get("sourcebook_relations") or []:
        if not isinstance(relation, dict):
            continue
        if relation.get("source_id") == name:
            value = dict(relation)
            value["target_id"] = value.pop("target_id", "")
            value.pop("source_id", None)
            value["direction"] = "forward"
            output.append(value)
        elif relation.get("target_id") == name:
            value = dict(relation)
            value["target_id"] = value.pop("source_id", "")
            value.pop("source_id", None)
            value["direction"] = "reverse"
            output.append(value)
    return output


def native_lore_entries(project_dir: Path) -> list[LoreEntry]:
    """Read native Sourcebook entries without changing project state."""

    # ``load_story_config`` may run migrations.  Selection is deliberately
    # read-only, so use a raw JSON read here and leave normalization/migration
    # to explicit project persistence paths.
    try:
        story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return []
    if not isinstance(story, dict):
        return []
    sourcebook = story.get("sourcebook")
    if isinstance(sourcebook, list):
        sourcebook = {
            str(item.get("name")): item
            for item in sourcebook
            if isinstance(item, dict) and isinstance(item.get("name"), str)
        }
    if not isinstance(sourcebook, dict):
        return []

    output: list[LoreEntry] = []
    for name in sorted(sourcebook, key=str.casefold):
        value = sourcebook.get(name)
        if not isinstance(value, dict):
            continue
        metadata = value.get("_lore")
        metadata = dict(metadata) if isinstance(metadata, dict) else {}
        aliases = _string_values(value.get("synonyms", []))
        keywords = _string_values(value.get("keywords", []))
        entry_id = str(metadata.get("entry_id") or f"sourcebook:{name}")
        unknown = {
            key: deepcopy(item)
            for key, item in value.items()
            if key
            not in {
                "description",
                "category",
                "synonyms",
                "images",
                "keywords",
                "origin_date",
                "destination_datetime",
                "destination_relative",
                "creates_new_timeline",
                "timeline_id",
                "_lore",
            }
        }
        output.append(
            LoreEntry(
                id=entry_id,
                name=str(name),
                kind=_CATEGORY_TO_KIND.get(
                    str(value.get("category", "other")).lower(), "other"
                ),
                status=_status_from_metadata(metadata),
                description=str(value.get("description") or ""),
                aliases=aliases,
                relations=_native_relations(str(name), story),
                sources=(
                    list(metadata.get("sources") or [])
                    if isinstance(metadata.get("sources"), list)
                    else []
                ),
                scope=_scope_from_metadata(metadata),
                activation=_activation_from_metadata(
                    metadata, name=str(name), aliases=aliases, keywords=keywords
                ),
                belief_actor=(
                    str(metadata["belief_actor"])
                    if metadata.get("belief_actor") is not None
                    else None
                ),
                raw_record=deepcopy(value),
                raw_fields=unknown,
            )
        )
    return output


def _string_values(value: object) -> list[str]:
    """Normalize a World Info or Sourcebook string/list field safely."""

    if isinstance(value, str):
        values = [value]
    elif isinstance(value, (list, tuple)):
        values = list(value)
    else:
        values = []
    return [item.strip() for item in values if isinstance(item, str) and item.strip()]


def _st_entry_to_lore(book_name: str, uid: str, raw: dict[str, Any]) -> LoreEntry:
    extensions = (
        raw.get("extensions") if isinstance(raw.get("extensions"), dict) else {}
    )
    aq_meta = extensions.get("augmentedquill")
    if not isinstance(aq_meta, dict):
        aq_meta = (
            raw.get("_augmentedquill")
            if isinstance(raw.get("_augmentedquill"), dict)
            else {}
        )
    keys = _string_values(raw.get("key", raw.get("keys", [])))
    secondary = _string_values(raw.get("keysecondary", raw.get("secondary_keys", [])))
    name = str(
        raw.get("name")
        or raw.get("comment")
        or (keys[0] if keys else f"{book_name}:{uid}")
    )
    enabled = (
        raw.get("enabled")
        if isinstance(raw.get("enabled"), bool)
        else not bool(raw.get("disable", False))
    )
    activation_payload: dict[str, Any] = {
        "enabled": enabled,
        "constant": bool(raw.get("constant", False)),
        "primary_keys": keys,
        "secondary_keys": secondary,
        "selective_logic": raw.get(
            "selectiveLogic",
            extensions.get("selectiveLogic", extensions.get("selective_logic", 0)),
        ),
        "order": raw.get("order", raw.get("insertion_order", 100)),
        "prevent_recursion": bool(
            raw.get("preventRecursion", extensions.get("prevent_recursion", False))
        ),
        "exclude_recursion": bool(
            raw.get("excludeRecursion", extensions.get("exclude_recursion", False))
        ),
        "case_sensitive": raw.get("caseSensitive", extensions.get("case_sensitive")),
        "match_whole_words": raw.get(
            "matchWholeWords", extensions.get("match_whole_words")
        ),
    }
    if isinstance(aq_meta.get("activation"), dict):
        activation_payload.update(aq_meta["activation"])
    try:
        activation = LoreActivation.model_validate(activation_payload)
    except (TypeError, ValueError):
        activation = LoreActivation(
            enabled=enabled,
            constant=bool(raw.get("constant", False)),
            primary_keys=keys,
            secondary_keys=secondary,
        )
    try:
        status = LoreStatus(str(aq_meta.get("status", "canon")))
    except ValueError:
        status = LoreStatus.CANON
    if isinstance(aq_meta.get("scope"), dict):
        try:
            scope = LoreScope.model_validate(aq_meta["scope"])
        except (TypeError, ValueError):
            scope = LoreScope()
    else:
        scope = LoreScope()
    known = {
        "uid",
        "id",
        "key",
        "keys",
        "keysecondary",
        "secondary_keys",
        "comment",
        "content",
        "constant",
        "enabled",
        "disable",
        "selectiveLogic",
        "order",
        "insertion_order",
        "name",
        "extensions",
        "_augmentedquill",
    }
    raw_fields = {
        key: deepcopy(value) for key, value in raw.items() if key not in known
    }
    return LoreEntry(
        id=f"world-info:{book_name}:{uid}",
        name=name,
        kind="other",
        status=status,
        description=str(raw.get("content") or ""),
        aliases=keys,
        scope=scope,
        activation=activation,
        belief_actor=(
            str(aq_meta["belief_actor"])
            if aq_meta.get("belief_actor") is not None
            else None
        ),
        book=book_name,
        raw_record=deepcopy(raw),
        raw_fields=raw_fields,
    )


def world_info_lore_entries(project_dir: Path) -> tuple[list[LoreEntry], list[str]]:
    """Load imported World Info records and return their unsupported warnings."""

    output: list[LoreEntry] = []
    warnings: list[str] = []
    for book_name in list_world_info_books(project_dir):
        try:
            payload = read_world_info(project_dir, book_name)
        except ValueError as exc:
            warnings.append(f"{book_name}: unreadable World Info ({exc})")
            continue
        if not isinstance(payload, dict):
            continue
        warnings.extend(unsupported_world_info_options(book_name, payload))
        raw_entries = payload.get("entries")
        if isinstance(raw_entries, dict):
            records = [(str(uid), value) for uid, value in raw_entries.items()]
        elif isinstance(raw_entries, list):
            records = [
                (str(value.get("uid", value.get("id", index))), value)
                for index, value in enumerate(raw_entries)
            ]
        else:
            continue
        for uid, raw in records:
            if isinstance(raw, dict):
                output.append(_st_entry_to_lore(book_name, uid, raw))
    return output, sorted(set(warnings))


def _as_entry(value: LoreEntry | dict[str, Any]) -> LoreEntry:
    return value if isinstance(value, LoreEntry) else LoreEntry.model_validate(value)


def _scope_matches(entry: LoreScope, target: LoreScope) -> bool:
    def _same_identifier(left: object, right: object) -> bool:
        return left is not None and right is not None and str(left) == str(right)

    def _numeric_identifier(value: object) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.strip().lstrip("-").isdigit():
            return int(value.strip())
        return None

    def _in_range(value: object, start: int | None, end: int | None) -> bool:
        numeric = _numeric_identifier(value)
        return not (
            start is not None
            and (numeric is None or numeric < start)
            or end is not None
            and (numeric is None or numeric > end)
        )

    if entry.book_id is not None and not _same_identifier(
        entry.book_id, target.book_id
    ):
        return False
    if entry.chapter_id is not None and not _same_identifier(
        entry.chapter_id, target.chapter_id
    ):
        return False
    if not _in_range(target.chapter_id, entry.chapter_start, entry.chapter_end):
        return False
    if entry.scene_id is not None and not _same_identifier(
        entry.scene_id, target.scene_id
    ):
        return False
    if not _in_range(target.scene_id, entry.scene_start, entry.scene_end):
        return False
    if (
        entry.viewpoint is not None
        and entry.viewpoint.casefold() != (target.viewpoint or "").casefold()
    ):
        return False
    if entry.timeline_id is not None and not _same_identifier(
        entry.timeline_id, target.timeline_id
    ):
        return False
    return _in_range(target.timeline_position, entry.timeline_start, entry.timeline_end)


def _match_key(haystack: str, needle: str, activation: LoreActivation) -> bool:
    needle = needle.strip()
    if not needle:
        return False
    if activation.case_sensitive is not True:
        haystack = haystack.casefold()
        needle = needle.casefold()
    whole_words = activation.match_whole_words is True
    if not whole_words:
        return needle in haystack
    if any(char.isspace() for char in needle):
        return needle in haystack
    return (
        re.search(rf"(?:^|\W){re.escape(needle)}(?:$|\W)", haystack, flags=re.UNICODE)
        is not None
    )


def _secondary_matches(
    haystack: str, activation: LoreActivation
) -> tuple[bool, list[str]]:
    keys = [key for key in activation.secondary_keys if key.strip()]
    matches = [key for key in keys if _match_key(haystack, key, activation)]
    if not keys:
        return True, matches
    logic = activation.selective_logic
    if logic == "AND_ANY":
        return bool(matches), matches
    if logic == "NOT_ALL":
        return len(matches) < len(keys), matches
    if logic == "NOT_ANY":
        return not matches, matches
    return len(matches) == len(keys), matches


def _entry_text(entry: LoreEntry) -> str:
    status = f" [{entry.status.value}]" if entry.status is not LoreStatus.CANON else ""
    return f"{entry.name}{status}: {entry.description}".strip()


def _unsupported_for_entry(entry: LoreEntry) -> list[str]:
    if not entry.raw_record:
        return []
    keys = {
        "probability",
        "useProbability",
        "use_probability",
        "sticky",
        "cooldown",
        "delay",
        "position",
        "depth",
        "scanDepth",
        "scan_depth",
        "role",
        "outletName",
        "outlet_name",
        "automationId",
        "automation_id",
        "triggers",
        "vectorized",
        "group",
        "groupOverride",
        "group_override",
        "groupWeight",
        "group_weight",
        "ignoreBudget",
        "ignore_budget",
        "delayUntilRecursion",
        "delay_until_recursion",
        "recursive",
        "useGroupScoring",
        "use_group_scoring",
        "matchPersonaDescription",
        "match_persona_description",
        "matchCharacterDescription",
        "match_character_description",
        "matchCharacterPersonality",
        "match_character_personality",
        "matchCharacterDepthPrompt",
        "match_character_depth_prompt",
        "matchScenario",
        "match_scenario",
        "matchCreatorNotes",
        "match_creator_notes",
    }
    found = sorted(key for key in keys if key in entry.raw_record)
    extensions = entry.raw_record.get("extensions")
    if isinstance(extensions, dict):
        found.extend(sorted(key for key in keys if key in extensions))
    raw_keys = [
        value
        for field in ("key", "keys", "keysecondary", "secondary_keys")
        for value in _string_values(entry.raw_record.get(field, []))
    ]
    if "{{" in entry.description or "@@" in entry.description:
        found.append("macros_or_decorators")
    if any(value.strip().startswith("/") for value in raw_keys):
        found.append("regex_keys")
    return sorted(set(found))


def select_lore(
    entries: Sequence[LoreEntry | dict[str, Any]],
    scan_text: str,
    scope: LoreScope | dict[str, Any] | None = None,
    budget_tokens: int | None = None,
    *,
    include_beliefs: bool = True,
    include_proposals: bool = False,
    recursive: bool = False,
    max_recursion_steps: int = 0,
) -> LoreSelectionResult:
    """Select lore deterministically and return an inspectable decision log."""

    target_scope = (
        scope if isinstance(scope, LoreScope) else LoreScope.model_validate(scope or {})
    )
    candidates = [_as_entry(item) for item in entries]
    allowed_statuses = {LoreStatus.CANON}
    if include_beliefs:
        allowed_statuses.add(LoreStatus.BELIEF)
    if include_proposals:
        allowed_statuses.add(LoreStatus.PROPOSAL)
    ordered = sorted(
        candidates, key=lambda item: (-item.activation.order, item.book or "", item.id)
    )

    selected: list[LoreEntry] = []
    decisions: list[LoreDecision] = []
    visited: set[str] = set()
    used_tokens = 0
    warnings: list[str] = []
    unsupported: list[str] = []
    current_scan = scan_text or ""
    requested_steps = (
        max_recursion_steps if max_recursion_steps > 0 else (1 if recursive else 0)
    )

    for step in range(requested_steps + 1):
        activated_this_step: list[LoreEntry] = []
        for entry in ordered:
            if entry.id in visited:
                decisions.append(
                    LoreDecision(
                        entry_id=entry.id,
                        included=False,
                        reason="already_activated",
                        priority=entry.activation.order,
                        recursion_step=step,
                    )
                )
                continue
            unsupported.extend(_unsupported_for_entry(entry))
            if not entry.activation.enabled:
                decisions.append(
                    LoreDecision(
                        entry_id=entry.id,
                        included=False,
                        reason="disabled",
                        priority=entry.activation.order,
                        recursion_step=step,
                    )
                )
                continue
            if entry.status not in allowed_statuses:
                decisions.append(
                    LoreDecision(
                        entry_id=entry.id,
                        included=False,
                        reason="status_excluded",
                        priority=entry.activation.order,
                        recursion_step=step,
                    )
                )
                continue
            if not _scope_matches(entry.scope, target_scope):
                decisions.append(
                    LoreDecision(
                        entry_id=entry.id,
                        included=False,
                        reason="scope_excluded",
                        priority=entry.activation.order,
                        recursion_step=step,
                    )
                )
                continue

            primary = [
                key
                for key in entry.activation.primary_keys
                if _match_key(current_scan, key, entry.activation)
            ]
            secondary_ok, secondary = _secondary_matches(current_scan, entry.activation)
            if not entry.activation.constant and not primary:
                decisions.append(
                    LoreDecision(
                        entry_id=entry.id,
                        included=False,
                        reason="primary_not_matched",
                        matched_secondary=secondary,
                        priority=entry.activation.order,
                        recursion_step=step,
                    )
                )
                continue
            if not entry.activation.constant and not secondary_ok:
                decisions.append(
                    LoreDecision(
                        entry_id=entry.id,
                        included=False,
                        reason="secondary_not_satisfied",
                        matched_primary=primary,
                        matched_secondary=secondary,
                        priority=entry.activation.order,
                        recursion_step=step,
                    )
                )
                continue
            if step > 0 and entry.activation.exclude_recursion:
                decisions.append(
                    LoreDecision(
                        entry_id=entry.id,
                        included=False,
                        reason="excluded_from_recursion",
                        matched_primary=primary,
                        matched_secondary=secondary,
                        priority=entry.activation.order,
                        recursion_step=step,
                    )
                )
                continue

            text = _entry_text(entry)
            estimate = estimate_lore_tokens(text)
            if (
                budget_tokens is not None
                and used_tokens + estimate > budget_tokens
                and not entry.activation.constant
            ):
                decisions.append(
                    LoreDecision(
                        entry_id=entry.id,
                        included=False,
                        reason="budget_exceeded",
                        matched_primary=primary,
                        matched_secondary=secondary,
                        estimated_tokens=estimate,
                        priority=entry.activation.order,
                        recursion_step=step,
                    )
                )
                warnings.append(
                    f"Lore budget reached before '{entry.name}' (estimate {estimate} tokens)."
                )
                continue
            selected.append(entry)
            activated_this_step.append(entry)
            visited.add(entry.id)
            used_tokens += estimate
            decisions.append(
                LoreDecision(
                    entry_id=entry.id,
                    included=True,
                    reason="constant" if entry.activation.constant else "matched",
                    matched_primary=primary,
                    matched_secondary=secondary,
                    estimated_tokens=estimate,
                    priority=entry.activation.order,
                    recursion_step=step,
                )
            )
            if budget_tokens is not None and used_tokens > budget_tokens:
                warnings.append(
                    f"Constant lore entry '{entry.name}' exceeds the configured budget; always-included semantics were retained."
                )

        if not recursive or step >= requested_steps or not activated_this_step:
            break
        recurse_text = "\n".join(
            entry.description
            for entry in activated_this_step
            if not entry.activation.prevent_recursion
        )
        if not recurse_text:
            break
        current_scan = (
            f"{current_scan}\n{recurse_text}" if current_scan else recurse_text
        )

    if budget_tokens is not None and used_tokens > budget_tokens:
        warnings.append(
            f"Selected lore estimate {used_tokens} tokens exceeds budget {budget_tokens} tokens."
        )
    context_text = "\n".join(_entry_text(entry) for entry in selected)
    return LoreSelectionResult(
        selected=selected,
        decisions=decisions,
        context_text=context_text,
        estimated_tokens=used_tokens,
        budget_tokens=budget_tokens,
        budget_warning=warnings[0] if warnings else None,
        warnings=sorted(set(warnings)),
        unsupported_options=sorted(set(unsupported)),
    )


def select_project_lore(
    project_dir: Path,
    scan_text: str,
    scope: LoreScope | dict[str, Any] | None = None,
    budget_tokens: int | None = None,
    *,
    include_beliefs: bool = True,
    include_proposals: bool = False,
    recursive: bool = False,
    max_recursion_steps: int = 0,
) -> LoreSelectionResult:
    """Select native Sourcebook and imported World Info entries for a project."""

    native = native_lore_entries(project_dir)
    imported, import_warnings = world_info_lore_entries(project_dir)
    result = select_lore(
        [*native, *imported],
        scan_text,
        scope=scope,
        budget_tokens=budget_tokens,
        include_beliefs=include_beliefs,
        include_proposals=include_proposals,
        recursive=recursive,
        max_recursion_steps=max_recursion_steps,
    )
    if import_warnings:
        result.warnings = sorted({*result.warnings, *import_warnings})
        result.unsupported_options = sorted(
            {*result.unsupported_options, *import_warnings}
        )
    return result
