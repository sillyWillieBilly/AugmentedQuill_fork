# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Capability based access to an external Markdown manuscript.

Linked projects keep the author's files in place.  The project directory only
stores a manifest describing an explicit allowlist and the application keeps
all titles, notes, scenes, and other metadata beside that manifest.  Callers
must resolve a document through this module before reading or writing it.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from augmentedquill.services.projects.project_locks import run_locked

_IMPORT_DIR = ".aq_import"
_MANIFEST_NAME = "manuscript-link.json"
_MANIFEST_KIND = "augmentedquill-linked-manuscript"
_ALLOWED_SUFFIXES = {".md", ".markdown", ".txt"}


class ManuscriptLinkError(ValueError):
    """Raised when a linked-manuscript capability is invalid."""


@dataclass(frozen=True)
class LinkedDocument:
    """One allowlisted source file and its application-facing identity."""

    id: str
    order: int
    source: str
    title: str
    status: str
    role: str
    path: Path
    sha256: str
    size: int

    @property
    def filename(self) -> str:
        return Path(self.source).name


def manifest_path(project_dir: Path) -> Path:
    """Return the project-local link manifest path."""
    return project_dir / _IMPORT_DIR / _MANIFEST_NAME


def has_link_manifest(project_dir: Path) -> bool:
    """Return whether a project declares linked-manuscript storage."""
    import_dir = project_dir / _IMPORT_DIR
    path = manifest_path(project_dir)
    if import_dir.is_symlink() or path.is_symlink():
        raise ManuscriptLinkError("Linked-manuscript metadata must not be a symlink.")
    return path.is_file()


def _reject_nul_or_absolute(value: str, label: str) -> Path:
    if (
        not isinstance(value, str)
        or not value.strip()
        or "\x00" in value
        or "\\" in value
    ):
        raise ManuscriptLinkError(f"{label} must be a non-empty string.")
    candidate = Path(value)
    if candidate.is_absolute() or any(
        part in {"", ".", ".."} for part in candidate.parts
    ):
        raise ManuscriptLinkError(f"{label} must be a safe relative path.")
    return candidate


def _source_root_from_manifest(manifest: dict[str, Any]) -> Path:
    raw_root = manifest.get("source_root")
    if not isinstance(raw_root, str) or not raw_root.strip():
        raise ManuscriptLinkError("Linked-manuscript manifest has no source_root.")
    raw_path = Path(raw_root).expanduser()
    _reject_symlink_components(raw_path, "source_root")
    try:
        root = raw_path.resolve(strict=True)
    except OSError as exc:
        raise ManuscriptLinkError(
            "Linked manuscript source_root is unavailable."
        ) from exc
    if not root.is_dir():
        raise ManuscriptLinkError("Linked manuscript source_root must be a directory.")
    return root


def _resolve_source(root: Path, source: str) -> Path:
    relative = _reject_nul_or_absolute(source, "source")
    if relative.suffix.lower() not in _ALLOWED_SUFFIXES:
        raise ManuscriptLinkError(
            f"Linked manuscript source must be Markdown or text: {source!r}."
        )
    lexical = root / relative
    component = root
    for part in relative.parts:
        component = component / part
        if component.is_symlink():
            raise ManuscriptLinkError(
                f"Symlink manuscript sources are not supported: {source!r}."
            )
    try:
        resolved = lexical.resolve(strict=True)
    except OSError as exc:
        raise ManuscriptLinkError(
            f"Linked manuscript source is unavailable: {source!r}."
        ) from exc
    if not resolved.is_file() or not resolved.is_relative_to(root):
        raise ManuscriptLinkError(
            f"Linked manuscript source escapes source_root: {source!r}."
        )
    return resolved


def _reject_symlink_components(path: Path, label: str) -> None:
    """Reject symlinks in an allowlisted path's root and parent components."""
    current = Path(path.anchor) if path.is_absolute() else Path()
    parts = path.parts[1:] if path.is_absolute() else path.parts
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise ManuscriptLinkError(f"{label} must not contain symlink components.")


def _file_digest(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def _validate_entry(root: Path, raw: Any, index: int) -> LinkedDocument:
    if not isinstance(raw, dict):
        raise ManuscriptLinkError(f"Linked manifest entry {index} must be an object.")
    entry_id = raw.get("id")
    source = raw.get("source")
    if not isinstance(entry_id, str) or not entry_id.strip() or "\x00" in entry_id:
        raise ManuscriptLinkError(f"Linked manifest entry {index} has an invalid id.")
    if not isinstance(source, str):
        raise ManuscriptLinkError(f"Linked manifest entry {entry_id!r} has no source.")
    path = _resolve_source(root, source)
    raw_order = raw.get("order", index + 1)
    if isinstance(raw_order, bool) or not isinstance(raw_order, int) or raw_order < 1:
        raise ManuscriptLinkError(
            f"Linked manifest entry {entry_id!r} has an invalid order."
        )
    status = raw.get("status", "active")
    role = raw.get("role", "chapter")
    title = raw.get("title") or path.stem
    if (
        not isinstance(status, str)
        or not isinstance(role, str)
        or not isinstance(title, str)
    ):
        raise ManuscriptLinkError(
            f"Linked manifest entry {entry_id!r} has invalid metadata."
        )
    size, digest = _file_digest(path)
    return LinkedDocument(
        id=entry_id,
        order=raw_order,
        source=Path(source).as_posix(),
        title=title,
        status=status,
        role=role,
        path=path,
        sha256=digest,
        size=size,
    )


def load_link_manifest(project_dir: Path) -> dict[str, Any] | None:
    """Load and validate a project-local linked-manuscript manifest."""
    path = manifest_path(project_dir)
    if (project_dir / _IMPORT_DIR).is_symlink() or path.is_symlink():
        raise ManuscriptLinkError("Linked-manuscript metadata must not be a symlink.")
    if not path.exists():
        return None
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ManuscriptLinkError("Linked-manuscript manifest is unreadable.") from exc
    if not isinstance(manifest, dict) or manifest.get("kind") != _MANIFEST_KIND:
        raise ManuscriptLinkError("Linked-manuscript manifest has an unsupported kind.")
    if manifest.get("schema_version") != 1:
        raise ManuscriptLinkError(
            "Linked-manuscript manifest has an unsupported schema version."
        )
    root = _source_root_from_manifest(manifest)
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        raise ManuscriptLinkError("Linked-manuscript manifest entries must be a list.")
    seen_ids: set[str] = set()
    seen_sources: set[str] = set()
    for index, raw in enumerate(entries):
        entry = _validate_entry(root, raw, index)
        if entry.id != f"document-{index + 1:04d}" or entry.order != index + 1:
            raise ManuscriptLinkError(
                "Linked-manuscript entries must use sequential document IDs and order."
            )
        if entry.id in seen_ids or entry.source in seen_sources:
            raise ManuscriptLinkError(
                "Linked-manuscript entries must have unique id and source."
            )
        seen_ids.add(entry.id)
        seen_sources.add(entry.source)
    excluded = manifest.get("excluded", [])
    if not isinstance(excluded, list):
        raise ManuscriptLinkError("Linked-manuscript excluded entries must be a list.")
    # Excluded records retain provenance, but are never exposed as chapters.
    for index, raw in enumerate(excluded):
        if not isinstance(raw, dict) or not isinstance(raw.get("source"), str):
            raise ManuscriptLinkError(
                f"Linked manifest excluded entry {index} is invalid."
            )
        _resolve_source(root, raw["source"])
    return manifest


def linked_documents(
    project_dir: Path, *, active_only: bool = True
) -> list[LinkedDocument]:
    """Return allowlisted documents in manifest order."""
    manifest = load_link_manifest(project_dir)
    if manifest is None:
        return []
    root = _source_root_from_manifest(manifest)
    records = [
        _validate_entry(root, raw, index)
        for index, raw in enumerate(manifest["entries"])
    ]
    records.sort(key=lambda item: (item.order, item.id))
    if active_only:
        # Editorial status describes provenance and approval.  It must not
        # make a selected draft disappear from the chapter list; callers use
        # the manifest's excluded list when a file should be omitted.
        records = [item for item in records if item.role == "chapter"]
    return records


def resolve_linked_document(project_dir: Path, document_id: str) -> LinkedDocument:
    """Resolve one stable manifest id to its current external path."""
    if not isinstance(document_id, str) or not document_id.strip():
        raise ManuscriptLinkError("A linked document id is required.")
    for document in linked_documents(project_dir, active_only=False):
        if document.id == document_id:
            return document
    raise ManuscriptLinkError(
        f"Linked manuscript document {document_id!r} is not allowlisted."
    )


def linked_document_for_chapter(project_dir: Path, chap_id: int) -> LinkedDocument:
    """Resolve a one-based API chapter id to an active linked document."""
    if isinstance(chap_id, bool) or not isinstance(chap_id, int) or chap_id < 1:
        raise ManuscriptLinkError("Chapter id must be a positive integer.")
    documents = linked_documents(project_dir)
    if chap_id > len(documents):
        raise ManuscriptLinkError(f"Chapter with ID {chap_id} is not allowlisted.")
    return documents[chap_id - 1]


def linked_project_metadata(project_dir: Path) -> dict[str, Any]:
    """Return safe transport metadata without adding source paths to story.json."""
    manifest = load_link_manifest(project_dir)
    if manifest is None:
        return {}
    return {
        "storage_mode": "linked-markdown",
        "source_root": str(_source_root_from_manifest(manifest)),
        "linked_document_count": len(linked_documents(project_dir)),
    }


def linked_transport_metadata(project_dir: Path, path: Path) -> dict[str, Any]:
    """Return external source fields for a chapter transport payload."""
    if not has_link_manifest(project_dir):
        return {}
    resolved = path.resolve()
    for document in linked_documents(project_dir, active_only=False):
        if document.path == resolved:
            return {
                "source_path": str(document.path),
                "manuscript_status": document.status,
                "document_id": document.id,
                "document_key": _linked_document_key(project_dir, document),
            }
    raise ManuscriptLinkError(
        "Document path is not present in the linked-manuscript allowlist."
    )


def _linked_document_key(project_dir: Path, document: LinkedDocument) -> str:
    """Return an identity containing source-root and source-relative path."""
    manifest = load_link_manifest(project_dir)
    if manifest is None:
        raise ManuscriptLinkError("Project has no linked manuscript.")
    root = _source_root_from_manifest(manifest)
    root_fingerprint = hashlib.sha256(str(root).encode("utf-8")).hexdigest()[:16]
    return f"linked:{root_fingerprint}/{document.source}"


def is_linked_project(project_dir: Path) -> bool:
    """Recognize linked intent even if its capability manifest is unavailable."""
    path = manifest_path(project_dir)
    if path.exists() or path.is_symlink() or path.parent.is_symlink():
        return True
    try:
        story = json.loads((project_dir / "story.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return False
    return isinstance(story, dict) and story.get("storage_mode") == "linked-markdown"


def reject_linked_mutation(project_dir: Path, operation: str) -> None:
    """Reject structural operations that could alter linked source membership."""
    if is_linked_project(project_dir):
        raise ManuscriptLinkError(
            f"Operation '{operation}' is disabled for linked Markdown projects; "
            "edit an allowlisted chapter through the guarded content endpoint."
        )


def _atomic_json_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    replaced = False
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, delete=False
        ) as output:
            temporary = Path(output.name)
            json.dump(payload, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        replaced = True
    finally:
        if temporary is not None and temporary.exists() and not replaced:
            temporary.unlink(missing_ok=True)


def _normalise_requested_files(
    source_root: Path, files: Iterable[str]
) -> list[dict[str, Any]]:
    selected = list(files)
    if not selected:
        raise ManuscriptLinkError("At least one explicit manuscript file is required.")
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    for order, source in enumerate(selected, start=1):
        path = _resolve_source(source_root, source)
        relative = path.relative_to(source_root).as_posix()
        if relative in seen:
            raise ManuscriptLinkError(f"Duplicate manuscript file: {relative}.")
        seen.add(relative)
        size, digest = _file_digest(path)
        records.append(
            {
                "id": f"document-{order:04d}",
                "order": order,
                "source": relative,
                "title": path.stem,
                "status": "active",
                "role": "chapter",
                "sha256": digest,
                "size": size,
            }
        )
    return records


def create_link_manifest(
    project_dir: Path,
    *,
    source_root: Path,
    files: Iterable[str],
    excluded: Iterable[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Create an explicit linked-manuscript manifest without copying sources."""
    source_path = source_root.expanduser()
    _reject_symlink_components(source_path, "source_root")
    try:
        root = source_path.resolve(strict=True)
    except OSError as exc:
        raise ManuscriptLinkError("source_root is unavailable.") from exc
    if not root.is_dir():
        raise ManuscriptLinkError("source_root must be a directory.")
    project_root = project_dir.expanduser().resolve()
    if (
        project_root == root
        or project_root.is_relative_to(root)
        or root.is_relative_to(project_root)
    ):
        raise ManuscriptLinkError(
            "Application metadata and manuscript source trees must be separate."
        )
    if has_link_manifest(project_dir):
        raise ManuscriptLinkError(
            "A project can have only one linked-manuscript manifest."
        )
    entries = _normalise_requested_files(root, files)
    excluded_records: list[dict[str, Any]] = []
    for raw in excluded or []:
        if not isinstance(raw, dict) or not isinstance(raw.get("source"), str):
            raise ManuscriptLinkError("Excluded records must contain a source string.")
        path = _resolve_source(root, raw["source"])
        size, digest = _file_digest(path)
        record = dict(raw)
        record["source"] = path.relative_to(root).as_posix()
        record.setdefault("status", "reference")
        record.setdefault("role", "reference")
        record["sha256"] = digest
        record["size"] = size
        excluded_records.append(record)
    payload = {
        "schema_version": 1,
        "kind": _MANIFEST_KIND,
        "source_root": str(root),
        "entries": entries,
        "excluded": excluded_records,
    }
    # Chapter titles are application metadata.  Populate an empty novel
    # project so chapter APIs have a useful title without putting any metadata
    # in the external Markdown files.  Existing author metadata is preserved.
    story_path = project_dir / "story.json"
    if story_path.is_file():
        from augmentedquill.core.config import load_story_config, save_story_config

        story = load_story_config(story_path) or {}
        story["storage_mode"] = "linked-markdown"
        if story.get("project_type", "novel") == "novel":
            chapters = story.get("chapters")
            if not isinstance(chapters, list) or not chapters:
                story["chapters"] = [
                    {"title": entry.get("title") or Path(entry["source"]).stem}
                    for entry in entries
                ]
        save_story_config(story_path, story)
    _atomic_json_write(manifest_path(project_dir), payload)
    return payload


async def async_create_link_manifest(
    project_dir: Path,
    *,
    source_root: Path,
    files: Iterable[str],
    excluded: Iterable[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Serialize link-manifest creation under the project lock."""
    return await run_locked(
        project_dir,
        lambda: create_link_manifest(
            project_dir, source_root=source_root, files=files, excluded=excluded
        ),
    )
