# Copyright (C) 2026 AugmentedQuill contributors
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Exercise the original-file boundary with disposable Markdown manuscripts."""

import asyncio
import json
import stat
from pathlib import Path

import pytest

from augmentedquill.core.config import load_story_config
from augmentedquill.services.projects.content_persistence import (
    ContentRevisionConflict,
    async_save_chapter_content_in_project,
    list_content_recovery,
    persist_content,
    read_chapter_content_snapshot,
    restore_content_recovery,
    save_chapter_content_in_project,
)
from augmentedquill.services.projects.manuscript_link import create_link_manifest
from augmentedquill.services.projects.project_lifecycle_ops import (
    initialize_project_dir_data,
)


@pytest.fixture
def linked(tmp_path: Path) -> tuple[Path, Path, str]:
    root = tmp_path / "original-book"
    root.mkdir()
    text = "\ufeff# Chapter 1\r\n\r\n🌊 Café. She waited.\r\nSecond line.\n"
    (root / "chapter.md").write_bytes(text.encode("utf-8"))
    (root / "chapter.md").chmod(0o640)
    (root / "same.md").write_bytes(text.encode("utf-8"))
    (root / "planning.md").write_text("Read-only planning", encoding="utf-8")
    project = tmp_path / "metadata"
    initialize_project_dir_data(project, "Linked", "novel", "2026-09-12")
    create_link_manifest(project, source_root=root, files=["chapter.md"])
    return project, root, text


def test_exact_save_and_recovery_preserve_other_bytes_and_permissions(linked):
    project, root, text = linked
    before = read_chapter_content_snapshot(project, 1)
    changed = text.replace("She waited.", "She listened.")
    saved = save_chapter_content_in_project(
        project,
        1,
        changed,
        expected_revision=before.revision,
        expected_document_key=before.document_key,
        expected_filename=before.filename,
    )
    path = root / "chapter.md"
    assert path.read_bytes() == changed.encode("utf-8")
    assert stat.S_IMODE(path.stat().st_mode) == 0o640
    records = list_content_recovery(project)
    assert len(records) == 1
    assert records[0].before.content == text
    assert records[0].after.content == changed
    restore_content_recovery(
        project,
        records[0].recovery_id,
        "before",
        expected_revision=saved.revision,
        expected_document_key=saved.document_key,
        expected_filename=saved.filename,
    )
    assert path.read_bytes() == text.encode("utf-8")
    assert stat.S_IMODE(path.stat().st_mode) == 0o640
    assert (root / "same.md").read_bytes() == text.encode("utf-8")
    assert (root / "planning.md").read_text() == "Read-only planning"


def test_linked_reads_normalize_old_metadata_without_writing_files(linked):
    project, root, text = linked
    story_path = project / "story.json"
    metadata = json.loads(story_path.read_text())
    metadata["metadata"]["version"] = 2
    story_path.write_text(json.dumps(metadata), encoding="utf-8")
    tracked = [p for tree in (project, root) for p in tree.rglob("*") if p.is_file()]
    before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in tracked}

    story = load_story_config(story_path)
    snapshot = read_chapter_content_snapshot(project, 1)

    assert story["metadata"]["version"] >= 9
    assert snapshot.content == text
    after = {
        p: (p.read_bytes(), p.stat().st_mtime_ns)
        for tree in (project, root)
        for p in tree.rglob("*")
        if p.is_file()
    }
    assert after == before


@pytest.mark.parametrize("missing", ["expected_revision", "expected_document_key"])
def test_linked_save_requires_both_revision_and_identity(linked, missing):
    project, root, text = linked
    snapshot = read_chapter_content_snapshot(project, 1)
    guards = {
        "expected_revision": snapshot.revision,
        "expected_document_key": snapshot.document_key,
    }
    guards.pop(missing)
    with pytest.raises(ValueError):
        save_chapter_content_in_project(project, 1, "Unsafe write", **guards)
    assert (root / "chapter.md").read_bytes() == text.encode("utf-8")


def test_nonallowlisted_planning_cannot_be_written(linked):
    project, root, _ = linked
    with pytest.raises(ValueError):
        persist_content(project, root / "planning.md", "Changed")
    assert (root / "planning.md").read_text() == "Read-only planning"


def test_same_bytes_at_another_path_do_not_accept_stale_identity(linked):
    project, root, text = linked
    before = read_chapter_content_snapshot(project, 1)
    manifest_path = project / ".aq_import" / "manuscript-link.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["entries"][0]["source"] = "same.md"
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises((ContentRevisionConflict, ValueError)):
        save_chapter_content_in_project(
            project,
            1,
            "Wrong document",
            expected_revision=before.revision,
            expected_document_key=before.document_key,
        )
    assert (root / "chapter.md").read_bytes() == text.encode("utf-8")
    assert (root / "same.md").read_bytes() == text.encode("utf-8")


def test_missing_original_is_not_recreated_as_an_empty_document(linked):
    project, root, _ = linked
    before = read_chapter_content_snapshot(project, 1)
    (root / "chapter.md").unlink()
    with pytest.raises((OSError, ValueError)):
        save_chapter_content_in_project(
            project,
            1,
            "Resurrected",
            expected_revision=before.revision,
            expected_document_key=before.document_key,
        )
    assert not (root / "chapter.md").exists()


def test_recovery_record_cannot_follow_a_remapped_document_id(linked):
    project, root, text = linked
    before = read_chapter_content_snapshot(project, 1)
    changed = text.replace("She waited.", "She listened.")
    save_chapter_content_in_project(
        project,
        1,
        changed,
        expected_revision=before.revision,
        expected_document_key=before.document_key,
    )
    record = list_content_recovery(project)[0]
    (root / "same.md").write_bytes(changed.encode("utf-8"))
    manifest_path = project / ".aq_import" / "manuscript-link.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["entries"][0]["source"] = "same.md"
    manifest_path.write_text(json.dumps(manifest))
    current = read_chapter_content_snapshot(project, 1)
    with pytest.raises(ValueError):
        restore_content_recovery(
            project,
            record.recovery_id,
            "before",
            expected_revision=current.revision,
            expected_document_key=current.document_key,
        )
    assert (root / "same.md").read_bytes() == changed.encode("utf-8")
    assert (root / "chapter.md").read_bytes() == changed.encode("utf-8")


def test_concurrent_projects_share_external_document_cas_lock(linked):
    project, root, text = linked
    second_project = project.parent / "metadata-second"
    initialize_project_dir_data(second_project, "Linked second", "novel", "2026-09-12")
    create_link_manifest(second_project, source_root=root, files=["chapter.md"])

    first = read_chapter_content_snapshot(project, 1)
    second = read_chapter_content_snapshot(second_project, 1)
    assert first.revision == second.revision
    assert first.document_key == second.document_key

    async def save_both():
        return await asyncio.gather(
            async_save_chapter_content_in_project(
                project,
                1,
                "First concurrent winner",
                expected_revision=first.revision,
                expected_document_key=first.document_key,
            ),
            async_save_chapter_content_in_project(
                second_project,
                1,
                "Second concurrent winner",
                expected_revision=second.revision,
                expected_document_key=second.document_key,
            ),
            return_exceptions=True,
        )

    outcomes = asyncio.run(save_both())
    successes = [
        outcome for outcome in outcomes if not isinstance(outcome, BaseException)
    ]
    conflicts = [
        outcome for outcome in outcomes if isinstance(outcome, ContentRevisionConflict)
    ]
    assert len(successes) == 1
    assert len(conflicts) == 1
    assert (root / "chapter.md").read_text(encoding="utf-8") in {
        "First concurrent winner",
        "Second concurrent winner",
    }
    assert (root / "chapter.md").read_text(encoding="utf-8") != text


def test_in_root_parent_symlink_is_refused(tmp_path: Path):
    root = tmp_path / "book"
    real = root / "actual"
    real.mkdir(parents=True)
    (real / "chapter.md").write_text("Original", encoding="utf-8")
    (root / "alias").symlink_to(real, target_is_directory=True)
    project = tmp_path / "metadata"
    initialize_project_dir_data(project, "Linked", "novel", "2026-09-12")
    with pytest.raises(ValueError):
        create_link_manifest(project, source_root=root, files=["alias/chapter.md"])
    assert (real / "chapter.md").read_text() == "Original"
