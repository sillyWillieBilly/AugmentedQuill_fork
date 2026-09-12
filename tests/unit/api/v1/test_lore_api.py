# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""API contract tests for project-scoped lore operations."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest import TestCase

from fastapi import FastAPI
from fastapi.testclient import TestClient

from augmentedquill.api.v1.dependencies import require_project_path
from augmentedquill.api.v1.lore import router


class LoreApiTest(TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project_dir = Path(self.temp_dir.name) / "project"
        self.project_dir.mkdir()
        (self.project_dir / "story.json").write_text(
            json.dumps(
                {
                    "metadata": {"version": 2},
                    "project_title": "Lore API",
                    "project_type": "novel",
                    "format": "markdown",
                    "sourcebook": {},
                }
            ),
            encoding="utf-8",
        )
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[require_project_path] = lambda: self.project_dir
        self.client = TestClient(app)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_native_crud_and_selection(self):
        response = self.client.post(
            "/projects/demo/lore",
            json={
                "name": "Aelith",
                "kind": "character",
                "status": "canon",
                "description": "A traveling archivist.",
                "aliases": ["Archivist"],
                "scope": {"chapter_start": 2, "viewpoint": "Mara"},
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        created = response.json()
        self.assertTrue(created["id"].startswith("lore:"))

        selected = self.client.post(
            "/projects/demo/lore/select",
            json={
                "scan_text": "Aelith enters.",
                "scope": {"chapter_id": 3, "viewpoint": "Mara"},
            },
        )
        self.assertEqual(selected.status_code, 200, selected.text)
        self.assertEqual(
            [entry["name"] for entry in selected.json()["selected"]], ["Aelith"]
        )

        updated = self.client.put(
            f"/projects/demo/lore/{created['id']}",
            json={"name": "Aelith Ren", "status": "belief"},
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["name"], "Aelith Ren")
        self.assertEqual(updated.json()["status"], "belief")

    def test_native_create_without_status_is_a_proposal(self):
        response = self.client.post(
            "/projects/demo/lore",
            json={"name": "Unaccepted", "description": "A suggestion."},
        )

        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["status"], "proposal")

    def test_world_info_import_export_and_warnings(self):
        payload = {
            "custom": {"preserve": True},
            "entries": {
                "17": {
                    "uid": 17,
                    "key": ["Aelith"],
                    "content": "Imported fact.",
                    "probability": 25,
                    "extensions": {"future_flag": True},
                }
            },
        }
        imported = self.client.post(
            "/projects/demo/lore/world-info/Pinned", json=payload
        )
        self.assertEqual(imported.status_code, 200, imported.text)
        self.assertIn("Pinned:17:probability", imported.json()["unsupported_options"])

        exported = self.client.get("/projects/demo/lore/world-info/Pinned")
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertEqual(exported.json(), payload)

        books = self.client.get("/projects/demo/lore/world-info")
        self.assertEqual(books.status_code, 200, books.text)
        self.assertEqual(books.json()[0]["name"], "Pinned")
