// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Keep saved rewind history backward compatible and reject corrupt receipts. */
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePassage } from './passageTarget';
import type { WorkshopSession } from './types';
import { isStoredWorkshop } from './workshopStorage';

let session: WorkshopSession;

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  session = {
    id: 'original',
    target: await capturePassage({
      projectId: 'fixture',
      documentId: '1',
      documentKey: 'chapter:harbour.md',
      chapterTitle: 'Harbour',
      scope: 'chapter',
      content: 'She waited.',
      selection: { anchor: 1, head: 1 },
      language: 'en',
    }),
    turns: [{ id: 'question', role: 'user', content: 'Try a quieter line.' }],
  };
});
afterEach(() => vi.unstubAllGlobals());

describe('workshop history validation', () => {
  it('retains old conversations without a cursor receipt or rewind metadata', () => {
    expect(isStoredWorkshop(session, 'fixture')).toBe(true);
    expect(isStoredWorkshop(session, 'another-project')).toBe(false);
  });

  it('accepts a rewound draft and receipt with a reversed selection', () => {
    session = {
      ...session,
      id: 'branch',
      draft: 'Try another quiet line.',
      rewoundFrom: {
        sessionId: 'original',
        turnId: 'later-question',
        messageNumber: 2,
      },
      turns: [
        {
          ...session.turns[0],
          editorPosition: {
            line: 2,
            column: 1,
            anchorLine: 3,
            anchorColumn: 4,
            selected: true,
            chapterTitle: 'Harbour',
            documentKey: 'chapter:harbour.md',
          },
        },
      ],
    };
    expect(isStoredWorkshop(JSON.parse(JSON.stringify(session)), 'fixture')).toBe(true);
  });

  it('accepts an explicit unavailable cursor receipt', () => {
    session.turns[0].editorPosition = null;
    expect(isStoredWorkshop(session, 'fixture')).toBe(true);
  });

  it.each([0, -1, 1.5, Infinity, NaN, '2', null])(
    'rejects invalid cursor coordinates (%s)',
    (line: unknown) => {
      const value = {
        ...session,
        turns: [
          {
            ...session.turns[0],
            editorPosition: {
              line,
              column: 1,
              anchorLine: 1,
              anchorColumn: 1,
              selected: false,
              chapterTitle: 'Harbour',
              documentKey: 'chapter:harbour.md',
            },
          },
        ],
      };
      expect(isStoredWorkshop(value, 'fixture')).toBe(false);
    }
  );

  it.each([
    { draft: {} },
    { rewoundFrom: { sessionId: 'original', turnId: 'q', messageNumber: 0 } },
    { rewoundFrom: { sessionId: 2, turnId: 'q', messageNumber: 2 } },
    { rewoundFrom: { sessionId: 'original', messageNumber: 2 } },
    { rewoundFrom: [] },
  ])('rejects malformed rewind metadata %j', (fields: Record<string, unknown>) => {
    expect(isStoredWorkshop({ ...session, ...fields }, 'fixture')).toBe(false);
  });
});
