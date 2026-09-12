// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Match send-time caret receipts to CodeMirror's logical line model. */
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { editorPosition } from './editorContext';
import type { PassageSnapshot } from './passageTarget';

function snapshot(
  content: string,
  head: number,
  anchor: number = head,
  lineSeparator?: string
): PassageSnapshot {
  return {
    projectId: 'fixture',
    documentId: '1',
    documentKey: 'chapters/one.md',
    chapterTitle: 'Harbour',
    scope: 'chapter',
    language: 'en',
    content,
    selection: { anchor, head },
    lineSeparator,
  };
}

describe('editorPosition', () => {
  it.each(['\n', '\r\n', '\r'])(
    'matches CodeMirror for %j, Unicode and a backwards selection',
    (separator: string) => {
      const lines = ['\ufeff# Heading', '', '🌊 Cafe\u0301. 潮水', 'Last line.'];
      const source = lines.join(separator);
      const head = source.indexOf('潮');
      const state = EditorState.create({
        doc: source,
        extensions: EditorState.lineSeparator.of(separator),
      });
      const cmHead = lines[0].length + 2 + lines[2].indexOf('潮');
      const cmLine = state.doc.lineAt(cmHead);
      expect(editorPosition(snapshot(source, head, source.length, separator))).toEqual({
        line: cmLine.number,
        column: cmHead - cmLine.from + 1,
        anchorLine: 4,
        anchorColumn: 11,
        selected: true,
        chapterTitle: 'Harbour',
        documentKey: 'chapters/one.md',
      });
    }
  );

  it('counts the configured separator for mixed source endings, as CodeMirror does', () => {
    const text = 'One\r\nTwo\nThree\r\nFour';
    expect(
      editorPosition(snapshot(text, text.indexOf('Three'), 0, '\r\n'))
    ).toMatchObject({ line: 2, column: 5 });
  });

  it('strips hidden internal markers without counting wrapped rows', () => {
    const text =
      '<!--scene:s:start-->Long '.repeat(1) +
      'line '.repeat(600) +
      '<!--scene:s:end-->\nEnd';
    expect(editorPosition(snapshot(text, 2999))).toMatchObject({
      line: 1,
      column: 3000,
      selected: false,
    });
  });

  it('supports empty buffers and a caret at the final newline', () => {
    expect(editorPosition(snapshot('', 0))).toMatchObject({ line: 1, column: 1 });
    expect(editorPosition(snapshot('One\n', 4))).toMatchObject({ line: 2, column: 1 });
  });

  it('does not invent a position for unavailable or invalid editor snapshots', () => {
    expect(editorPosition(null)).toBeNull();
    for (const value of [
      snapshot('🌊', 1),
      snapshot('A\r\nB', 2),
      snapshot('A', 2),
      snapshot('A', -1),
      snapshot('A', 0.5),
    ]) {
      expect(editorPosition(value)).toBeNull();
    }
  });
});
