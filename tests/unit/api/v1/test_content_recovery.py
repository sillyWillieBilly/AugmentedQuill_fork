# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""API invariants for project-contained content recovery."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest import TestCase

from fastapi import FastAPI
from fastapi.testclient import TestClient

from augmentedquill.api.v1.content_recovery import router
from augmentedquill.api.v1.dependencies import require_project_path
from augmentedquill.services.projects.content_persistence import (
    read_chapter_content_snapshot,
    save_chapter_content_in_project,
)


class ContentRecoveryApiTest(TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project = Path(self.temp_dir.name) / "project"
        (self.project / "chapters").mkdir(parents=True)
        (self.project / "chapters" / "0001.txt").write_text("Before", encoding="utf-8")
        (self.project / "story.json").write_text(
            json.dumps(
                {
                    "metadata": {"version": 2},
                    "project_type": "novel",
                    "chapters": [{"title": "One", "filename": "0001.txt"}],
                }
            ),
            encoding="utf-8",
        )
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[require_project_path] = lambda: self.project
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_list_read_and_guarded_restore(self) -> None:
        loaded = read_chapter_content_snapshot(self.project, 1)
        saved = save_chapter_content_in_project(
            self.project,
            1,
            "After",
            expected_revision=loaded.revision,
            expected_document_key=loaded.document_key,
        )

        listing = self.client.get("/projects/demo/content-recovery")
        self.assertEqual(listing.status_code, 200, listing.text)
        records = listing.json()["records"]
        self.assertEqual(len(records), 1)
        recovery_id = records[0]["recovery_id"]

        detail = self.client.get(f"/projects/demo/content-recovery/{recovery_id}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["before_content"], "Before")
        self.assertEqual(detail.json()["after_content"], "After")

        restored = self.client.post(
            f"/projects/demo/content-recovery/{recovery_id}/restore",
            json={
                "target": "before",
                "expected_revision": saved.revision,
                "expected_document_key": saved.document_key,
                "expected_filename": saved.filename,
            },
        )
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(restored.json()["content"], "Before")

    def test_restore_rejects_stale_current_base(self) -> None:
        loaded = read_chapter_content_snapshot(self.project, 1)
        saved = save_chapter_content_in_project(
            self.project,
            1,
            "After",
            expected_revision=loaded.revision,
            expected_document_key=loaded.document_key,
        )
        record = self.client.get("/projects/demo/content-recovery").json()["records"][0]

        external = save_chapter_content_in_project(
            self.project,
            1,
            "External",
            expected_revision=saved.revision,
            expected_document_key=saved.document_key,
        )
        self.assertEqual(external.content, "External")

        restore = self.client.post(
            f"/projects/demo/content-recovery/{record['recovery_id']}/restore",
            json={
                "target": "before",
                "expected_revision": saved.revision,
                "expected_document_key": saved.document_key,
            },
        )
        self.assertEqual(restore.status_code, 409, restore.text)
        self.assertEqual(restore.json()["content"], "External")

    def test_invalid_recovery_id_is_contained(self) -> None:
        response = self.client.get("/projects/demo/content-recovery/../story.json")
        self.assertIn(response.status_code, {400, 404})
