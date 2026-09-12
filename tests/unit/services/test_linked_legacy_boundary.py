# Copyright (C) 2026 AugmentedQuill contributors
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Direct legacy service calls cannot bypass a linked project's storage policy."""

import asyncio
import json

import pytest

from augmentedquill.models.scene import SceneCreateRequest
from augmentedquill.services.annotations.annotation_service import create_annotation
from augmentedquill.services.chapters.chapters_api_ops import reorder_books_in_project
from augmentedquill.services.chat.chat_tools import project_tools
from augmentedquill.services.projects.manuscript_link import (
    ManuscriptLinkError,
    create_link_manifest,
)
from augmentedquill.services.projects.project_chapter_ops import (
    write_chapter_content_in_project,
)
from augmentedquill.services.projects.project_lifecycle_ops import (
    initialize_project_dir_data,
)
from augmentedquill.services.projects.project_snapshots import (
    restore_from_directory,
    restore_project_snapshot,
)
from augmentedquill.services.projects.project_structure_ops import (
    create_new_book_in_project,
)
from augmentedquill.services.scenes.scene_service import create_scene


@pytest.mark.parametrize("manifest_state", ["valid", "missing", "invalid"])
def test_legacy_calls_fail_before_any_file_changes(
    tmp_path, monkeypatch, manifest_state
):
    source = tmp_path / "book"
    source.mkdir()
    (source / "chapter.md").write_bytes(b"Original manuscript\r\n")
    project = tmp_path / "metadata"
    initialize_project_dir_data(project, "Linked", "novel", "2026-09-12")
    create_link_manifest(project, source_root=source, files=["chapter.md"])
    story_path = project / "story.json"
    story = json.loads(story_path.read_text())
    assert story["storage_mode"] == "linked-markdown"
    story.update(project_type="series", books=[{"id": "one", "title": "One"}])
    story_path.write_text(json.dumps(story))
    manifest = project / ".aq_import/manuscript-link.json"
    if manifest_state == "missing":
        manifest.unlink()
    elif manifest_state == "invalid":
        manifest.write_text("broken")
    monkeypatch.setattr(project_tools, "get_active_project_dir", lambda: project)

    def bytes_and_mtimes():
        return {
            p: (p.read_bytes(), p.stat().st_mtime_ns)
            for p in tmp_path.rglob("*")
            if p.is_file()
        }

    before = bytes_and_mtimes()
    operations = [
        lambda: create_new_book_in_project(project, "New"),
        lambda: reorder_books_in_project(project, {"book_ids": []}),
        lambda: write_chapter_content_in_project(1, "Replaced", active=project),
        lambda: restore_from_directory(project, project / "checkpoints/old"),
        lambda: restore_project_snapshot(project, {}),
        lambda: create_scene(project, SceneCreateRequest(summary="New")),
        lambda: create_annotation(
            project,
            scope_type="chapter",
            chapter_id="1",
            book_id=None,
            start_offset=0,
            end_offset=8,
            comment="New",
        ),
    ]
    for operation in operations:
        with pytest.raises(ManuscriptLinkError, match="disabled for linked"):
            operation()
        assert bytes_and_mtimes() == before

    deletion = asyncio.run(
        project_tools.delete_book(
            {"book_id": "one", "confirm": True}, "blocked-delete", {}, {}
        )
    )
    assert "disabled for linked" in json.dumps(deletion)
    assert bytes_and_mtimes() == before
