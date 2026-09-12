# Copyright (C) 2026 AugmentedQuill contributors
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Fresh editor identity, UTF-16 positions, bounded prose and legacy requests."""

import hashlib
import json

import pytest

from augmentedquill.models.workshop import (
    WorkshopEditorSnapshot,
    WorkshopTargetSnapshot,
)
from augmentedquill.services.exceptions import BadRequestError
from augmentedquill.services.workshop.editor_context import live_editor_context


def target():
    return WorkshopTargetSnapshot.model_validate(
        {
            "projectId": "fixture",
            "documentId": "1",
            "documentKey": "chapters/one.md",
            "chapterTitle": "Harbour",
            "scope": "chapter",
            "content": "Pinned.",
            "from": 0,
            "to": 7,
            "rawFrom": 0,
            "rawTo": 7,
            "originalText": "Pinned.",
            "fingerprint": hashlib.sha256(b"Pinned.").hexdigest(),
        }
    )


def snapshot(text, head=0, anchor=None, **extra):
    return WorkshopEditorSnapshot.model_validate(
        {
            "projectId": "fixture",
            "documentId": "1",
            "documentKey": "chapters/one.md",
            "chapterTitle": "Harbour",
            "scope": "chapter",
            "content": text,
            "selection": {"head": head, "anchor": head if anchor is None else anchor},
            **extra,
        }
    )


def payload(editor):
    return json.loads(live_editor_context(editor, target()).split("\n", 1)[1])


def utf16(text):
    return len(text.encode("utf-16-le")) // 2


@pytest.mark.parametrize("separator", ["\n", "\r\n", "\r"])
def test_unicode_lines_reverse_selection_and_exact_buffer_identity(separator):
    text = separator.join(["\ufeff# Heading", "", "🌊 Cafe\u0301. 潮水", "Last line."])
    result = payload(
        snapshot(
            text, utf16(text[: text.index("潮")]), utf16(text), lineSeparator=separator
        )
    )
    assert result["caret"] == {"line": 3, "column": 11}
    assert result["selection"]["anchor"] == {"line": 4, "column": 11}
    assert result["selection"]["text"] == "潮水" + separator + "Last line."
    assert result["selection"]["active"]
    assert result["same_document_as_pinned_passage"]
    assert not result["same_buffer_as_pinned_passage"]
    assert result["buffer_sha256"] == hashlib.sha256(text.encode()).hexdigest()


def test_markers_and_mixed_line_endings_follow_editor_separator():
    text = "<!--scene:s:start-->One\r\nTwo\nThree\r\nFour<!--scene:s:end-->"
    result = payload(snapshot(text, 9, lineSeparator="\r\n"))
    assert result["caret"] == {"line": 2, "column": 5}
    assert result["caret_line_text"] == "Two\nThree"


def test_another_chapter_is_explicit_and_pinned_target_does_not_supply_caret():
    result = payload(
        snapshot(
            "Different chapter.\nCurrent line.",
            19,
            documentId="2",
            documentKey="chapters/two.md",
            chapterTitle="Forest",
        )
    )
    assert result["chapter_title"] == "Forest"
    assert result["caret"] == {"line": 2, "column": 1}
    assert result["caret_line_text"] == "Current line."
    assert not result["same_document_as_pinned_passage"]


def test_long_wrapped_source_line_and_selection_have_bounded_excerpts():
    result = payload(snapshot("x" * 100_000, 70_000, 0))
    assert result["caret"] == {"line": 1, "column": 70_001}
    assert len(result["caret_line_text"]) == 2_000
    assert result["caret_line_text_truncated"]
    assert result["caret_line_excerpt_start_column"] == 69_001
    assert len(result["selection"]["text"]) == 2_000
    assert result["selection"]["text_truncated"]


def test_missing_context_empty_buffer_and_final_newline():
    assert "unavailable" in live_editor_context(None, target())
    assert payload(snapshot(""))["caret"] == {"line": 1, "column": 1}
    assert payload(snapshot("One\n", 4))["caret"] == {"line": 2, "column": 1}


@pytest.mark.parametrize(
    "editor",
    [
        snapshot("🌊", 1),
        snapshot("A\r\nB", 2),
        snapshot("A", 2),
        snapshot("A", projectId="other"),
        snapshot("A", documentKey="../one.md"),
    ],
)
def test_invalid_boundaries_and_identity_are_rejected(editor):
    with pytest.raises(BadRequestError):
        live_editor_context(editor, target())
