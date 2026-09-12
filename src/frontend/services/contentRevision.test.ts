// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Defines content revision tests for save ordering and conflict metadata. */

import { describe, expect, it } from 'vitest';

import { ApiRequestError } from './apiClients/shared';
import {
  contentDocumentKey,
  contentSaveFailure,
  enqueueContentSave,
  invalidateContentSaves,
} from './contentRevision';

describe('content revision helpers', () => {
  it('uses project and document identity as a collision-free queue key', () => {
    expect(contentDocumentKey('book', 'chapters/0001.txt')).not.toBe(
      contentDocumentKey('book', 'chapters/0002.txt')
    );
    expect(contentDocumentKey('book', 'a\u0000b')).not.toBe(
      contentDocumentKey('book\u0000a', 'b')
    );
  });

  it('serializes saves per document and starts the next after completion', async () => {
    let releaseFirst: (() => void) | undefined;
    const calls: string[] = [];
    const first = enqueueContentSave('same', async () => {
      calls.push('first');
      await new Promise<void>((resolve: () => void) => {
        releaseFirst = (): void => resolve();
      });
      return 'one';
    });
    const second = enqueueContentSave('same', async () => {
      calls.push('second');
      return 'two';
    });

    await new Promise<void>((resolve: () => void) => setTimeout(resolve, 0));
    expect(calls).toEqual(['first']);
    releaseFirst?.();
    await expect(first).resolves.toBe('one');
    await expect(second).resolves.toBe('two');
    expect(calls).toEqual(['first', 'second']);
  });

  it('preserves status and payload when a save returns 409', () => {
    const failure = contentSaveFailure(
      new ApiRequestError('changed on disk', 409, {
        revision: 'new-revision',
        filename: '0001.txt',
        content: 'External text',
      })
    );
    expect(failure).toEqual({
      status: 409,
      message: 'changed on disk',
      payload: {
        revision: 'new-revision',
        filename: '0001.txt',
        content: 'External text',
      },
    });
  });

  it('skips queued work invalidated by an explicit reload', async () => {
    const key = 'reload-key';
    let called = false;
    let releaseFirst: (() => void) | undefined;
    const first = enqueueContentSave(key, async () => {
      await new Promise<void>((resolve: () => void) => {
        releaseFirst = (): void => resolve();
      });
      return 'first';
    });
    await new Promise<void>((resolve: () => void) => setTimeout(resolve, 0));
    const second = enqueueContentSave(key, async () => {
      called = true;
      return 'second';
    });
    invalidateContentSaves(key);

    releaseFirst?.();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBeUndefined();
    expect(called).toBe(false);
  });
});
