// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Prove local recovery survives navigation and older save acknowledgements. */
// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAcknowledgedDraft,
  readLocalDraft,
  writeLocalDraft,
  type LocalDraft,
} from './localDraft';
import { manuscriptFingerprint } from '../workshop/passageTarget';

const draft: LocalDraft = {
  projectId: 'book',
  documentKey: 'chapters/1.md',
  content: '🌊 Tide.\r\n<!--scene:1:start-->Water.<!--scene:1:end-->',
  baseRevision: 'original',
  updatedAt: '2026-09-12T12:00:00Z',
};
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('local draft recovery', () => {
  it('retains raw Unicode and line endings under exact project/document identity', () => {
    expect(writeLocalDraft(draft)).toBe(true);
    expect(readLocalDraft('book', 'chapters/1.md')).toEqual(draft);
    expect(readLocalDraft('other', 'chapters/1.md')).toBeNull();
    expect(readLocalDraft('book', 'books/other/chapters/1.md')).toBeNull();
  });
  it('does not remove a newer buffer on an older server acknowledgement', async () => {
    const revision = await manuscriptFingerprint(draft.content);
    writeLocalDraft({ ...draft, content: `${draft.content} Newer prose.` });
    await clearAcknowledgedDraft(draft.projectId, draft.documentKey, revision);
    expect(readLocalDraft(draft.projectId, draft.documentKey)?.content).toContain(
      'Newer prose.'
    );
    writeLocalDraft(draft);
    await clearAcknowledgedDraft(draft.projectId, draft.documentKey, revision);
    expect(readLocalDraft(draft.projectId, draft.documentKey)).toBeNull();
  });
  it('reports storage failure and ignores malformed recovery data', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(writeLocalDraft(draft)).toBe(false);
    expect(readLocalDraft('book', 'chapters/1.md')).toBeNull();
  });
});
