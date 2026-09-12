# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Focused invariants for external Markdown project links."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from augmentedquill.services.chapters.chapter_helpers import _scan_chapter_files
from augmentedquill.services.projects.content_persistence import (
    ContentRevisionConflict,
    read_chapter_content_snapshot,
    restore_content_recovery,
    save_chapter_content_in_project,
)
from augmentedquill.services.projects.manuscript_link import (
    ManuscriptLinkError,
    create_link_manifest,
    linked_documents,
    load_link_manifest,
)
from augmentedquill.services.projects.project_lifecycle_ops import (
    initialize_project_dir_data,
)


def _make_linked_project(tmp_path: Path) -> tuple[Path, Path]:
    source = tmp_path / "book"
    source.mkdir()
    (source / "chapter-01.md").write_text("First chapter", encoding="utf-8")
    (source / "chapter-02-new.md").write_text("Draft chapter", encoding="utf-8")
    (source / "planning.md").write_text("Reference plan", encoding="utf-8")

    project = tmp_path / "app-project"
    initialize_project_dir_data(project, "Book", "novel", "2026-09-12T00:00:00Z")
    create_link_manifest(
        project,
        source_root=source,
        files=["chapter-01.md", "chapter-02-new.md"],
        excluded=[
            {
                "source": "planning.md",
                "status": "reference",
                "role": "reference",
                "unknown": {"x": 1},
            }
        ],
    )
    return project, source


def test_manifest_is_explicit_lossless_and_drafts_remain_selectable(
    tmp_path: Path,
) -> None:
    project, source = _make_linked_project(tmp_path)

    manifest = load_link_manifest(project)
    assert manifest is not None
    assert manifest["source_root"] == str(source.resolve())
    assert [entry["source"] for entry in manifest["entries"]] == [
        "chapter-01.md",
        "chapter-02-new.md",
    ]
    assert manifest["excluded"][0]["unknown"] == {"x": 1}

    # Editorial status is provenance.  Exclusion is membership, so a selected
    # proposal/new draft remains openable and editable.
    manifest["entries"][1]["status"] = "new-draft"
    (project / ".aq_import" / "manuscript-link.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    documents = linked_documents(project)
    assert [document.path.name for document in documents] == [
        "chapter-01.md",
        "chapter-02-new.md",
    ]
    assert [document.status for document in documents] == ["active", "new-draft"]
    assert [chapter_id for chapter_id, _ in _scan_chapter_files(project)] == [1, 2]


def test_linked_content_uses_root_bound_identity_and_recovery(tmp_path: Path) -> None:
    project, source = _make_linked_project(tmp_path)
    before = read_chapter_content_snapshot(project, 1)
    assert before.filename == "chapter-01.md"
    assert before.document_key.startswith("linked:")
    assert before.document_key.endswith("/chapter-01.md")
    assert before.source_path == str((source / "chapter-01.md").resolve())

    after = save_chapter_content_in_project(
        project,
        1,
        "Edited first chapter",
        expected_revision=before.revision,
        expected_document_key=before.document_key,
    )
    assert (source / "chapter-01.md").read_text(
        encoding="utf-8"
    ) == "Edited first chapter"
    assert after.document_key == before.document_key

    records = list((project / ".aq_history" / "content-recovery").iterdir())
    assert len(records) == 1
    recovery_manifest = json.loads(
        (records[0] / "manifest.json").read_text(encoding="utf-8")
    )
    assert recovery_manifest["document_id"] == "document-0001"
    assert recovery_manifest["source_path"] == before.source_path

    restored = restore_content_recovery(
        project,
        records[0].name,
        "before",
        expected_revision=after.revision,
        expected_document_key=after.document_key,
    )
    assert restored.content == "First chapter"
    assert (source / "chapter-01.md").read_text(encoding="utf-8") == "First chapter"


def test_linked_path_and_duplicate_file_are_rejected(tmp_path: Path) -> None:
    _project, source = _make_linked_project(tmp_path)
    invalid_project = tmp_path / "invalid-project"
    initialize_project_dir_data(
        invalid_project, "Book", "novel", "2026-09-12T00:00:00Z"
    )
    with pytest.raises(ManuscriptLinkError, match="safe relative"):
        create_link_manifest(
            invalid_project, source_root=source, files=["../outside.md"]
        )
    duplicate_project = tmp_path / "duplicate-project"
    initialize_project_dir_data(
        duplicate_project, "Book", "novel", "2026-09-12T00:00:00Z"
    )
    with pytest.raises(ManuscriptLinkError, match="Duplicate"):
        create_link_manifest(
            duplicate_project,
            source_root=source,
            files=["chapter-01.md", "chapter-01.md"],
        )


def test_linked_guard_refuses_stale_external_edit(tmp_path: Path) -> None:
    project, source = _make_linked_project(tmp_path)
    before = read_chapter_content_snapshot(project, 1)
    (source / "chapter-01.md").write_text("External edit", encoding="utf-8")
    with pytest.raises(ContentRevisionConflict) as raised:
        save_chapter_content_in_project(
            project,
            1,
            "Overwriting edit",
            expected_revision=before.revision,
            expected_document_key=before.document_key,
        )
    assert raised.value.snapshot.content == "External edit"
    assert (source / "chapter-01.md").read_text(encoding="utf-8") == "External edit"
