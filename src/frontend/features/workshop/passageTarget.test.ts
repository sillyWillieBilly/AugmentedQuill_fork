// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Verify exact workshop targeting and checked replacement invariants. */
// @vitest-environment jsdom

import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { stripInlineInternalMarkers } from '../editor/internalTags';
import {
  capturePassage,
  planPassageReplacement,
  type PassageSnapshot,
} from './passageTarget';

beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

function snapshot(
  content: string,
  anchor: number,
  head: number = anchor
): PassageSnapshot {
  return {
    projectId: 'fixture',
    documentId: '1',
    documentKey: 'chapter:chapter-1.md',
    chapterTitle: 'The harbour',
    scope: 'chapter',
    content,
    selection: { anchor, head },
    language: 'en',
  };
}

describe('capturePassage', () => {
  it('targets the sentence containing the caret, not the first identical sentence', async () => {
    const text = 'He waited. The tide rose. He waited.';
    const target = await capturePassage(snapshot(text, text.length - 3));
    expect(target.originalText).toBe('He waited.');
    expect(target.from).toBe(text.lastIndexOf('He waited.'));
    expect(target.kind).toBe('sentence');
    expect(target.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps explicit reversed selections exact, including whitespace', async () => {
    const target = await capturePassage(snapshot('One.  Two. Three.', 10, 4));
    expect(target.originalText).toBe('  Two.');
    expect(target.kind).toBe('selection');
  });

  it('shows a paragraph fallback for prose without sentence punctuation', async () => {
    const target = await capturePassage(
      snapshot('A heading\n\nA thought without an ending', 18)
    );
    expect(target.originalText).toBe('A thought without an ending');
    expect(target.kind).toBe('paragraph');
  });

  it('allows explicit paragraph expansion at the same caret', async () => {
    const target = await capturePassage(
      snapshot('One. Two.\n\nThree.', 6),
      'paragraph'
    );
    expect(target.originalText).toBe('One. Two.');
    expect(target.kind).toBe('paragraph');
  });

  it('uses UTF-16 offsets without normalizing emoji, combining marks or CJK', async () => {
    const text = '🌊 Cafe\u0301. 潮水升起。';
    const start = text.indexOf('潮');
    const target = await capturePassage(snapshot(text, start, text.length));
    expect(target.from).toBe(start);
    expect(target.originalText).toBe('潮水升起。');
    const edit = planPassageReplacement(snapshot(text, 0), target, '潮水退去。');
    expect(edit.content).toBe('🌊 Cafe\u0301. 潮水退去。');
  });

  it('rejects ranges inside a Unicode grapheme instead of corrupting it', async () => {
    await expect(capturePassage(snapshot('🌊 Tide.', 1, 3))).rejects.toThrow();
    await expect(capturePassage(snapshot('Cafe\u0301.', 0, 4))).rejects.toThrow();
  });

  it('maps marker boundaries to prose, preserving the exact raw range', async () => {
    const raw = '<!--scene:s:start-->Wait here.<!--scene:s:end-->';
    const target = await capturePassage(snapshot(raw, 5));
    expect(target.originalText).toBe('Wait here.');
    expect(raw.slice(target.rawFrom, target.rawTo)).toBe('Wait here.');
    expect(target.sceneId).toBe('s');
  });
});

describe('planPassageReplacement', () => {
  it('changes only the second repeated sentence and keeps prefix/suffix bytes', async () => {
    const text = 'Wait here.\n\nWait here.\n\nLeave later.';
    const source = snapshot(text, text.indexOf('Wait here.', 1) + 2);
    const target = await capturePassage(source);
    const edit = planPassageReplacement(source, target, 'Stay with me.');
    expect(edit.content).toBe('Wait here.\n\nStay with me.\n\nLeave later.');
  });

  it('preserves enclosing and internal annotation/scene markers', async () => {
    const raw =
      '<!--scene:s:start-->She <!--annotation:a:start-->waited<!--annotation:a:end--> here.<!--scene:s:end-->';
    const source = snapshot(raw, 0, 'She waited here.'.length);
    const target = await capturePassage(source);
    const edit = planPassageReplacement(source, target, 'She lingered by the sea.');
    expect(stripInlineInternalMarkers(edit.content)).toBe('She lingered by the sea.');
    for (const marker of raw.match(/<!--.*?-->/g) ?? []) {
      expect(edit.content.split(marker)).toHaveLength(2);
    }
    expect(edit.content.startsWith('<!--scene:s:start-->')).toBe(true);
    expect(edit.content.endsWith('<!--scene:s:end-->')).toBe(true);
  });

  it('retains a proposal but rejects any intervening document change', async () => {
    const source = snapshot('She waited. He left.', 3);
    const target = await capturePassage(source);
    expect(() =>
      planPassageReplacement(
        { ...source, content: 'She waited. He stayed.' },
        target,
        'She ran.'
      )
    ).toThrow('changed');
    expect(target.originalText).toBe('She waited.');
  });

  it('rejects another project, chapter, or filename even with identical prose', async () => {
    const source = snapshot('She waited.', 3);
    const target = await capturePassage(source);
    for (const changed of [
      { projectId: 'other' },
      { documentId: '2' },
      { documentKey: 'chapter:other.md' },
    ]) {
      expect(() =>
        planPassageReplacement({ ...source, ...changed }, target, 'She ran.')
      ).toThrow('document');
    }
  });

  it('rejects generated structural markers', async () => {
    const source = snapshot('She waited.', 3);
    const target = await capturePassage(source);
    expect(() =>
      planPassageReplacement(source, target, '<!--scene:new:start-->She ran.')
    ).toThrow('markers');
  });

  it('rejects a server proposal whose UTF-16 anchors split a grapheme', async () => {
    const source = snapshot('🌊 Tide.', 3);
    const target = await capturePassage(source);
    const malformed = {
      ...target,
      from: 0,
      to: 1,
      rawFrom: 0,
      rawTo: 1,
      originalText: source.content.slice(0, 1),
    };
    expect(() => planPassageReplacement(source, malformed, 'Water.')).toThrow('range');
  });

  it('rejects raw anchors that do not correspond to visible UTF-16 anchors', async () => {
    const content = '<!--scene:s:start-->She waited.<!--scene:s:end-->';
    const source = snapshot(content, 3);
    const target = await capturePassage(source);
    const malformed = { ...target, rawFrom: target.rawFrom - 1 };
    expect(() => planPassageReplacement(source, malformed, 'She ran.')).toThrow(
      'range'
    );
  });
});
