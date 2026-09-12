// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Defines the durable content recovery API client contract. */
import { describe, expect, it, vi } from 'vitest';

import { contentRecoveryApi } from './contentRecovery';
import { fetchJson, postJson } from './shared';
import { registerSharedApiMockCleanup } from './testSharedMocks';

vi.mock('./shared', () => ({
  projectEndpoint: vi.fn((projectName: string, path: string) => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (!projectName) return normalizedPath;
    return `/projects/${encodeURIComponent(projectName)}${normalizedPath}`;
  }),
  fetchJson: vi.fn(),
  postJson: vi.fn(),
}));
registerSharedApiMockCleanup();

describe('contentRecoveryApi', () => {
  it('lists and reads project recovery records', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({ records: [] });
    await contentRecoveryApi.list();
    expect(fetchJson).toHaveBeenCalledWith(
      '/content-recovery',
      undefined,
      'Failed to list content recovery records'
    );

    vi.mocked(fetchJson).mockResolvedValueOnce({ recovery_id: 'r1' });
    await contentRecoveryApi.get('r/1');
    expect(fetchJson).toHaveBeenCalledWith(
      '/content-recovery/r%2F1',
      undefined,
      'Failed to get content recovery record'
    );
  });

  it('restores with the current revision and canonical document key', async () => {
    vi.mocked(postJson).mockResolvedValueOnce({
      ok: true,
      content: 'before',
      revision: 'r2',
      filename: '0001.txt',
      document_key: 'chapters/0001.txt',
    });
    const options = {
      target: 'before' as const,
      expected_revision: 'r1',
      expected_document_key: 'chapters/0001.txt',
      expected_filename: '0001.txt',
    };
    await contentRecoveryApi.restore('r1', options);
    expect(postJson).toHaveBeenCalledWith(
      '/content-recovery/r1/restore',
      options,
      'Failed to restore content recovery record'
    );
  });
});
