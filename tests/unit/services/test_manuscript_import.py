# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Invariants for protected, copy-based manuscript imports."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from augmentedquill.core.config import load_story_config
from augmentedquill.services.chapters.chapter_helpers import _scan_chapter_files
from augmentedquill.services.projects import manuscript_import as importer
from augmentedquill.services.projects.manuscript_import import (
    ManuscriptImportError,
    import_manuscript,
)
from augmentedquill.services.projects.project_registry_ops import (
    load_registry_from_path,
)


def _source_tree(tmp_path: Path) -> tuple[Path, dict[str, bytes]]:
    source = tmp_path / "book-source"
    (source / "manuscript").mkdir(parents=True)
    files = {
        "manuscript/02-second.md": (
            "<!--scene:2:start-->Second — café.\r\n"
            "<!--annotation:note:start-->潮水<!--annotation:note:end-->"
            "<!--scene:2:end-->\r\n"
        ).encode(),
        "manuscript/01-first.txt": b"First line.\r\nNext line.\r\n",
        "planning.md": b"Do not import this planning note.\n",
    }
    for relative, content in files.items():
        path = source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    return source, files


def test_import_preserves_selected_bytes_order_markers_and_hash_manifest(
    tmp_path: Path,
) -> None:
    source, files = _source_tree(tmp_path)
    before = {relative: (source / relative).read_bytes() for relative in files}
    destination = tmp_path / "projects" / "book-copy"

    result = import_manuscript(
        source,
        destination,
        ["manuscript/02-second.md", "manuscript/01-first.txt"],
        project_title="Book copy",
    )

    assert result.project_path == destination
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert manifest["kind"] == "augmentedquill-manuscript-import"
    assert manifest["source_root"] == str(source.resolve())
    assert [item["source"] for item in manifest["files"]] == [
        "manuscript/02-second.md",
        "manuscript/01-first.txt",
    ]
    assert [item["target"] for item in manifest["files"]] == [
        "chapters/0001.txt",
        "chapters/0002.txt",
    ]
    for index, relative in enumerate(
        ["manuscript/02-second.md", "manuscript/01-first.txt"], start=1
    ):
        target = destination / "chapters" / f"{index:04d}.txt"
        assert target.read_bytes() == files[relative]
        assert manifest["files"][index - 1]["size"] == len(files[relative])
        assert (
            manifest["files"][index - 1]["sha256"]
            == hashlib.sha256(files[relative]).hexdigest()
        )
    assert not (destination / "chapters" / "planning.txt").exists()
    assert {relative: (source / relative).read_bytes() for relative in files} == before


def test_import_writes_valid_reopenable_novel_structure(tmp_path: Path) -> None:
    source, _ = _source_tree(tmp_path)
    destination = tmp_path / "projects" / "reopen"
    import_manuscript(source, destination, ["manuscript/01-first.txt"])

    story = json.loads((destination / "story.json").read_text(encoding="utf-8"))
    assert story["project_type"] == "novel"
    assert story["format"] == "markdown"
    assert story["chapters"] == [
        {"title": "01-first", "summary": "", "filename": "0001.txt"}
    ]
    assert story["metadata"]["version"] == 2
    reopened = importer.validate_project_dir_data(destination)
    assert reopened == (True, "ok")
    loaded = load_story_config(destination / "story.json")
    assert loaded["project_title"] == "reopen"
    assert [chapter["filename"] for chapter in loaded["chapters"]] == ["0001.txt"]
    assert [
        (chapter_id, path.name) for chapter_id, path in _scan_chapter_files(destination)
    ] == [(1, "0001.txt")]


def test_destination_and_selected_source_must_stay_outside_escape_paths(
    tmp_path: Path,
) -> None:
    source, _ = _source_tree(tmp_path)
    with pytest.raises(ManuscriptImportError, match="inside the manuscript source"):
        import_manuscript(
            source,
            source / "created-project",
            ["manuscript/01-first.txt"],
        )

    outside = tmp_path / "outside.md"
    outside.write_text("outside", encoding="utf-8")
    escape = source / "manuscript" / "escape.md"
    try:
        escape.symlink_to(outside)
    except OSError:
        pytest.skip("symlink creation is unavailable")
    with pytest.raises(ManuscriptImportError, match="Symlinked source files"):
        import_manuscript(
            source,
            tmp_path / "projects" / "escape",
            ["manuscript/escape.md"],
        )


def test_existing_destination_duplicate_and_implicit_notes_are_refused(
    tmp_path: Path,
) -> None:
    source, _ = _source_tree(tmp_path)
    destination = tmp_path / "projects" / "existing"
    destination.mkdir(parents=True)
    with pytest.raises(ManuscriptImportError, match="already exists"):
        import_manuscript(source, destination, ["manuscript/01-first.txt"])

    with pytest.raises(ManuscriptImportError, match="selected twice"):
        import_manuscript(
            source,
            tmp_path / "projects" / "duplicate",
            ["manuscript/01-first.txt", "manuscript/01-first.txt"],
        )


def test_interrupted_copy_leaves_no_project_or_registry_entry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source, _ = _source_tree(tmp_path)
    destination = tmp_path / "projects" / "interrupted"
    registry = tmp_path / "projects.json"
    original_registry = {"current": "old", "recent": ["old", "older"]}
    registry.write_text(json.dumps(original_registry) + "\n", encoding="utf-8")

    def fail_copy(_source: importer.SourceFile, _target: Path) -> None:
        raise ManuscriptImportError("simulated interrupted copy")

    monkeypatch.setattr(importer, "_copy_verified_file", fail_copy)
    with pytest.raises(ManuscriptImportError, match="interrupted copy"):
        import_manuscript(
            source,
            destination,
            ["manuscript/01-first.txt", "manuscript/02-second.md"],
            registry_path=registry,
        )

    assert not destination.exists()
    assert json.loads(registry.read_text(encoding="utf-8")) == original_registry
    assert not list(destination.parent.glob(".interrupted.import-*"))
    assert load_registry_from_path(registry) == original_registry


def test_successful_registration_happens_after_publication(tmp_path: Path) -> None:
    source, _ = _source_tree(tmp_path)
    destination = tmp_path / "projects" / "registered"
    registry = tmp_path / "projects.json"
    result = import_manuscript(
        source,
        destination,
        ["manuscript/01-first.txt"],
        registry_path=registry,
    )

    assert result.registered is True
    registered = load_registry_from_path(registry)
    assert registered["current"] == str(destination)
    assert registered["recent"][0] == str(destination)
    assert destination.is_dir()
