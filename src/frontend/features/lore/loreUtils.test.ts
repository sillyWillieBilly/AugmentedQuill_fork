// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Protect proposal defaults and lossless World Info preview checks. */
import { describe, expect, it } from 'vitest';

import {
  draftFromEntry,
  emptyLoreDraft,
  parseWorldInfoText,
  serializeWorldInfo,
  unsupportedWorldInfoOptions,
} from './loreUtils';
import type { LoreEntry, WorldInfoPayload } from '../../services/apiClients/lore';

const worldInfo: WorldInfoPayload = {
  name: 'Pinned',
  entries: {
    '17': {
      uid: 17,
      key: ['Aelith'],
      content: '{{char}} keeps the brass key.',
      unknown: { nested: ['value'] },
      extensions: { probability: 25 },
    },
  },
  unknown_top_level: { keep: true },
};

describe('loreUtils', () => {
  it('starts new entries as proposals and preserves edited status', () => {
    expect(emptyLoreDraft().status).toBe('proposal');
    const entry = {
      ...emptyLoreDraft(),
      id: 'lore:1',
      name: 'Aelith',
      status: 'belief' as const,
      description: 'A rumour.',
    } as LoreEntry;
    expect(draftFromEntry(entry).status).toBe('belief');
  });

  it('previews unsupported options and preserves every raw World Info field', () => {
    expect(unsupportedWorldInfoOptions('Pinned', worldInfo)).toEqual([
      'Pinned:17:extensions.probability',
      'Pinned:17:macros_or_decorators',
    ]);
    const parsed = parseWorldInfoText('import.json', serializeWorldInfo(worldInfo));
    expect(parsed.bookName).toBe('Pinned');
    expect(parsed.payload).toEqual(worldInfo);
    expect(parsed.warnings).toEqual([
      'Pinned:17:extensions.probability',
      'Pinned:17:macros_or_decorators',
    ]);
  });

  it('rejects World Info JSON without an entries object or array', () => {
    expect(() => parseWorldInfoText('bad.json', '{"name":"Pinned"}')).toThrow(
      'entries object or array'
    );
  });
});
