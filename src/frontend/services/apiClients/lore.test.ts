// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Verify project-bound lore updates and lossless World Info exchange. */
import { describe, expect, it, vi } from 'vitest';

import { createLoreApi, type WorldInfoPayload } from './lore';
import { deleteJson, fetchJson, postJson, putJson } from './shared';
import { registerSharedApiMockCleanup } from './testSharedMocks';

vi.mock('./shared', () => ({
  projectEndpoint: vi.fn((projectName: string, path: string) => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (!projectName) return normalizedPath;
    return `/projects/${encodeURIComponent(projectName)}${normalizedPath}`;
  }),
  fetchJson: vi.fn(),
  postJson: vi.fn(),
  putJson: vi.fn(),
  deleteJson: vi.fn(),
}));
registerSharedApiMockCleanup();

const fixture: WorldInfoPayload = {
  name: 'Pinned',
  entries: {
    '17': {
      uid: 17,
      key: ['Aelith'],
      content: 'The archivist keeps the brass key.',
      extensions: { future_flag: { nested: true }, probability: 40 },
      unknown_entry_field: ['preserve', 3],
    },
  },
  custom_top_level: { untouched: true },
};

describe('createLoreApi', () => {
  it('sends a project-bound status update without dropping the other metadata', async () => {
    const api = createLoreApi('project with spaces');
    const payload = {
      status: 'canon' as const,
      belief_actor: null,
      scope: { chapter_start: 2, chapter_end: 4 },
    };
    vi.mocked(putJson).mockResolvedValueOnce({ id: 'lore:1', status: 'canon' });

    await api.update('lore:1', payload);

    expect(putJson).toHaveBeenCalledWith(
      '/projects/project%20with%20spaces/lore/lore%3A1',
      payload,
      'Failed to update lore entry'
    );
  });

  it('round trips the complete raw World Info object and exposes warnings from the server', async () => {
    const api = createLoreApi('fixture');
    const importResult = {
      name: 'Pinned',
      entries: 1,
      unsupported_options: ['Pinned:17:extensions.probability'],
    };
    vi.mocked(postJson).mockResolvedValueOnce(importResult);
    vi.mocked(fetchJson).mockResolvedValueOnce(fixture);

    await expect(api.importWorldInfo('Pinned', fixture)).resolves.toEqual(importResult);
    await expect(api.getWorldInfo('Pinned')).resolves.toBe(fixture);
    expect(postJson).toHaveBeenCalledWith(
      '/projects/fixture/lore/world-info/Pinned',
      fixture,
      'Failed to import World Info book'
    );
    expect(fetchJson).toHaveBeenCalledWith(
      '/projects/fixture/lore/world-info/Pinned',
      undefined,
      'Failed to export World Info book'
    );
    expect(fixture.entries).toEqual({
      '17': {
        uid: 17,
        key: ['Aelith'],
        content: 'The archivist keeps the brass key.',
        extensions: { future_flag: { nested: true }, probability: 40 },
        unknown_entry_field: ['preserve', 3],
      },
    });
  });

  it('encodes slashes in project lore and World Info identifiers', async () => {
    const api = createLoreApi('fixture');
    vi.mocked(fetchJson).mockResolvedValueOnce([]);
    vi.mocked(deleteJson).mockResolvedValueOnce({ ok: true });

    await api.list('Aelith / key');
    await api.deleteWorldInfo('Book/with slash');

    expect(fetchJson).toHaveBeenCalledWith(
      '/projects/fixture/lore?query=Aelith+%2F+key',
      undefined,
      'Failed to load lore'
    );
    expect(deleteJson).toHaveBeenCalledWith(
      '/projects/fixture/lore/world-info/Book%2Fwith%20slash',
      'Failed to delete World Info book'
    );
  });
});
