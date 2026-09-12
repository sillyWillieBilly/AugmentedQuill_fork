# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Native Sourcebook CRUD with additive lore metadata."""

from __future__ import annotations

import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any

from augmentedquill.core.config import load_story_config, save_story_config
from augmentedquill.services.lore.activation import native_lore_entries
from augmentedquill.services.lore.models import (
    LoreEntry,
    LoreEntryCreate,
    LoreEntryUpdate,
)
from augmentedquill.services.projects.project_locks import run_locked
from augmentedquill.services.sourcebook.sourcebook_helpers import (
    KNOWN_SOURCEBOOK_CATEGORIES,
    _normalize_category_value,
    _update_global_relations,
    sourcebook_delete_entry,
)

_KIND_TO_CATEGORY = {
    "character": "Character",
    "location": "Location",
    "organization": "Organization",
    "object": "Item",
    "item": "Item",
    "event": "Event",
    "rule": "Lore",
    "lore": "Lore",
    "other": "Other",
}


def _category_for_kind(kind: str) -> str:
    return _KIND_TO_CATEGORY.get(kind.strip().lower(), "Other")


def _metadata_for_entry(
    entry: LoreEntry, *, entry_id: str | None = None
) -> dict[str, Any]:
    return {
        "entry_id": entry_id or entry.id,
        "status": entry.status.value,
        "scope": entry.scope.model_dump(exclude_none=True),
        "activation": entry.activation.model_dump(exclude_none=True),
        "sources": deepcopy(entry.sources),
        "belief_actor": entry.belief_actor,
    }


def _find_name(project_dir: Path, entry_id: str) -> str | None:
    story = load_story_config(project_dir / "story.json") or {}
    return _find_name_in_story(story, entry_id)


def _find_name_in_story(story: dict[str, Any], entry_id: str) -> str | None:
    """Find a native entry in an already loaded story snapshot."""
    sourcebook = story.get("sourcebook")
    if not isinstance(sourcebook, dict):
        return None
    for name, value in sourcebook.items():
        if str(name) == entry_id or str(name).casefold() == entry_id.casefold():
            return str(name)
        if isinstance(value, dict):
            metadata = value.get("_lore")
            if isinstance(metadata, dict) and str(metadata.get("entry_id")) == entry_id:
                return str(name)
    return None


def _clean_aliases(aliases: list[str]) -> list[str]:
    """Apply the Sourcebook API's stable alias trimming and de-duplication."""
    cleaned: list[str] = []
    for alias in aliases:
        value = alias.strip()
        if value and value not in cleaned:
            cleaned.append(value)
    return cleaned


def list_native_lore(project_dir: Path, query: str | None = None) -> list[LoreEntry]:
    entries = native_lore_entries(project_dir)
    if not query or not query.strip():
        return entries
    needle = query.casefold().strip()
    return [
        entry
        for entry in entries
        if needle in entry.name.casefold()
        or any(needle in alias.casefold() for alias in entry.aliases)
        or needle in entry.description.casefold()
    ]


def get_native_lore(project_dir: Path, entry_id: str) -> LoreEntry | None:
    target = _find_name(project_dir, entry_id)
    if target is None:
        return None
    return next(
        (entry for entry in native_lore_entries(project_dir) if entry.name == target),
        None,
    )


def create_native_lore(project_dir: Path, payload: LoreEntryCreate) -> LoreEntry:
    """Create native lore and metadata in one atomic story-config replacement."""
    name = payload.name.strip()
    if not name:
        raise ValueError("Invalid name: Name must be a non-empty string.")
    category = _category_for_kind(payload.kind)
    if category not in KNOWN_SOURCEBOOK_CATEGORIES:
        category = "Other"

    story = load_story_config(project_dir / "story.json") or {}
    sourcebook = story.get("sourcebook")
    if not isinstance(sourcebook, dict):
        sourcebook = {}
    if name in sourcebook:
        raise ValueError(f"Entry '{name}' already exists.")

    entry_id = f"lore:{uuid.uuid4().hex}"
    raw: dict[str, Any] = {
        "description": payload.description,
        "category": category,
        "synonyms": _clean_aliases(payload.aliases),
        "images": [],
        "keywords": [],
        # Keep the legacy inline representation for Sourcebook callers.  The
        # native lore reader also exposes the stable metadata below.
        "relations": deepcopy(payload.relations),
    }
    raw["_lore"] = {
        "entry_id": entry_id,
        "status": payload.status.value,
        "scope": payload.scope.model_dump(exclude_none=True),
        "activation": payload.activation.model_dump(exclude_none=True),
        "sources": deepcopy(payload.sources),
        "belief_actor": payload.belief_actor,
    }
    if payload.relations:
        _update_global_relations(name, deepcopy(payload.relations), story)
    sourcebook[name] = raw
    story["sourcebook"] = sourcebook
    save_story_config(project_dir / "story.json", story)
    created = next(
        (entry for entry in native_lore_entries(project_dir) if entry.id == entry_id),
        None,
    )
    if created is None:
        raise ValueError(f"Created lore entry '{name}' could not be read")
    return created


def update_native_lore(
    project_dir: Path, entry_id: str, payload: LoreEntryUpdate
) -> LoreEntry:
    """Update native content and metadata in one atomic story-config replacement."""
    story = load_story_config(project_dir / "story.json") or {}
    sourcebook = story.get("sourcebook")
    if not isinstance(sourcebook, dict):
        raise KeyError(f"Lore entry '{entry_id}' not found")

    current_name = _find_name_in_story(story, entry_id)
    if current_name is None or not isinstance(sourcebook.get(current_name), dict):
        raise KeyError(f"Lore entry '{entry_id}' not found")
    entry_data = sourcebook[current_name]

    new_name = payload.name.strip() if payload.name is not None else None
    resolved_name = new_name or current_name
    if new_name is not None and new_name != current_name:
        if new_name in sourcebook:
            raise ValueError(f"Entry '{new_name}' already exists.")
        global_rels = story.get("sourcebook_relations") or []
        for relation in global_rels:
            if not isinstance(relation, dict):
                continue
            if relation.get("source_id") == current_name:
                relation["source_id"] = new_name
            if relation.get("target_id") == current_name:
                relation["target_id"] = new_name
        del sourcebook[current_name]
        sourcebook[resolved_name] = entry_data

    fields_affecting_keywords_changed = False
    if payload.description is not None:
        if not isinstance(payload.description, str):
            raise ValueError("Invalid description: Description must be a string.")
        entry_data["description"] = payload.description
        fields_affecting_keywords_changed = True
    if payload.kind is not None:
        category = _normalize_category_value(_category_for_kind(payload.kind))
        if category is None:
            raise ValueError("Invalid category for lore kind")
        entry_data["category"] = category
    if payload.aliases is not None:
        entry_data["synonyms"] = _clean_aliases(payload.aliases)
        fields_affecting_keywords_changed = True
    if new_name is not None:
        fields_affecting_keywords_changed = True
    if fields_affecting_keywords_changed:
        entry_data["keywords"] = []
    if payload.relations is not None:
        _update_global_relations(resolved_name, deepcopy(payload.relations), story)

    metadata = entry_data.get("_lore")
    metadata = dict(metadata) if isinstance(metadata, dict) else {"entry_id": entry_id}
    metadata["entry_id"] = entry_id
    if payload.status is not None:
        metadata["status"] = payload.status.value
    if payload.scope is not None:
        metadata["scope"] = payload.scope.model_dump(exclude_none=True)
    if payload.activation is not None:
        metadata["activation"] = payload.activation.model_dump(exclude_none=True)
    if payload.sources is not None:
        metadata["sources"] = deepcopy(payload.sources)
    if "belief_actor" in payload.model_fields_set:
        metadata["belief_actor"] = payload.belief_actor
    entry_data["_lore"] = metadata
    story["sourcebook"] = sourcebook
    save_story_config(project_dir / "story.json", story)
    updated = next(
        (entry for entry in native_lore_entries(project_dir) if entry.id == entry_id),
        None,
    )
    if updated is None:
        raise ValueError(f"Updated lore entry '{resolved_name}' could not be read")
    return updated


def delete_native_lore(project_dir: Path, entry_id: str) -> bool:
    current = get_native_lore(project_dir, entry_id)
    if current is None:
        return False
    return sourcebook_delete_entry(current.name, active=project_dir)


async def async_create_native_lore(
    project_dir: Path, payload: LoreEntryCreate
) -> LoreEntry:
    """Serialize native creation with other project writes."""
    return await run_locked(
        project_dir, lambda: create_native_lore(project_dir, payload)
    )


async def async_update_native_lore(
    project_dir: Path, entry_id: str, payload: LoreEntryUpdate
) -> LoreEntry:
    """Serialize native updates with other project writes."""
    return await run_locked(
        project_dir, lambda: update_native_lore(project_dir, entry_id, payload)
    )


async def async_delete_native_lore(project_dir: Path, entry_id: str) -> bool:
    """Serialize native deletion with other project writes."""
    return await run_locked(
        project_dir, lambda: delete_native_lore(project_dir, entry_id)
    )
