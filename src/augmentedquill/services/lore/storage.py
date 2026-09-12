# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Project-local storage for raw SillyTavern World Info envelopes.

Raw World Info is intentionally kept outside ``story.json``.  The normal story
cleaner strips nested runtime ``id`` fields and the Sourcebook API validates a
small known-field model, while compatibility import/export must retain IDs,
metadata, extension fields, and unknown values.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from copy import deepcopy
from pathlib import Path
from typing import Any

from augmentedquill.services.projects.project_locks import run_locked
from augmentedquill.utils.path_utils import safe_child_path

_WORLD_INFO_DIR = Path("lore") / "world-info"
_INDEX_NAME = "index.json"
_UNSUPPORTED_FIELDS = {
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
_SAFE_BOOK_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def _world_info_dir(project_dir: Path) -> Path:
    project_root = project_dir.resolve()
    directory = (project_dir / _WORLD_INFO_DIR).resolve()
    if not directory.is_relative_to(project_root):
        raise ValueError("World Info directory must remain inside the project.")
    return directory


def _index_path(project_dir: Path) -> Path:
    return _world_info_dir(project_dir) / _INDEX_NAME


def _indexed_book_path(
    project_dir: Path, book_name: str, filename: object
) -> Path | None:
    """Resolve one index target while rejecting traversal and symlink escapes."""
    if (
        not isinstance(filename, str)
        or not filename
        or filename == _INDEX_NAME
        or "\\" in filename
        or "\x00" in filename
        or Path(filename).name != filename
        or filename != _book_filename(book_name)
    ):
        return None
    try:
        return safe_child_path(_world_info_dir(project_dir), filename)
    except ValueError:
        return None


def _load_index(project_dir: Path) -> dict[str, str]:
    path = _index_path(project_dir)
    # Reading an index symlink could disclose an unrelated file outside the
    # project.  Writes replace the link itself, but reads must reject it.
    if path.is_symlink() or not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(value, dict):
        return {}
    return {
        str(key): str(filename)
        for key, filename in value.items()
        if _indexed_book_path(project_dir, str(key), filename) is not None
    }


def _fsync_directory(path: Path) -> None:
    """Best-effort fsync for a directory after an atomic replacement."""
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)


def _atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    replaced = False
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=path.parent, delete=False
        ) as handle:
            temp_path = Path(handle.name)
            encoded = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode(
                "utf-8"
            )
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        replaced = True
        _fsync_directory(path.parent)
    finally:
        if temp_path is not None and temp_path.exists() and not replaced:
            temp_path.unlink(missing_ok=True)


def _book_filename(book_name: str) -> str:
    clean = _SAFE_BOOK_CHARS.sub("-", book_name.strip()).strip("-") or "world"
    digest = hashlib.sha256(book_name.encode("utf-8")).hexdigest()[:16]
    return f"{clean[:64]}-{digest}.json"


def _resolve_book_path(project_dir: Path, book_name: str) -> Path:
    if not isinstance(book_name, str) or not book_name.strip():
        raise ValueError("World Info book name is required")
    directory = _world_info_dir(project_dir)
    return safe_child_path(directory, _book_filename(book_name))


def list_world_info_books(project_dir: Path) -> list[str]:
    """Return imported book names from the sidecar index."""

    index = _load_index(project_dir)
    existing = [
        name
        for name, filename in index.items()
        if (
            (path := _indexed_book_path(project_dir, name, filename)) is not None
            and path.is_file()
        )
    ]
    return sorted(existing, key=str.casefold)


def read_world_info(project_dir: Path, book_name: str) -> dict[str, Any] | None:
    """Read a raw World Info object without model normalization."""

    path = _resolve_book_path(project_dir, book_name)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Invalid World Info JSON for '{book_name}': {exc}") from exc
    if not isinstance(payload, dict) or not isinstance(
        payload.get("entries"), (dict, list)
    ):
        raise ValueError("World Info must contain an entries object or array")
    return deepcopy(payload)


def write_world_info(
    project_dir: Path, book_name: str, payload: dict[str, Any]
) -> dict[str, Any]:
    """Persist a raw World Info object and return its untouched value."""

    if not isinstance(payload, dict) or not isinstance(
        payload.get("entries"), (dict, list)
    ):
        raise ValueError("World Info must contain an entries object or array")
    path = _resolve_book_path(project_dir, book_name)
    _atomic_write_json(path, payload)
    index = _load_index(project_dir)
    index[book_name] = path.name
    _atomic_write_json(_index_path(project_dir), index)
    return deepcopy(payload)


async def async_write_world_info(
    project_dir: Path, book_name: str, payload: dict[str, Any]
) -> dict[str, Any]:
    """Serialize sidecar and index writes with other project mutations."""
    return await run_locked(
        project_dir, lambda: write_world_info(project_dir, book_name, payload)
    )


def delete_world_info(project_dir: Path, book_name: str) -> bool:
    """Delete one imported book and its index entry."""

    index = _load_index(project_dir)
    path = _resolve_book_path(project_dir, book_name)
    existed = path.exists() or book_name in index
    path.unlink(missing_ok=True)
    if book_name in index:
        del index[book_name]
        _atomic_write_json(_index_path(project_dir), index)
    return existed


async def async_delete_world_info(project_dir: Path, book_name: str) -> bool:
    """Serialize sidecar deletion and index updates with imports."""
    return await run_locked(
        project_dir, lambda: delete_world_info(project_dir, book_name)
    )


def _iter_entry_records(payload: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    entries = payload.get("entries")
    if isinstance(entries, dict):
        return [
            (str(uid), value)
            for uid, value in entries.items()
            if isinstance(value, dict)
        ]
    if isinstance(entries, list):
        return [
            (str(value.get("uid", value.get("id", index))), value)
            for index, value in enumerate(entries)
            if isinstance(value, dict)
        ]
    return []


def unsupported_world_info_options(
    book_name: str, payload: dict[str, Any]
) -> list[str]:
    """Report advanced preserved settings that the deterministic selector ignores."""

    found: set[str] = set()
    for uid, record in _iter_entry_records(payload):
        for key in _UNSUPPORTED_FIELDS.intersection(record):
            found.add(f"{book_name}:{uid}:{key}")
        extensions = record.get("extensions")
        if isinstance(extensions, dict):
            for key in _UNSUPPORTED_FIELDS.intersection(extensions):
                found.add(f"{book_name}:{uid}:extensions.{key}")
        content = record.get("content")
        if isinstance(content, str) and ("{{" in content or "@@" in content):
            found.add(f"{book_name}:{uid}:macros_or_decorators")
        for field in ("key", "keys", "keysecondary", "secondary_keys"):
            values = record.get(field)
            if isinstance(values, str):
                values = [values]
            if isinstance(values, list) and any(
                isinstance(value, str) and value.strip().startswith("/")
                for value in values
            ):
                found.add(f"{book_name}:{uid}:regex_keys")
    return sorted(found)
