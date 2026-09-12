# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Read-only project context and deterministic lore selection.

This module intentionally does not call ``load_story_config``.  That loader
also runs project migrations, which would make an otherwise non-mutating
Workshop discussion change ``story.json``.  Raw JSON and the public pure lore
selector are sufficient for context and keep the discussion route byte-safe.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from augmentedquill.models.workshop import (
    WorkshopContextBudget,
    WorkshopExcludedLore,
    WorkshopLoreDecision,
    WorkshopTargetSnapshot,
)
from augmentedquill.services.exceptions import BadRequestError
from augmentedquill.services.lore.activation import select_project_lore
from augmentedquill.services.lore.models import LoreEntry, LoreScope


class ReadonlyContextError(ValueError):
    """Raised when a project context file cannot be read safely."""


@dataclass(frozen=True)
class LoreSelection:
    """Selected lore, every selector decision, and deterministic accounting."""

    selected: list[dict[str, Any]]
    excluded: list[WorkshopExcludedLore]
    decisions: list[WorkshopLoreDecision]
    unsupported_options: list[str]
    serialized_chars: int
    warnings: list[str]
    estimated_tokens: int


def load_story_json_readonly(project_dir: Path) -> dict[str, Any]:
    """Load raw story metadata without normalization, migrations, or writes."""
    story_path = project_dir / "story.json"
    try:
        raw = story_path.read_bytes()
        parsed = json.loads(raw)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReadonlyContextError("Project story metadata could not be read.") from exc
    if not isinstance(parsed, dict):
        raise ReadonlyContextError("Project story metadata must be a JSON object.")
    return parsed


def _target_scope(
    target: WorkshopTargetSnapshot,
    *,
    viewpoint: str | None,
    timeline: str | None,
    timeline_position: int | None,
) -> LoreScope:
    """Build selector scope from stable target and author metadata."""
    # IDs are opaque project identifiers.  In particular, ``chapter-12`` is
    # not the same ID as ``12`` and extracting every digit can accidentally
    # activate a different chapter.  Numeric range matching remains explicit
    # in LoreScope and therefore only applies when the caller's canonical ID
    # is itself numeric.
    scope_values: dict[str, Any] = {
        "book_id": target.book_id,
        "chapter_id": target.document_id if target.scope == "chapter" else None,
        "scene_id": target.scene_id,
        "viewpoint": viewpoint,
        "timeline_id": timeline,
        "timeline_position": timeline_position,
    }
    try:
        return LoreScope.model_validate(scope_values)
    except (TypeError, ValueError) as exc:
        raise BadRequestError(
            "Workshop lore scope contains an invalid numeric range or timeline position."
        ) from exc


def _entry_as_raw(entry: LoreEntry) -> dict[str, Any]:
    """Preserve a native or World Info record for the context inspector."""
    if isinstance(entry.raw_record, dict):
        raw = copy.deepcopy(entry.raw_record)
    else:
        raw = entry.model_dump(mode="json", exclude_none=True)
    raw.setdefault("id", entry.id)
    raw.setdefault("name", entry.name)
    return raw


def select_lore(
    project_dir: Path,
    story: dict[str, Any],
    target: WorkshopTargetSnapshot,
    *,
    query: str | None,
    budget: WorkshopContextBudget,
    viewpoint: str | None,
    timeline: str | None,
    timeline_position: int | None,
) -> LoreSelection:
    """Select project lore through the shared pure deterministic selector.

    ``story`` is already loaded for the prompt's project overview.  The public
    selector rereads it as raw JSON and never invokes the migration-capable
    story loader; keeping that boundary explicit prevents accidental writes.
    """
    # World Info activation is meant to see the local prose window.  The
    # explicit query supplements that window so an entry keyed by nearby prose
    # (for example, Mara or harbour) activates for a target such as
    # ``She waited.``.
    scan_text = "\n".join(
        part
        for part in (
            query or "",
            target.context_before,
            target.original_text,
            target.context_after,
        )
        if part
    )
    token_budget = max(1, budget.max_lore_chars // 4) if budget.max_lore_chars else 0
    try:
        selected_result = select_project_lore(
            project_dir,
            scan_text,
            scope=_target_scope(
                target,
                viewpoint=viewpoint,
                timeline=timeline,
                timeline_position=timeline_position,
            ),
            budget_tokens=token_budget,
            include_beliefs=True,
            include_proposals=False,
            recursive=False,
        )
    except (OSError, TypeError, ValueError) as exc:
        raise ReadonlyContextError(
            "Project lore context could not be read safely."
        ) from exc
    decisions = [
        WorkshopLoreDecision.model_validate(decision.model_dump(mode="json"))
        for decision in selected_result.decisions
    ]
    selected: list[dict[str, Any]] = []

    def serialized_chars(value: list[dict[str, Any]]) -> int:
        """Count the actual JSON record body, excluding list brackets."""
        if not value:
            return 0
        payload = json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        return max(0, len(payload) - 2)

    def mark_final(entry_id: str, *, included: bool, reason: str) -> None:
        """Make the inspector decision agree with the final sent payload."""
        for index, decision in enumerate(decisions):
            if decision.entry_id == entry_id and decision.included:
                decisions[index] = decision.model_copy(
                    update={"included": included, "reason": reason}
                )
                return

    for entry in selected_result.selected:
        if len(selected) >= budget.max_lore_entries:
            if entry.activation.constant:
                raise BadRequestError(
                    f"Constant lore entry '{entry.name}' cannot fit the Workshop "
                    f"entry limit of {budget.max_lore_entries}; increase max_lore_entries."
                )
            mark_final(entry.id, included=False, reason="entry_budget")
            continue
        raw = _entry_as_raw(entry)
        projected = [*selected, raw]
        projected_chars = serialized_chars(projected)
        if projected_chars > budget.max_lore_chars:
            if entry.activation.constant:
                raise BadRequestError(
                    f"Constant lore entry '{entry.name}' requires {projected_chars} "
                    f"lore characters, exceeding max_lore_chars={budget.max_lore_chars}."
                )
            mark_final(entry.id, included=False, reason="character_budget")
            continue
        selected.append(raw)

    # A selected entry may have been excluded by the Workshop-specific entry
    # and character caps after the shared selector marked it included.  Derive
    # the exclusion list only after those caps so the inspector describes what
    # was actually sent.
    excluded = [
        WorkshopExcludedLore(id=decision.entry_id, reason=decision.reason)
        for decision in decisions
        if not decision.included
    ]
    excluded.sort(key=lambda item: (item.id.casefold(), item.reason))
    selected_serialized_chars = serialized_chars(selected)
    selected_estimated_tokens = (
        (
            len(
                json.dumps(
                    selected,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            )
            + 2
        )
        // 3
        if selected
        else 0
    )
    unsupported_options = sorted(set(selected_result.unsupported_options))
    warnings = sorted(set(selected_result.warnings))
    if unsupported_options:
        warnings.append(
            f"{len(unsupported_options)} imported lore option(s) are preserved but ignored."
        )
    return LoreSelection(
        selected=selected,
        excluded=excluded,
        decisions=decisions,
        unsupported_options=unsupported_options,
        serialized_chars=selected_serialized_chars,
        warnings=sorted(set(warnings)),
        estimated_tokens=selected_estimated_tokens,
    )
