# Copyright (C) 2026 AugmentedQuill contributors
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Derive bounded, inspectable caret context from the current unsaved buffer."""

from __future__ import annotations

import hashlib
import json
import re

from augmentedquill.models.workshop import (
    WorkshopEditorSnapshot,
    WorkshopTargetSnapshot,
)
from augmentedquill.services.exceptions import BadRequestError

_MARKERS = re.compile(r"<!--\s*(?:scene|annotation):[^>]+-->", re.IGNORECASE)
_EXCERPT_CHARS = 2_000


def _position(text: str, offset: int, separator: str) -> tuple[int, int, int, int]:
    """Return line, UTF-16 column, code-point position and line start."""
    try:
        encoded = text.encode("utf-16-le")
        if offset * 2 > len(encoded):
            raise ValueError("outside buffer")
        prefix = encoded[: offset * 2].decode("utf-16-le")
    except (UnicodeError, ValueError) as exc:
        raise BadRequestError(
            "Live editor selection is not a valid UTF-16 boundary"
        ) from exc
    index = len(prefix)
    if (
        separator == "\r\n"
        and 0 < index < len(text)
        and text[index - 1 : index + 1] == separator
    ):
        raise BadRequestError("Live editor selection splits a line separator")
    start = prefix.rfind(separator)
    start = start + len(separator) if start >= 0 else 0
    return (
        prefix.count(separator) + 1,
        len(text[start:index].encode("utf-16-le")) // 2 + 1,
        index,
        start,
    )


def live_editor_context(
    snapshot: WorkshopEditorSnapshot | None, target: WorkshopTargetSnapshot
) -> str:
    """Validate the fresh snapshot and keep exact position metadata untruncated.

    Only bounded prose excerpts reach the model; the complete client buffer is
    used for position validation and its SHA-256 document version. No file is
    opened and no manuscript or project state is written.
    """
    if snapshot is None:
        return "Live editor context: unavailable for this message."
    if snapshot.project_id != target.project_id:
        raise BadRequestError("Live editor context belongs to another project")
    key = snapshot.document_key
    if (
        "\x00" in key
        or key.startswith(("/", "\\"))
        or any(part == ".." for part in re.split(r"[/\\:]", key))
    ):
        raise BadRequestError("Live editor document key must be project-relative")
    text = _MARKERS.sub("", snapshot.content)
    first_break = re.search(r"\r\n|\r|\n", text)
    separator = snapshot.line_separator or (first_break[0] if first_break else "\n")
    line, column, head, line_start = _position(text, snapshot.selection.head, separator)
    anchor_line, anchor_column, anchor, _ = _position(
        text, snapshot.selection.anchor, separator
    )
    line_end = text.find(separator, line_start)
    if line_end < 0:
        line_end = len(text)
    # A long source line may wrap many times on screen. Preserve its exact
    # number and caret column, with a bounded excerpt centred near the caret.
    excerpt_start = max(line_start, head - _EXCERPT_CHARS // 2)
    excerpt_end = min(line_end, excerpt_start + _EXCERPT_CHARS)
    selected = text[min(anchor, head) : max(anchor, head)]
    same_document = all(
        getattr(snapshot, name) == getattr(target, name)
        for name in ("project_id", "document_id", "document_key", "scope", "book_id")
    )
    payload = {
        "captured_at": "message send",
        "project_id": snapshot.project_id,
        "document_id": snapshot.document_id,
        "document_key": key,
        "scope": snapshot.scope,
        "chapter_title": snapshot.chapter_title,
        "buffer_sha256": hashlib.sha256(snapshot.content.encode("utf-8")).hexdigest(),
        "same_document_as_pinned_passage": same_document,
        "same_buffer_as_pinned_passage": same_document
        and snapshot.content == target.content,
        "line_numbering": "one-based logical editor lines; wrapped rows do not count",
        "column_numbering": "one-based UTF-16 code units",
        "caret": {"line": line, "column": column},
        "selection": {
            "active": anchor != head,
            "anchor": {"line": anchor_line, "column": anchor_column},
            "head": {"line": line, "column": column},
            "text": selected[:_EXCERPT_CHARS],
            "text_truncated": len(selected) > _EXCERPT_CHARS,
        },
        "caret_line_text": text[excerpt_start:excerpt_end],
        "caret_line_text_truncated": excerpt_start != line_start
        or excerpt_end != line_end,
        "caret_line_excerpt_start_column": len(
            text[line_start:excerpt_start].encode("utf-16-le")
        )
        // 2
        + 1,
    }
    return "Live editor context at message send (read-only):\n" + json.dumps(
        payload, ensure_ascii=False, separators=(",", ":")
    )
