# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Invariant tests for guarded, exact, and recoverable content saves."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from augmentedquill.services.projects import content_persistence as persistence
from augmentedquill.services.projects.content_persistence import (
    ContentRevisionConflict,
    content_revision,
    list_content_recovery,
    persist_content,
    read_chapter_content_snapshot,
    read_content_recovery,
    read_story_content_snapshot,
    restore_content_recovery,
    save_chapter_content_in_project,
    save_story_content_in_project,
)


def _make_novel(tmp_path: Path, content: str = "Before") -> Path:
    (tmp_path / "story.json").write_text(
        json.dumps(
            {
                "metadata": {"version": 2},
                "project_type": "novel",
                "chapters": [{"title": "One", "filename": "0001.txt"}],
            }
        ),
        encoding="utf-8",
    )
    chapters = tmp_path / "chapters"
    chapters.mkdir()
    (chapters / "0001.txt").write_text(content, encoding="utf-8")
    return tmp_path


def _make_short_story(tmp_path: Path, content: str = "Before") -> Path:
    (tmp_path / "story.json").write_text(
        json.dumps(
            {
                "metadata": {"version": 2},
                "project_type": "short-story",
                "content_file": "draft.md",
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "draft.md").write_text(content, encoding="utf-8")
    return tmp_path


def test_chapter_snapshot_and_guarded_save_return_revision_and_stable_key(
    tmp_path: Path,
) -> None:
    project = _make_novel(tmp_path, "Before ✨")

    before = read_chapter_content_snapshot(project, 1)
    assert before.filename == "0001.txt"
    assert before.document_key == "chapters/0001.txt"
    assert before.revision == content_revision("Before ✨")

    after = save_chapter_content_in_project(
        project,
        1,
        "After — exact",
        expected_revision=before.revision,
        expected_filename=before.filename,
    )
    assert after.content == "After — exact"
    assert after.revision == content_revision("After — exact")
    assert (project / "chapters" / "0001.txt").read_text(encoding="utf-8") == (
        "After — exact"
    )

    records = list((project / ".aq_history" / "content-recovery").iterdir())
    assert len(records) == 1
    manifest = json.loads((records[0] / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["status"] == "committed"
    assert (records[0] / "before").read_text(encoding="utf-8") == "Before ✨"
    assert (records[0] / "after").read_text(encoding="utf-8") == "After — exact"


def test_stale_revision_keeps_newer_file_unchanged_and_returns_current_snapshot(
    tmp_path: Path,
) -> None:
    project = _make_novel(tmp_path, "Original")
    loaded = read_chapter_content_snapshot(project, 1)
    (project / "chapters" / "0001.txt").write_text("External", encoding="utf-8")

    with pytest.raises(ContentRevisionConflict) as raised:
        save_chapter_content_in_project(
            project,
            1,
            "Local overwrite",
            expected_revision=loaded.revision,
            expected_filename=loaded.filename,
        )

    assert raised.value.snapshot.content == "External"
    assert raised.value.snapshot.revision == content_revision("External")
    assert (project / "chapters" / "0001.txt").read_text(encoding="utf-8") == "External"


def test_filename_guard_detects_reorder_or_document_binding_change(
    tmp_path: Path,
) -> None:
    project = _make_novel(tmp_path)
    loaded = read_chapter_content_snapshot(project, 1)

    with pytest.raises(ContentRevisionConflict) as raised:
        save_chapter_content_in_project(
            project,
            1,
            "No overwrite",
            expected_revision=loaded.revision,
            expected_filename="renamed.txt",
        )

    assert "filename changed" in str(raised.value)
    assert (project / "chapters" / "0001.txt").read_text(encoding="utf-8") == "Before"


def test_document_key_guard_detects_cross_book_binding_even_when_filename_matches(
    tmp_path: Path,
) -> None:
    project = _make_novel(tmp_path)
    loaded = read_chapter_content_snapshot(project, 1)

    with pytest.raises(ContentRevisionConflict) as raised:
        save_chapter_content_in_project(
            project,
            1,
            "No overwrite",
            expected_revision=loaded.revision,
            expected_filename=loaded.filename,
            expected_document_key="books/other/chapters/0001.txt",
        )

    assert "identity changed" in str(raised.value)
    assert (project / "chapters" / "0001.txt").read_text(encoding="utf-8") == "Before"


def test_recheck_after_recovery_preparation_refuses_external_edit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    project = _make_novel(tmp_path, "Original")
    loaded = read_chapter_content_snapshot(project, 1)
    original_prepare = persistence._prepare_recovery

    def prepare_then_external_edit(
        project_dir: Path, before: persistence.ContentSnapshot, content: str
    ) -> tuple[Path, persistence.ContentSnapshot]:
        prepared = original_prepare(project_dir, before, content)
        (project / "chapters" / "0001.txt").write_text("External", encoding="utf-8")
        return prepared

    monkeypatch.setattr(persistence, "_prepare_recovery", prepare_then_external_edit)
    with pytest.raises(ContentRevisionConflict) as raised:
        save_chapter_content_in_project(
            project,
            1,
            "Local overwrite",
            expected_revision=loaded.revision,
            expected_document_key=loaded.document_key,
        )

    assert raised.value.snapshot.content == "External"
    assert (project / "chapters" / "0001.txt").read_text(encoding="utf-8") == "External"
    records = list_content_recovery(project)
    assert records and records[0].status == "prepared"


def test_editor_save_keeps_scene_annotation_markers_and_plain_comments_exact(
    tmp_path: Path,
) -> None:
    project = _make_novel(
        tmp_path,
        "<!--scene:1:start-->Before<!--scene:1:end-->\n"
        "<!--annotation:note:start-->A note<!--annotation:note:end-->",
    )
    loaded = read_chapter_content_snapshot(project, 1)
    edited = loaded.content.replace("Before", "Edited")
    saved = save_chapter_content_in_project(
        project,
        1,
        edited,
        expected_revision=loaded.revision,
        expected_document_key=loaded.document_key,
    )
    assert saved.content == edited
    assert "<!--scene:1:start-->" in saved.content
    assert "<!--annotation:note:end-->" in saved.content

    plain_loaded = read_chapter_content_snapshot(project, 1)
    plain = "<!-- ordinary HTML comment -->\nPlain prose edit"
    plain_saved = save_chapter_content_in_project(
        project,
        1,
        plain,
        expected_revision=plain_loaded.revision,
        expected_document_key=plain_loaded.document_key,
    )
    assert plain_saved.content == plain

    malformed_loaded = read_chapter_content_snapshot(project, 1)
    with pytest.raises(ValueError, match="Malformed internal marker"):
        save_chapter_content_in_project(
            project,
            1,
            "<!--annotation:note:start>broken",
            expected_revision=malformed_loaded.revision,
            expected_document_key=malformed_loaded.document_key,
        )

    unbalanced_loaded = read_chapter_content_snapshot(project, 1)
    with pytest.raises(ValueError, match="orphaned end marker"):
        save_chapter_content_in_project(
            project,
            1,
            "<!--scene:1:end-->Plain prose edit",
            expected_revision=unbalanced_loaded.revision,
            expected_document_key=unbalanced_loaded.document_key,
        )


def test_recovery_can_be_read_and_explicitly_restored_with_current_guards(
    tmp_path: Path,
) -> None:
    project = _make_novel(tmp_path, "Before")
    loaded = read_chapter_content_snapshot(project, 1)
    saved = save_chapter_content_in_project(
        project,
        1,
        "After",
        expected_revision=loaded.revision,
        expected_document_key=loaded.document_key,
    )
    records = list_content_recovery(project)
    assert len(records) == 1
    record = read_content_recovery(project, records[0].recovery_id)
    assert record.before.content == "Before"
    assert record.after.content == "After"

    restored = restore_content_recovery(
        project,
        record.recovery_id,
        "before",
        expected_revision=saved.revision,
        expected_document_key=saved.document_key,
        expected_filename=saved.filename,
    )
    assert restored.content == "Before"
    assert read_chapter_content_snapshot(project, 1).content == "Before"
    assert len(list_content_recovery(project)) == 2

    with pytest.raises(ValueError):
        read_content_recovery(project, "../outside")


def test_failed_atomic_target_write_leaves_old_file_and_durable_recovery(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    project = _make_novel(tmp_path, "Old")

    def fail_atomic(_path: Path, _content: str) -> None:
        raise OSError("simulated replace failure")

    monkeypatch.setattr(persistence, "_atomic_write", fail_atomic)
    with pytest.raises(OSError, match="simulated replace failure"):
        persist_content(
            project,
            project / "chapters" / "0001.txt",
            "New",
            expected_revision=content_revision("Old"),
        )

    assert (project / "chapters" / "0001.txt").read_text(encoding="utf-8") == "Old"
    records = list((project / ".aq_history" / "content-recovery").iterdir())
    assert len(records) == 1
    manifest = json.loads((records[0] / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["status"] == "prepared"
    assert (records[0] / "before").read_text(encoding="utf-8") == "Old"
    assert (records[0] / "after").read_text(encoding="utf-8") == "New"


def test_short_story_content_uses_configured_filename_and_revision(
    tmp_path: Path,
) -> None:
    project = _make_short_story(tmp_path, "Short story")
    before = read_story_content_snapshot(project)
    assert before.filename == "draft.md"
    assert before.document_key == "draft.md"

    after = save_story_content_in_project(
        project,
        "Short story revised",
        expected_revision=before.revision,
        expected_filename="draft.md",
    )
    assert after.content == "Short story revised"
    assert after.revision == content_revision("Short story revised")
    assert (project / "draft.md").read_text(encoding="utf-8") == "Short story revised"
