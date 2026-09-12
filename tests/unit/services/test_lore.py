# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Focused invariants for deterministic lore selection and raw interchange."""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from augmentedquill.services.lore import native as native_service
from augmentedquill.services.lore import storage as storage_service
from augmentedquill.services.lore.activation import select_lore, select_project_lore
from augmentedquill.services.lore.models import (
    LoreActivation,
    LoreEntry,
    LoreScope,
    LoreStatus,
)
from augmentedquill.services.lore.native import create_native_lore, update_native_lore
from augmentedquill.services.lore.storage import (
    async_write_world_info,
    list_world_info_books,
    read_world_info,
    write_world_info,
)


class LoreSelectionTest(TestCase):
    def test_secondary_logic_and_scope_status_are_inspectable(self):
        entries = [
            LoreEntry(
                id="canon",
                name="Aelith",
                description="The archivist carries a brass key.",
                aliases=["Archivist"],
                activation=LoreActivation(
                    primary_keys=["Aelith"],
                    secondary_keys=["brass", "key"],
                    selective_logic="AND_ALL",
                    order=20,
                ),
                scope=LoreScope(chapter_start=2, chapter_end=4, viewpoint="Mara"),
            ),
            LoreEntry(
                id="belief",
                name="Rumour",
                status=LoreStatus.BELIEF,
                description="Mara believes the north gate is sealed.",
                activation=LoreActivation(primary_keys=["north gate"], order=10),
                scope=LoreScope(viewpoint="Mara"),
            ),
            LoreEntry(
                id="proposal",
                name="Unaccepted",
                status=LoreStatus.PROPOSAL,
                description="A proposed fact.",
                activation=LoreActivation(primary_keys=["Aelith"], order=1),
            ),
        ]
        result = select_lore(
            entries,
            "Aelith has a brass key. The north gate is nearby.",
            scope={"chapter_id": 3, "viewpoint": "Mara"},
            include_proposals=False,
            budget_tokens=100,
        )
        self.assertEqual([entry.id for entry in result.selected], ["canon", "belief"])
        reasons = {item.entry_id: item.reason for item in result.decisions}
        self.assertEqual(reasons["belief"], "matched")
        self.assertEqual(reasons["proposal"], "status_excluded")
        self.assertEqual(result.decisions[0].matched_primary, ["Aelith"])

    def test_all_secondary_modes_are_deterministic(self):
        modes = {
            "AND_ANY": True,
            "NOT_ALL": True,
            "NOT_ANY": False,
            "AND_ALL": False,
        }
        for mode, expected in modes.items():
            entry = LoreEntry(
                id=mode,
                name=mode,
                description="payload",
                activation=LoreActivation(
                    primary_keys=["anchor"],
                    secondary_keys=["present", "absent"],
                    selective_logic=mode,
                ),
            )
            result = select_lore([entry], "anchor present")
            self.assertEqual(bool(result.selected), expected, mode)

    def test_string_scope_ids_and_mixed_source_references_are_supported(self):
        entry = LoreEntry(
            id="scene-entry",
            name="Scene fact",
            description="A scoped fact.",
            sources=["chapter-notes.md", {"url": "https://example.test/fact"}],
            activation=LoreActivation(primary_keys=["anchor"]),
            scope=LoreScope(chapter_id="chapter-2", scene_id="scene-a"),
        )
        result = select_lore(
            [entry],
            "anchor",
            scope={"chapter_id": "chapter-2", "scene_id": "scene-a"},
        )
        self.assertEqual([selected.id for selected in result.selected], [entry.id])

    def test_timeline_position_bounds_are_inclusive(self):
        entry = LoreEntry(
            id="timeline-entry",
            name="Timeline fact",
            description="A bounded fact.",
            activation=LoreActivation(primary_keys=["anchor"]),
            scope=LoreScope(timeline_id="main", timeline_start=10, timeline_end=20),
        )
        selected = select_lore(
            [entry],
            "anchor",
            scope={"timeline_id": "main", "timeline_position": 20},
        )
        excluded = select_lore(
            [entry],
            "anchor",
            scope={"timeline_id": "main", "timeline_position": 21},
        )
        self.assertEqual([item.id for item in selected.selected], [entry.id])
        self.assertEqual(excluded.decisions[0].reason, "scope_excluded")

    def test_budget_keeps_priority_order_and_reports_overflow(self):
        entries = [
            LoreEntry(
                id="high",
                name="High",
                description="anchor " * 10,
                activation=LoreActivation(primary_keys=["anchor"], order=20),
            ),
            LoreEntry(
                id="low",
                name="Low",
                description="anchor " * 10,
                activation=LoreActivation(primary_keys=["anchor"], order=10),
            ),
        ]
        result = select_lore(entries, "anchor", budget_tokens=24)
        self.assertEqual([item.id for item in result.selected], ["high"])
        self.assertIn("budget_exceeded", [item.reason for item in result.decisions])
        self.assertTrue(result.budget_warning)


class LorePersistenceTest(TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project_dir = Path(self.temp_dir.name) / "project"
        self.project_dir.mkdir()
        (self.project_dir / "story.json").write_text(
            json.dumps(
                {
                    "metadata": {"version": 2},
                    "project_title": "Lore test",
                    "project_type": "novel",
                    "format": "markdown",
                    "sourcebook": {},
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_native_metadata_survives_rename(self):
        from augmentedquill.services.lore.models import LoreEntryCreate, LoreEntryUpdate

        created = create_native_lore(
            self.project_dir,
            LoreEntryCreate(
                name="Aelith",
                kind="character",
                status=LoreStatus.BELIEF,
                description="An archivist.",
                scope=LoreScope(chapter_start=2, viewpoint="Mara"),
            ),
        )
        updated = update_native_lore(
            self.project_dir,
            created.id,
            LoreEntryUpdate(name="Aelith Ren"),
        )
        self.assertEqual(updated.id, created.id)
        self.assertEqual(updated.status, LoreStatus.BELIEF)
        self.assertEqual(updated.scope.chapter_start, 2)
        raw_story = json.loads(
            (self.project_dir / "story.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            raw_story["sourcebook"]["Aelith Ren"]["_lore"]["entry_id"], created.id
        )

    def test_native_create_defaults_to_proposal(self):
        from augmentedquill.services.lore.models import LoreEntryCreate

        created = create_native_lore(
            self.project_dir,
            LoreEntryCreate(name="Unaccepted", description="A suggestion."),
        )

        self.assertEqual(created.status, LoreStatus.PROPOSAL)

    def test_native_create_and_update_each_replace_story_once(self):
        from augmentedquill.services.lore.models import LoreEntryCreate, LoreEntryUpdate

        with patch.object(
            native_service,
            "save_story_config",
            wraps=native_service.save_story_config,
        ) as save_story:
            created = create_native_lore(
                self.project_dir,
                LoreEntryCreate(name="One", description="First."),
            )
            self.assertEqual(save_story.call_count, 1)

            update_native_lore(
                self.project_dir,
                created.id,
                LoreEntryUpdate(description="Updated."),
            )
            self.assertEqual(save_story.call_count, 2)

    def test_native_update_preserves_unknown_sourcebook_and_lore_fields(self):
        story_path = self.project_dir / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["sourcebook"] = {
            "Aelith": {
                "description": "An archivist.",
                "category": "Character",
                "synonyms": [],
                "images": [],
                "keywords": [],
                "future_sourcebook_field": {"keep": [1, 2]},
                "_lore": {
                    "entry_id": "lore:existing",
                    "status": "canon",
                    "future_lore_field": {"keep": True},
                },
            }
        }
        story_path.write_text(json.dumps(story), encoding="utf-8")

        from augmentedquill.services.lore.models import LoreEntryUpdate

        update_native_lore(
            self.project_dir,
            "lore:existing",
            LoreEntryUpdate(description="A revised archivist."),
        )

        saved = json.loads(story_path.read_text(encoding="utf-8"))
        entry = saved["sourcebook"]["Aelith"]
        self.assertEqual(entry["future_sourcebook_field"], {"keep": [1, 2]})
        self.assertEqual(entry["_lore"]["future_lore_field"], {"keep": True})

    def test_native_update_failure_does_not_partially_write_story(self):
        from augmentedquill.services.lore.models import LoreEntryCreate, LoreEntryUpdate

        created = create_native_lore(
            self.project_dir,
            LoreEntryCreate(name="One", description="Original."),
        )
        story_path = self.project_dir / "story.json"
        before = story_path.read_bytes()
        with (
            patch.object(
                native_service,
                "save_story_config",
                side_effect=OSError("simulated story write failure"),
            ),
            self.assertRaises(OSError),
        ):
            update_native_lore(
                self.project_dir,
                created.id,
                LoreEntryUpdate(description="Should not land."),
            )
        self.assertEqual(story_path.read_bytes(), before)

    def test_world_info_writes_are_serialized_and_retain_both_index_entries(self):
        async def write_books() -> None:
            await asyncio.gather(
                async_write_world_info(
                    self.project_dir,
                    "First",
                    {"entries": {"1": {"uid": 1, "content": "one"}}},
                ),
                async_write_world_info(
                    self.project_dir,
                    "Second",
                    {"entries": {"2": {"uid": 2, "content": "two"}}},
                ),
            )

        asyncio.run(write_books())
        self.assertEqual(list_world_info_books(self.project_dir), ["First", "Second"])
        self.assertEqual(
            read_world_info(self.project_dir, "First")["entries"]["1"]["content"], "one"
        )
        self.assertEqual(
            read_world_info(self.project_dir, "Second")["entries"]["2"]["content"],
            "two",
        )

    def test_world_info_index_rejects_escape_and_symlink_targets(self):
        write_world_info(
            self.project_dir,
            "Safe",
            {"entries": {"1": {"uid": 1, "content": "safe"}}},
        )
        world_info_dir = self.project_dir / "lore" / "world-info"
        outside = self.project_dir.parent / "outside.json"
        outside.write_text('{"entries": {"x": {}}}', encoding="utf-8")
        (world_info_dir / "linked-safe.json").symlink_to(outside)
        (world_info_dir / "index.json").write_text(
            json.dumps(
                {
                    "Safe": storage_service._book_filename("Safe"),
                    "Escape": "../outside.json",
                    "Link": "linked-safe.json",
                }
            ),
            encoding="utf-8",
        )

        self.assertEqual(list_world_info_books(self.project_dir), ["Safe"])

        outside_index = self.project_dir.parent / "outside-index.json"
        outside_index.write_text(
            json.dumps({"Leaked": storage_service._book_filename("Leaked")}),
            encoding="utf-8",
        )
        (world_info_dir / "index.json").unlink()
        (world_info_dir / "index.json").symlink_to(outside_index)
        self.assertEqual(list_world_info_books(self.project_dir), [])

    def test_world_info_index_failure_keeps_previous_index_and_exact_payload(self):
        write_world_info(
            self.project_dir,
            "Existing",
            {"entries": {"1": {"uid": 1, "content": "old"}}},
        )
        replacement = {"entries": {"1": {"uid": 1, "content": "new"}}}
        original_atomic = storage_service._atomic_write_json

        def fail_index(path: Path, payload: object) -> None:
            if path.name == "index.json":
                raise OSError("simulated index interruption")
            original_atomic(path, payload)

        with (
            patch.object(storage_service, "_atomic_write_json", side_effect=fail_index),
            self.assertRaises(OSError),
        ):
            write_world_info(self.project_dir, "Existing", replacement)

        self.assertEqual(read_world_info(self.project_dir, "Existing"), replacement)
        self.assertEqual(list_world_info_books(self.project_dir), ["Existing"])

    def test_world_info_payload_replace_failure_keeps_previous_payload_and_index(self):
        original = {"entries": {"1": {"uid": 1, "content": "old"}}}
        replacement = {"entries": {"1": {"uid": 1, "content": "new"}}}
        write_world_info(self.project_dir, "Existing", original)
        world_info_dir = self.project_dir / "lore" / "world-info"
        before_files = {path.name for path in world_info_dir.iterdir()}

        with (
            patch.object(
                storage_service.os,
                "replace",
                side_effect=OSError("simulated payload interruption"),
            ),
            self.assertRaises(OSError),
        ):
            write_world_info(self.project_dir, "Existing", replacement)

        self.assertEqual(read_world_info(self.project_dir, "Existing"), original)
        self.assertEqual(list_world_info_books(self.project_dir), ["Existing"])
        self.assertEqual(
            {path.name for path in world_info_dir.iterdir()},
            before_files,
        )

    def test_world_info_roundtrip_preserves_unknown_fields(self):
        payload = {
            "name": "Pinned",
            "custom_top_level": {"keep": [1, 2]},
            "entries": {
                "17": {
                    "uid": 17,
                    "key": ["Aelith"],
                    "content": "An archivist.",
                    "extensions": {"future_flag": True},
                    "unknown_entry_field": "preserve",
                }
            },
        }
        write_world_info(self.project_dir, "Pinned", payload)
        self.assertEqual(read_world_info(self.project_dir, "Pinned"), payload)

    def test_pinned_world_info_fixture_roundtrips_and_warns(self):
        fixture = (
            Path(__file__).parents[2]
            / "fixtures"
            / "lore"
            / "sillytavern-world-info.json"
        )
        payload = json.loads(fixture.read_text(encoding="utf-8"))
        write_world_info(self.project_dir, "Pinned fixture", payload)
        self.assertEqual(read_world_info(self.project_dir, "Pinned fixture"), payload)
        result = select_project_lore(self.project_dir, "Aelith has a brass key.")
        self.assertIn(
            "Pinned fixture:17:extensions.probability", result.unsupported_options
        )

    def test_world_info_entry_recursion_flag_is_reported_unsupported(self):
        write_world_info(
            self.project_dir,
            "Recursive",
            {
                "entries": {
                    "1": {
                        "uid": 1,
                        "key": ["anchor"],
                        "content": "A recursive fact.",
                        "recursive": True,
                    }
                }
            },
        )

        result = select_project_lore(self.project_dir, "anchor")

        self.assertIn("Recursive:1:recursive", result.unsupported_options)

    def test_project_selection_includes_native_and_world_info(self):
        from augmentedquill.services.lore.models import LoreEntryCreate

        create_native_lore(
            self.project_dir,
            LoreEntryCreate(
                name="Aelith",
                kind="character",
                status=LoreStatus.CANON,
                description="Native archivist.",
            ),
        )
        write_world_info(
            self.project_dir,
            "Imported",
            {
                "entries": {
                    "1": {"uid": 1, "key": ["brass key"], "content": "Imported fact."}
                }
            },
        )
        before = (self.project_dir / "story.json").read_bytes()
        result = select_project_lore(self.project_dir, "Aelith finds a brass key.")
        self.assertEqual(
            {entry.name for entry in result.selected}, {"Aelith", "brass key"}
        )
        self.assertEqual((self.project_dir / "story.json").read_bytes(), before)
