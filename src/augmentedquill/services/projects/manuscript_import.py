# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Copy explicitly selected Markdown chapters into a fresh novel project.

The importer treats the source tree as protected input.  It performs a full
preflight, copies bytes into a private staging directory, records hashes and
source-relative names in a manifest, and publishes the project only after all
checks pass.  No source-side metadata, planning notes, or prose is discovered
implicitly.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from augmentedquill.core.config import save_story_config
from augmentedquill.services.projects.project_lifecycle_ops import (
    initialize_project_dir_data,
    validate_project_dir_data,
)
from augmentedquill.services.projects.project_registry_ops import (
    load_registry_from_path,
)

_ALLOWED_SOURCE_SUFFIXES = {".md", ".txt"}
_MAX_CHAPTERS = 9_999
_MANIFEST_DIR = ".aq_import"
_MANIFEST_NAME = "manuscript-import.json"


class ManuscriptImportError(ValueError):
    """Raised when a protected copy-based manuscript import is unsafe."""


@dataclass(frozen=True)
class SourceFile:
    """Preflight identity of one explicitly selected source file."""

    path: Path
    relative_path: str
    size: int
    sha256: str


@dataclass(frozen=True)
class ImportedFile:
    """Manifest identity of one copied chapter."""

    order: int
    source: str
    target: str
    size: int
    sha256: str


@dataclass(frozen=True)
class ManuscriptImportResult:
    """Published project and audit manifest returned by the importer."""

    project_path: Path
    manifest_path: Path
    files: tuple[ImportedFile, ...]
    registered: bool


def _sha256_file(path: Path) -> tuple[int, str]:
    """Hash a file without decoding or changing its bytes."""
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                digest.update(chunk)
    except OSError as exc:
        raise ManuscriptImportError(f"Could not read source file: {path}") from exc
    return size, digest.hexdigest()


def _resolve_source_root(source_root: Path) -> Path:
    """Resolve and validate a source directory before any destination writes."""
    try:
        resolved = source_root.expanduser().resolve(strict=True)
    except OSError as exc:
        raise ManuscriptImportError(
            "The manuscript source directory is unavailable."
        ) from exc
    if not resolved.is_dir():
        raise ManuscriptImportError("The manuscript source must be a directory.")
    return resolved


def _resolve_destination(destination: Path, source_root: Path) -> Path:
    """Resolve a new destination and reject source-tree or symlink escapes."""
    candidate = destination.expanduser()
    if not candidate.name or candidate.name in {".", ".."}:
        raise ManuscriptImportError(
            "The destination must name a new project directory."
        )
    if os.path.lexists(candidate):
        raise ManuscriptImportError("The destination project already exists.")
    resolved = candidate.resolve(strict=False)
    source_parent = resolved.parent
    if resolved == source_root or resolved.is_relative_to(source_root):
        raise ManuscriptImportError(
            "The destination project cannot be inside the manuscript source tree."
        )
    if source_parent == source_root or source_parent.is_relative_to(source_root):
        raise ManuscriptImportError(
            "The destination project cannot be inside the manuscript source tree."
        )
    return resolved


def _resolve_source_file(source_root: Path, value: str | Path) -> SourceFile:
    """Resolve one selected file and reject traversal or symlink escapes."""
    selected = Path(value).expanduser()
    lexical = selected if selected.is_absolute() else source_root / selected
    if os.path.lexists(lexical) and lexical.is_symlink():
        raise ManuscriptImportError(f"Symlinked source files are not accepted: {value}")
    try:
        resolved = lexical.resolve(strict=True)
    except OSError as exc:
        raise ManuscriptImportError(
            f"Selected source file is unavailable: {value}"
        ) from exc
    if not resolved.is_relative_to(source_root):
        raise ManuscriptImportError(
            f"Selected source file escapes the source tree: {value}"
        )
    if not resolved.is_file():
        raise ManuscriptImportError(f"Selected source is not a file: {value}")
    if resolved.suffix.casefold() not in _ALLOWED_SOURCE_SUFFIXES:
        raise ManuscriptImportError(f"Only .md and .txt files may be imported: {value}")
    try:
        relative = resolved.relative_to(source_root).as_posix()
    except ValueError as exc:
        raise ManuscriptImportError(
            f"Selected source file escapes the source tree: {value}"
        ) from exc
    size, sha256 = _sha256_file(resolved)
    try:
        resolved.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ManuscriptImportError(
            f"Selected manuscript file is not valid UTF-8: {value}"
        ) from exc
    return SourceFile(
        path=resolved,
        relative_path=relative,
        size=size,
        sha256=sha256,
    )


def _preflight_sources(
    source_root: Path,
    source_files: Sequence[str | Path],
) -> tuple[SourceFile, ...]:
    """Resolve all selected files before creating a staging directory."""
    if isinstance(source_files, (str, bytes)) or not source_files:
        raise ManuscriptImportError(
            "At least one manuscript file must be selected explicitly."
        )
    if len(source_files) > _MAX_CHAPTERS:
        raise ManuscriptImportError(
            f"At most {_MAX_CHAPTERS} chapters may be imported."
        )
    result: list[SourceFile] = []
    seen: set[Path] = set()
    for value in source_files:
        source = _resolve_source_file(source_root, value)
        if source.path in seen:
            raise ManuscriptImportError(f"The source file was selected twice: {value}")
        seen.add(source.path)
        result.append(source)
    return tuple(result)


def _copy_verified_file(source: SourceFile, target: Path) -> None:
    """Copy source bytes and verify the destination hash against preflight."""
    digest = hashlib.sha256()
    size = 0
    try:
        with (
            source.path.open("rb") as source_handle,
            target.open("xb") as target_handle,
        ):
            while chunk := source_handle.read(1024 * 1024):
                target_handle.write(chunk)
                size += len(chunk)
                digest.update(chunk)
    except OSError as exc:
        target.unlink(missing_ok=True)
        raise ManuscriptImportError(
            f"Could not copy selected manuscript file: {source.relative_path}"
        ) from exc
    actual_hash = digest.hexdigest()
    if size != source.size or actual_hash != source.sha256:
        target.unlink(missing_ok=True)
        raise ManuscriptImportError(
            f"Source changed while importing: {source.relative_path}"
        )


def _chapter_title(source: str) -> str:
    """Give the imported chapter a transparent title from its source filename."""
    return Path(source).stem or "Untitled chapter"


def _write_import_metadata(
    staging: Path,
    *,
    source_root: Path,
    project_title: str,
    files: Sequence[ImportedFile],
) -> None:
    """Persist chapter metadata and the lossless source audit manifest."""
    story_path = staging / "story.json"
    try:
        story = json.loads(story_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ManuscriptImportError(
            "The fresh project metadata could not be read."
        ) from exc
    if not isinstance(story, dict):
        raise ManuscriptImportError("The fresh project metadata is invalid.")
    story["project_title"] = project_title
    story["chapters"] = [
        {
            "title": _chapter_title(item.source),
            "summary": "",
            "filename": item.target.removeprefix("chapters/"),
        }
        for item in files
    ]
    story.pop("content_file", None)
    save_story_config(story_path, story)

    manifest = {
        "schema_version": 1,
        "kind": "augmentedquill-manuscript-import",
        "created_at": datetime.now(UTC).isoformat(),
        "source_root": str(source_root),
        "project_title": project_title,
        "project_type": "novel",
        "files": [asdict(item) for item in files],
    }
    manifest_dir = staging / _MANIFEST_DIR
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = manifest_dir / _MANIFEST_NAME
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _write_registry_atomically(
    registry_path: Path,
    project_path: Path,
) -> None:
    """Register the complete project with an atomic current/recent update."""
    existing = load_registry_from_path(registry_path)
    current = str(project_path)
    recent = [current, *[str(item) for item in existing.get("recent", [])]]
    deduped: list[str] = []
    for item in recent:
        if item and item not in deduped:
            deduped.append(item)
    payload = {"current": current, "recent": deduped[:5]}
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    replaced = False
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=registry_path.parent,
            prefix=f".{registry_path.name}.",
            delete=False,
        ) as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            temporary = Path(handle.name)
        os.replace(temporary, registry_path)
        replaced = True
    except OSError as exc:
        raise ManuscriptImportError(
            "The project registry could not be updated."
        ) from exc
    finally:
        if temporary is not None and temporary.exists() and not replaced:
            temporary.unlink(missing_ok=True)


def import_manuscript(
    source_root: Path,
    destination: Path,
    source_files: Sequence[str | Path],
    *,
    project_title: str | None = None,
    language: str = "en",
    registry_path: Path | None = None,
) -> ManuscriptImportResult:
    """Import selected source files into a fresh, optionally registered novel.

    ``source_files`` order becomes chapter order.  The source is read and
    hashed before any destination directory is created.  A registry update,
    when requested, occurs only after the complete project is atomically
    published and is rolled back by removing that complete project on failure.
    """
    source = _resolve_source_root(Path(source_root))
    destination_path = _resolve_destination(Path(destination), source)
    if not isinstance(language, str) or not language.strip() or len(language) > 32:
        raise ManuscriptImportError(
            "The project language must be a short non-empty string."
        )
    title = str(project_title or destination_path.name).strip()
    if not title or len(title) > 500:
        raise ManuscriptImportError(
            "The project title must be between 1 and 500 characters."
        )
    if registry_path is not None:
        registry_resolved = Path(registry_path).expanduser().resolve(strict=False)
        if registry_resolved == source or registry_resolved.is_relative_to(source):
            raise ManuscriptImportError(
                "The project registry cannot be written inside the source tree."
            )
        if registry_resolved == destination_path or registry_resolved.is_relative_to(
            destination_path
        ):
            raise ManuscriptImportError(
                "The project registry cannot be inside the destination project."
            )
    preflight = _preflight_sources(source, source_files)

    staging: Path | None = None
    published = False
    imported: list[ImportedFile] = []
    try:
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(
            tempfile.mkdtemp(
                prefix=f".{destination_path.name}.import-",
                dir=destination_path.parent,
            )
        )
        initialize_project_dir_data(
            staging,
            project_title=title,
            project_type="novel",
            now_iso=datetime.now(UTC).isoformat(),
            language=language.strip(),
        )
        chapters_dir = staging / "chapters"
        for order, source_file in enumerate(preflight, start=1):
            target_name = f"{order:04d}.txt"
            target_relative = f"chapters/{target_name}"
            target_path = chapters_dir / target_name
            _copy_verified_file(source_file, target_path)
            imported.append(
                ImportedFile(
                    order=order,
                    source=source_file.relative_path,
                    target=target_relative,
                    size=source_file.size,
                    sha256=source_file.sha256,
                )
            )
        _write_import_metadata(
            staging,
            source_root=source,
            project_title=title,
            files=imported,
        )
        valid, reason = validate_project_dir_data(staging)
        if not valid:
            raise ManuscriptImportError(f"Imported project failed validation: {reason}")
        if os.path.lexists(destination_path):
            raise ManuscriptImportError("The destination project already exists.")
        os.replace(staging, destination_path)
        staging = None
        published = True
        if registry_path is not None:
            try:
                _write_registry_atomically(Path(registry_path), destination_path)
            except Exception:
                shutil.rmtree(destination_path, ignore_errors=True)
                published = False
                raise
    except ManuscriptImportError:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)
        if published and destination_path.exists():
            shutil.rmtree(destination_path, ignore_errors=True)
        raise
    except Exception as exc:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)
        if published and destination_path.exists():
            shutil.rmtree(destination_path, ignore_errors=True)
        raise ManuscriptImportError(
            "The manuscript import failed before publication."
        ) from exc

    manifest_path = destination_path / _MANIFEST_DIR / _MANIFEST_NAME
    return ManuscriptImportResult(
        project_path=destination_path,
        manifest_path=manifest_path,
        files=tuple(imported),
        registered=registry_path is not None,
    )
