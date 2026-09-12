# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Revision-checked, atomic persistence for manuscript content.

The editor keeps content in memory while a user types.  This module provides
the small persistence boundary used by content routes: read a byte-accurate
revision, check an optional revision supplied by the caller, and atomically
write the exact UTF-8 content.  It deliberately does not run prose
normalisation or marker transfer; those transformations belong to generated
writing operations, while an editor save must not change unrelated text.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from augmentedquill.services.chapters.chapter_helpers import _chapter_by_id_or_404
from augmentedquill.services.projects.project_locks import run_locked
from augmentedquill.services.scenes.scene_markers import validate_marker_integrity

ContentValidator = Callable[[str], None]
_RECOVERY_ROOT = (".aq_history", "content-recovery")


@dataclass(frozen=True)
class ContentSnapshot:
    """The exact content and identity observed at one point in time."""

    content: str
    revision: str
    filename: str
    document_key: str


@dataclass(frozen=True)
class ContentRecoveryRecord:
    """A validated durable before/after pair for one content write."""

    recovery_id: str
    status: str
    before: ContentSnapshot
    after: ContentSnapshot
    created_at: str
    committed_at: str | None = None


class ContentRevisionConflict(ValueError):
    """Raised when a guarded save would overwrite newer content."""

    def __init__(
        self,
        snapshot: ContentSnapshot,
        expected_revision: str | None = None,
        expected_filename: str | None = None,
        expected_document_key: str | None = None,
    ) -> None:
        self.snapshot = snapshot
        self.expected_revision = expected_revision
        self.expected_filename = expected_filename
        self.expected_document_key = expected_document_key
        if (
            expected_document_key is not None
            and expected_document_key != snapshot.document_key
        ):
            detail = (
                "The document identity changed while it was being edited "
                f"(expected {expected_document_key!r}, found {snapshot.document_key!r})."
            )
        elif expected_filename is not None and expected_filename != snapshot.filename:
            detail = (
                "The document filename changed while it was being edited "
                f"(expected {expected_filename!r}, found {snapshot.filename!r})."
            )
        else:
            detail = "The document changed while it was being edited. Reload it before saving."
        super().__init__(detail)


def content_revision(content: str) -> str:
    """Return the SHA-256 revision of the exact UTF-8 content."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _resolve_document_path(project_dir: Path, path: Path) -> Path:
    """Resolve a document once and require its target to stay in the project."""
    root = project_dir.resolve()
    resolved = path.resolve()
    if not resolved.is_relative_to(root):
        raise ValueError("Document path must remain inside the project directory.")
    return resolved


def _document_key(project_dir: Path, path: Path) -> str:
    """Return a stable project-relative document key."""
    return (
        _resolve_document_path(project_dir, path)
        .relative_to(project_dir.resolve())
        .as_posix()
    )


def _read_snapshot(project_dir: Path, path: Path) -> ContentSnapshot:
    """Read one document and calculate its byte-accurate revision."""
    resolved = _resolve_document_path(project_dir, path)
    key = resolved.relative_to(project_dir.resolve()).as_posix()
    raw = resolved.read_bytes() if resolved.exists() else b""
    content = raw.decode("utf-8")
    return ContentSnapshot(
        content=content,
        revision=hashlib.sha256(raw).hexdigest(),
        filename=resolved.name,
        document_key=key,
    )


def read_content_snapshot(project_dir: Path, path: Path) -> ContentSnapshot:
    """Read a project-local content path with its current revision."""
    return _read_snapshot(project_dir, path)


def _durable_write(path: Path, data: bytes) -> None:
    """Write a recovery file and fsync it before returning."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


def _fsync_directory(path: Path) -> None:
    """Best-effort fsync for the directory containing an atomic replacement."""
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


def _atomic_write(path: Path, content: str) -> None:
    """Atomically replace *path* with exact UTF-8 content and fsync it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    replaced = False
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=path.parent, prefix=f".{path.name}.", delete=False
        ) as output:
            temporary_path = Path(output.name)
            output.write(content.encode("utf-8"))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, path)
        replaced = True
        _fsync_directory(path.parent)
    finally:
        if temporary_path is not None and temporary_path.exists() and not replaced:
            temporary_path.unlink(missing_ok=True)


def _prepare_recovery(
    project_dir: Path,
    before: ContentSnapshot,
    after_content: str,
) -> tuple[Path, ContentSnapshot]:
    """Durably stage the before/after pair before replacing the manuscript."""
    recovery_id = f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%fZ')}-{uuid4().hex}"
    recovery_dir = project_dir / ".aq_history" / "content-recovery" / recovery_id
    after = ContentSnapshot(
        content=after_content,
        revision=content_revision(after_content),
        filename=before.filename,
        document_key=before.document_key,
    )
    _durable_write(recovery_dir / "before", before.content.encode("utf-8"))
    _durable_write(recovery_dir / "after", after.content.encode("utf-8"))
    manifest = {
        "status": "prepared",
        "document_key": before.document_key,
        "filename": before.filename,
        "before_revision": before.revision,
        "after_revision": after.revision,
        "before_file": "before",
        "after_file": "after",
        "created_at": datetime.now(UTC).isoformat(),
    }
    _durable_write(
        recovery_dir / "manifest.json",
        (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )
    _fsync_directory(recovery_dir)
    return recovery_dir, after


def _complete_recovery(recovery_dir: Path) -> None:
    """Mark a staged recovery pair committed after the target replacement."""
    manifest_path = recovery_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["status"] = "committed"
    manifest["committed_at"] = datetime.now(UTC).isoformat()
    _durable_write(
        manifest_path,
        (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )
    _fsync_directory(recovery_dir)


def _recovery_root(project_dir: Path) -> Path:
    """Return the contained durable-recovery directory."""
    root = (project_dir / Path(*_RECOVERY_ROOT)).resolve()
    if not root.is_relative_to(project_dir.resolve()):
        raise ValueError("Recovery directory must remain inside the project.")
    return root


def _safe_recovery_dir(project_dir: Path, recovery_id: str) -> Path:
    """Resolve one recovery ID without allowing path traversal or symlinks out."""
    if (
        not recovery_id
        or Path(recovery_id).name != recovery_id
        or "\\" in recovery_id
        or "\x00" in recovery_id
        or recovery_id in {".", ".."}
    ):
        raise ValueError("Invalid recovery ID.")
    root = _recovery_root(project_dir)
    candidate = (root / recovery_id).resolve()
    if not candidate.is_relative_to(root) or candidate == root:
        raise ValueError("Recovery record must remain inside the project.")
    return candidate


def _safe_recovery_file(recovery_dir: Path, filename: str) -> Path:
    """Resolve a manifest-declared recovery file within its record directory."""
    if (
        not filename
        or Path(filename).name != filename
        or "\\" in filename
        or "\x00" in filename
    ):
        raise ValueError("Invalid recovery file name.")
    candidate = (recovery_dir / filename).resolve()
    if not candidate.is_relative_to(recovery_dir.resolve()):
        raise ValueError("Recovery file must remain inside its record.")
    return candidate


def _validated_recovery_record(
    project_dir: Path, recovery_id: str
) -> ContentRecoveryRecord:
    """Read and validate one recovery record before exposing or restoring it."""
    recovery_dir = _safe_recovery_dir(project_dir, recovery_id)
    manifest_path = _safe_recovery_file(recovery_dir, "manifest.json")
    if not recovery_dir.is_dir() or not manifest_path.is_file():
        raise FileNotFoundError(f"Recovery record {recovery_id!r} was not found.")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Recovery manifest is unreadable.") from exc
    if not isinstance(manifest, dict):
        raise ValueError("Recovery manifest must be an object.")

    status = manifest.get("status")
    if status not in {"prepared", "committed"}:
        raise ValueError("Recovery manifest has an invalid status.")
    document_key = manifest.get("document_key")
    filename = manifest.get("filename")
    created_at = manifest.get("created_at")
    if (
        not isinstance(document_key, str)
        or not document_key
        or document_key.startswith("/")
        or "\\" in document_key
        or "\x00" in document_key
        or any(part in {"", ".", ".."} for part in document_key.split("/"))
        or not isinstance(filename, str)
        or Path(document_key).name != filename
        or not isinstance(created_at, str)
    ):
        raise ValueError("Recovery manifest has an invalid document identity.")

    before_name = manifest.get("before_file")
    after_name = manifest.get("after_file")
    if not isinstance(before_name, str) or not isinstance(after_name, str):
        raise ValueError("Recovery manifest has invalid content file names.")
    before_path = _safe_recovery_file(recovery_dir, before_name)
    after_path = _safe_recovery_file(recovery_dir, after_name)
    if not before_path.is_file() or not after_path.is_file():
        raise FileNotFoundError(f"Recovery record {recovery_id!r} is incomplete.")
    try:
        before_raw = before_path.read_bytes()
        after_raw = after_path.read_bytes()
        before_content = before_raw.decode("utf-8")
        after_content = after_raw.decode("utf-8")
    except (OSError, UnicodeError) as exc:
        raise ValueError("Recovery content is unreadable.") from exc

    before_revision = manifest.get("before_revision")
    after_revision = manifest.get("after_revision")
    if (
        not isinstance(before_revision, str)
        or content_revision(before_content) != before_revision
        or not isinstance(after_revision, str)
        or content_revision(after_content) != after_revision
    ):
        raise ValueError("Recovery content does not match its manifest revisions.")

    before = ContentSnapshot(before_content, before_revision, filename, document_key)
    after = ContentSnapshot(after_content, after_revision, filename, document_key)
    committed_at = manifest.get("committed_at")
    if committed_at is not None and not isinstance(committed_at, str):
        raise ValueError("Recovery manifest has an invalid committed timestamp.")
    return ContentRecoveryRecord(
        recovery_id=recovery_id,
        status=status,
        before=before,
        after=after,
        created_at=created_at,
        committed_at=committed_at,
    )


def list_content_recovery(project_dir: Path) -> list[ContentRecoveryRecord]:
    """List valid contained recovery records, newest first.

    A malformed or partially copied record is intentionally omitted.  It
    remains on disk for forensic inspection without becoming an API path that
    can be used to escape the project directory.
    """
    root = _recovery_root(project_dir)
    if not root.is_dir():
        return []
    records: list[ContentRecoveryRecord] = []
    for candidate in root.iterdir():
        if not candidate.is_dir() or candidate.is_symlink():
            continue
        try:
            record = _validated_recovery_record(project_dir, candidate.name)
        except (FileNotFoundError, OSError, ValueError):
            continue
        records.append(record)
    records.sort(key=lambda record: record.created_at, reverse=True)
    return records


def read_content_recovery(project_dir: Path, recovery_id: str) -> ContentRecoveryRecord:
    """Read one validated, project-contained recovery record."""
    return _validated_recovery_record(project_dir, recovery_id)


def restore_content_recovery(
    project_dir: Path,
    recovery_id: str,
    target: str,
    *,
    expected_revision: str,
    expected_document_key: str,
    expected_filename: str | None = None,
) -> ContentSnapshot:
    """Restore a durable before/after snapshot with a checked current base.

    Restoration is itself persisted through ``persist_content`` and therefore
    creates a new recovery record.  Callers must provide the current revision
    and canonical document key observed immediately before requesting the
    restore.  No retry is attempted after an uncertain HTTP acknowledgement;
    the record and subsequent GET provide the recovery point for inspection.
    """
    record = _validated_recovery_record(project_dir, recovery_id)
    if target not in {"before", "after"}:
        raise ValueError("Recovery target must be 'before' or 'after'.")
    path = (project_dir / record.after.document_key).resolve()
    if not path.is_relative_to(project_dir.resolve()):
        raise ValueError("Recovery document must remain inside the project.")
    target_snapshot = record.before if target == "before" else record.after
    return persist_content(
        project_dir,
        path,
        target_snapshot.content,
        expected_revision=expected_revision,
        expected_filename=expected_filename,
        expected_document_key=expected_document_key,
        validator=validate_marker_integrity,
    )


async def async_restore_content_recovery(
    project_dir: Path,
    recovery_id: str,
    target: str,
    *,
    expected_revision: str,
    expected_document_key: str,
    expected_filename: str | None = None,
) -> ContentSnapshot:
    """Serialize an explicit recovery restore under the project lock."""
    return await run_locked(
        project_dir,
        lambda: restore_content_recovery(
            project_dir,
            recovery_id,
            target,
            expected_revision=expected_revision,
            expected_document_key=expected_document_key,
            expected_filename=expected_filename,
        ),
    )


def persist_content(
    project_dir: Path,
    path: Path,
    content: str,
    *,
    expected_revision: str | None = None,
    expected_filename: str | None = None,
    expected_document_key: str | None = None,
    validator: ContentValidator | None = None,
) -> ContentSnapshot:
    """Guard and atomically persist exact content for a resolved project path.

    The re-read after recovery preparation closes the normal preparation/edit
    window.  A separate process can still replace the file after that final
    read and before ``os.replace``; without a cooperative lock there is no
    filesystem compare-and-swap primitive here.  Atomic replacement prevents
    torn bytes, while the next guarded read exposes the resulting revision.
    """
    path = _resolve_document_path(project_dir, path)
    before = _read_snapshot(project_dir, path)
    if (
        expected_document_key is not None
        and expected_document_key != before.document_key
    ):
        raise ContentRevisionConflict(
            before, expected_revision, expected_filename, expected_document_key
        )
    if expected_filename is not None and expected_filename != before.filename:
        raise ContentRevisionConflict(
            before, expected_revision, expected_filename, expected_document_key
        )
    if expected_revision is not None and expected_revision != before.revision:
        raise ContentRevisionConflict(
            before, expected_revision, expected_filename, expected_document_key
        )

    if validator is not None:
        validator(before.content)
        validator(content)

    if content == before.content:
        return before

    recovery_dir, after = _prepare_recovery(project_dir, before, content)
    # The recovery pair is deliberately prepared before this final check.  If
    # another process edits the target during preparation, leave the prepared
    # pair for diagnosis and refuse to overwrite the newer bytes.
    rechecked = _read_snapshot(project_dir, path)
    if (
        rechecked.revision != before.revision
        or rechecked.filename != before.filename
        or rechecked.document_key != before.document_key
    ):
        raise ContentRevisionConflict(
            rechecked, expected_revision, expected_filename, expected_document_key
        )
    _atomic_write(path, content)
    _complete_recovery(recovery_dir)
    return after


def _chapter_path(active: Path, chap_id: int) -> Path:
    """Resolve a chapter path for a project-local operation."""
    _, path, _ = _chapter_by_id_or_404(chap_id, active=active)
    return path


def read_chapter_content_snapshot(active: Path, chap_id: int) -> ContentSnapshot:
    """Read a chapter's exact content and revision."""
    return read_content_snapshot(active, _chapter_path(active, chap_id))


def save_chapter_content_in_project(
    active: Path,
    chap_id: int,
    content: str,
    *,
    expected_revision: str | None = None,
    expected_filename: str | None = None,
    expected_document_key: str | None = None,
) -> ContentSnapshot:
    """Save exact chapter content with marker validation and revision checks."""
    path = _chapter_path(active, chap_id)
    return persist_content(
        active,
        path,
        content,
        expected_revision=expected_revision,
        expected_filename=expected_filename,
        expected_document_key=expected_document_key,
        validator=validate_marker_integrity,
    )


async def async_save_chapter_content_in_project(
    active: Path,
    chap_id: int,
    content: str,
    *,
    expected_revision: str | None = None,
    expected_filename: str | None = None,
    expected_document_key: str | None = None,
) -> ContentSnapshot:
    """Serialize a guarded chapter save under the per-project lock."""
    return await run_locked(
        active,
        lambda: save_chapter_content_in_project(
            active,
            chap_id,
            content,
            expected_revision=expected_revision,
            expected_filename=expected_filename,
            expected_document_key=expected_document_key,
        ),
    )


def story_content_path(active: Path) -> Path:
    """Resolve the configured story or short-story content path safely."""
    from augmentedquill.core.config import load_story_config

    story = load_story_config(active / "story.json") or {}
    filename = (
        str(story.get("content_file", "content.md"))
        if story.get("project_type") == "short-story"
        else "story_content.md"
    )
    path = (active / filename).resolve()
    if not path.is_relative_to(active.resolve()):
        raise ValueError("Story content path must remain inside the project directory.")
    return path


def read_story_content_snapshot(active: Path) -> ContentSnapshot:
    """Read story or short-story draft content and its revision."""
    return read_content_snapshot(active, story_content_path(active))


def save_story_content_in_project(
    active: Path,
    content: str,
    *,
    expected_revision: str | None = None,
    expected_filename: str | None = None,
    expected_document_key: str | None = None,
) -> ContentSnapshot:
    """Save exact story or short-story content with marker validation."""
    return persist_content(
        active,
        story_content_path(active),
        content,
        expected_revision=expected_revision,
        expected_filename=expected_filename,
        expected_document_key=expected_document_key,
        validator=validate_marker_integrity,
    )


async def async_save_story_content_in_project(
    active: Path,
    content: str,
    *,
    expected_revision: str | None = None,
    expected_filename: str | None = None,
    expected_document_key: str | None = None,
) -> ContentSnapshot:
    """Serialize a guarded story content save under the per-project lock."""
    return await run_locked(
        active,
        lambda: save_story_content_in_project(
            active,
            content,
            expected_revision=expected_revision,
            expected_filename=expected_filename,
            expected_document_key=expected_document_key,
        ),
    )
