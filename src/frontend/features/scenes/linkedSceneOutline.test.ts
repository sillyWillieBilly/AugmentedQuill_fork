// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Keep linked outlines grounded in explicit, correctly positioned source divisions. */

import { describe, expect, it } from 'vitest';
import { stripInlineInternalMarkers } from '../editor/internalTags';
import { parseLinkedSceneOutline, type LinkedOutlineEntry } from './linkedSceneOutline';

describe('parseLinkedSceneOutline', () => {
  it('keeps blank paragraphs as one opening and omits the initial chapter H1', () => {
    expect(
      parseLinkedSceneOutline('# Chapter 5\n\nFirst paragraph.\n\nSecond paragraph.')
    ).toEqual([
      {
        kind: 'opening',
        title: '',
        offset: 0,
        line: 1,
        excerpt: 'First paragraph. Second paragraph.',
      },
    ]);
  });

  it.each(['\n', '\r\n', '\r'])(
    'finds headings, all explicit scene breaks, and scene starts with %j',
    (separator: string) => {
      const source = [
        '\uFEFF# Chapter title',
        '',
        '🌊 Café opening.',
        '',
        '## Arrival ###',
        'She arrived.',
        '* * *',
        'She waited.',
        '---',
        'The tide rose.',
        '_ _ _',
        '<!--annotation:note:start--><!--scene:harbour:start-->🌊 The quay.',
        '<!--scene:harbour:end--><!--annotation:note:end-->',
        '# Later heading',
        'End.',
      ].join(separator);
      const entries = parseLinkedSceneOutline(source, separator);
      expect(
        entries.map(({ kind, title, line }: LinkedOutlineEntry) => ({
          kind,
          title,
          line,
        }))
      ).toEqual([
        { kind: 'opening', title: '', line: 1 },
        { kind: 'heading', title: 'Arrival', line: 5 },
        { kind: 'break', title: '', line: 7 },
        { kind: 'break', title: '', line: 9 },
        { kind: 'break', title: '', line: 11 },
        { kind: 'scene', title: 'harbour', line: 12 },
        { kind: 'heading', title: 'Later heading', line: 14 },
      ]);
      const visible = stripInlineInternalMarkers(source);
      expect(entries[0].offset).toBe(1);
      expect(entries[1].offset).toBe(visible.indexOf('## Arrival'));
      expect(entries[5].offset).toBe(visible.indexOf('🌊 The quay.'));
      expect(entries[5].excerpt).toBe('🌊 The quay.');
    }
  );

  it('ignores fenced examples including markers and shorter or wrong fence closers', () => {
    const source = [
      '# Chapter',
      '````md',
      '### Example',
      '***',
      '<!--scene:fake:start-->',
      '```',
      '~~~',
      '## Still code',
      '````',
      '## Real heading',
      '~~~',
      '---',
      '<!--scene:fake2:start-->',
      '~~~',
      '___',
      'Last paragraph.',
    ].join('\n');
    expect(
      parseLinkedSceneOutline(source).map(
        ({ kind, title, line }: LinkedOutlineEntry) => ({
          kind,
          title,
          line,
        })
      )
    ).toEqual([
      { kind: 'opening', title: '', line: 1 },
      { kind: 'heading', title: 'Real heading', line: 10 },
      { kind: 'break', title: '', line: 15 },
    ]);
  });

  it('requires actual ATX headings or a thematic break rather than lookalike text', () => {
    const source =
      '#No space\n    ## Indented code\n* - *\n- -\n**bold**\n    ***\n###';
    expect(
      parseLinkedSceneOutline(source).map(({ kind, line }: LinkedOutlineEntry) => ({
        kind,
        line,
      }))
    ).toEqual([
      { kind: 'opening', line: 1 },
      { kind: 'heading', line: 7 },
    ]);
  });

  it('uses configured logical line separators for mixed newline content', () => {
    const source = '# Chapter\r\nFirst\nraw newline.\r\n## Arrival\r\n🌊';
    const entry = parseLinkedSceneOutline(source, '\r\n')[1];
    expect(entry.line).toBe(3);
    expect(entry.offset).toBe(source.indexOf('## Arrival'));
  });

  it.each(['', "<div style='page-break-after: always;'></div>"])(
    'does not invent a scene after a closing export divider: %j',
    (footer: string) => {
      const source = `# Chapter\r\n\r\nFinal paragraph.\r\n\r\n---\r\n\r\n${footer}\r\n`;
      expect(
        parseLinkedSceneOutline(source).map((entry: LinkedOutlineEntry) => entry.kind)
      ).toEqual(['opening']);
    }
  );
});
