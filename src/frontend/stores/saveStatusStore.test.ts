// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Defines save-status tests for scoped visibility and sticky conflicts. */

import { beforeEach, describe, expect, it } from 'vitest';

import { SaveStatus, useSaveStatusStore } from './saveStatusStore';

describe('saveStatusStore', () => {
  beforeEach(() => {
    useSaveStatusStore.setState({ entries: {} });
  });

  it('keeps statuses scoped to project and stable document key', () => {
    useSaveStatusStore.getState().setLoaded({
      projectName: 'one',
      documentKey: 'chapters/0001.txt',
      filename: '0001.txt',
      revision: 'r1',
    });
    useSaveStatusStore.getState().setLoaded({
      projectName: 'two',
      documentKey: 'chapters/0001.txt',
      filename: '0001.txt',
      revision: 'r2',
    });

    const entries = useSaveStatusStore.getState().entries;
    expect(Object.keys(entries)).toHaveLength(2);
    expect(
      Object.values(entries)
        .map((entry: SaveStatus): string | undefined => entry.revision)
        .sort()
    ).toEqual(['r1', 'r2']);
  });

  it('retains the loaded revision when a conflict is reported', () => {
    const store = useSaveStatusStore.getState();
    store.setLoaded({
      projectName: 'one',
      documentKey: 'chapters/0001.txt',
      filename: '0001.txt',
      revision: 'loaded',
    });
    store.setConflict(
      'one',
      'chapters/0001.txt',
      'Changed on disk',
      'current',
      '0001.txt',
      'books/other/chapters/0001.txt'
    );

    const status = Object.values(useSaveStatusStore.getState().entries)[0];
    expect(status.state).toBe('conflict');
    expect(status.revision).toBe('loaded');
    expect(status.currentRevision).toBe('current');
    expect(status.currentDocumentKey).toBe('books/other/chapters/0001.txt');
    expect(status.error).toBe('Changed on disk');
  });
});
