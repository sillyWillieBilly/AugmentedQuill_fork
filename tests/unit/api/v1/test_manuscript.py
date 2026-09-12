# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""HTTP contract tests for linked Markdown projects."""

from pathlib import Path

from augmentedquill.services.projects.projects import select_project
from tests.unit.api.v1.api_test_case import ApiTestCase


class ManuscriptApiTest(ApiTestCase):
    def test_link_read_chapter_and_guarded_write_target_external_file(self) -> None:
        ok, message = select_project("linked-book")
        self.assertTrue(ok, message)
        source = Path(self.td.name) / "source"
        source.mkdir()
        (source / "chapter-01.md").write_text("Original prose", encoding="utf-8")
        (source / "chapter-02-new.md").write_text("New draft", encoding="utf-8")

        response = self.client.post(
            "/api/v1/projects/linked-book/manuscript/link",
            json={
                "source_root": str(source),
                "files": ["chapter-01.md", "chapter-02-new.md"],
                "excluded": [
                    {
                        "source": "chapter-02-new.md",
                        "status": "reference-copy",
                        "role": "reference",
                        "unknown": {"keep": True},
                    }
                ],
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        manifest = response.json()
        self.assertEqual(manifest["kind"], "augmentedquill-linked-manuscript")
        self.assertEqual(manifest["entries"][1]["source"], "chapter-02-new.md")
        self.assertEqual(manifest["excluded"][0]["unknown"], {"keep": True})

        chapters = self.client.get("/api/v1/projects/linked-book/chapters")
        self.assertEqual(chapters.status_code, 200, chapters.text)
        chapter_list = chapters.json()["chapters"]
        self.assertEqual([item["id"] for item in chapter_list], [1, 2])
        self.assertEqual(
            chapter_list[0]["source_path"], str((source / "chapter-01.md").resolve())
        )
        self.assertEqual(chapter_list[1]["manuscript_status"], "active")
        self.assertTrue(chapter_list[0]["document_key"].startswith("linked:"))

        detail = self.client.get("/api/v1/projects/linked-book/chapters/1")
        self.assertEqual(detail.status_code, 200, detail.text)
        snapshot = detail.json()
        changed = self.client.put(
            "/api/v1/projects/linked-book/chapters/1/content",
            json={
                "content": "Edited prose",
                "expected_revision": snapshot["revision"],
                "expected_document_key": snapshot["document_key"],
            },
        )
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(
            (source / "chapter-01.md").read_text(encoding="utf-8"), "Edited prose"
        )

        create = self.client.post(
            "/api/v1/projects/linked-book/chapters",
            json={"title": "Must stay external"},
        )
        self.assertEqual(create.status_code, 403, create.text)
        delete = self.client.delete("/api/v1/projects/linked-book/chapters/1")
        self.assertEqual(delete.status_code, 403, delete.text)
        reorder = self.client.post(
            "/api/v1/projects/linked-book/chapters/reorder",
            json={"chapter_ids": [2, 1]},
        )
        self.assertEqual(reorder.status_code, 403, reorder.text)
        convert = self.client.post(
            "/api/v1/projects/convert", json={"target_type": "short-story"}
        )
        self.assertEqual(convert.status_code, 403, convert.text)
        for method, path in [
            ("POST", "/api/v1/chat"),
            ("POST", "/api/v1/chapters/reorder"),
            ("PUT", "/api/v1/projects/linked-book/story/content"),
            ("POST", "/api/v1/projects/linked-book/story/write"),
            ("POST", "/api/v1/projects/linked-book/checkpoints/restore"),
            ("POST", "/api/v1/projects/linked-book/annotations"),
            ("PUT", "/api/v1/projects/linked-book/scenes/1"),
            ("POST", "/api/v1/projects/linked-book/chat/tools/execute"),
            ("POST", "/api/v1/books/delete"),
        ]:
            blocked = self.client.request(method, path, json={})
            self.assertEqual(blocked.status_code, 403, (path, blocked.text))
        selected = self.client.post(
            "/api/v1/projects/select", json={"name": "linked-book"}
        )
        self.assertEqual(selected.status_code, 200, selected.text)
        self.assertEqual(selected.json()["story"]["storage_mode"], "linked-markdown")
        self.assertEqual(selected.json()["story"]["source_root"], str(source))
        self.assertEqual(
            (source / "chapter-01.md").read_text(encoding="utf-8"), "Edited prose"
        )

    def test_link_rejects_path_traversal_without_touching_source(self) -> None:
        ok, message = select_project("linked-reject")
        self.assertTrue(ok, message)
        source = Path(self.td.name) / "source"
        source.mkdir()
        (source / "chapter.md").write_text("Untouched", encoding="utf-8")
        response = self.client.post(
            "/api/v1/projects/linked-reject/manuscript/link",
            json={"source_root": str(source), "files": ["../source/chapter.md"]},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            (source / "chapter.md").read_text(encoding="utf-8"), "Untouched"
        )
