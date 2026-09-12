// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Describe the live caret separately from the immutable proposal target. */
import { stripInlineInternalMarkers } from '../editor/internalTags';
import type { PassageSnapshot } from './passageTarget';

export interface EditorPosition {
  line: number;
  column: number;
  anchorLine: number;
  anchorColumn: number;
  selected: boolean;
  chapterTitle: string;
  documentKey: string;
}

/** One-based CodeMirror logical lines and UTF-16 columns, captured at send time. */
export function editorPosition(
  snapshot: PassageSnapshot | null
): EditorPosition | null {
  if (!snapshot) return null;
  const text = stripInlineInternalMarkers(snapshot.content);
  const separator = snapshot.lineSeparator ?? text.match(/\r\n|\r|\n/)?.[0] ?? '\n';
  if (!['\n', '\r\n', '\r'].includes(separator)) return null;
  const { anchor, head } = snapshot.selection;
  const position = (offset: number): { line: number; column: number } | null => {
    if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return null;
    // A browser caret cannot split an astral character or a configured CRLF.
    if (
      offset > 0 &&
      offset < text.length &&
      /[\uD800-\uDBFF]/u.test(text[offset - 1]) &&
      /[\uDC00-\uDFFF]/u.test(text[offset])
    )
      return null;
    let line = 1;
    let start = 0;
    for (
      let next = text.indexOf(separator);
      next >= 0;
      next = text.indexOf(separator, start)
    ) {
      if (next >= offset) break;
      if (next + separator.length > offset) return null;
      start = next + separator.length;
      line++;
    }
    return { line, column: offset - start + 1 };
  };
  const caret = position(head);
  const origin = position(anchor);
  if (!caret || !origin) return null;
  return {
    ...caret,
    anchorLine: origin.line,
    anchorColumn: origin.column,
    selected: anchor !== head,
    chapterTitle: snapshot.chapterTitle,
    documentKey: snapshot.documentKey,
  };
}
