// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Verify status promotion and visible World Info import warnings. */
/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LorePanel } from './LorePanel';
import type {
  LoreApi,
  LoreEntry,
  WorldInfoPayload,
} from '../../services/apiClients/lore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string): string => key }),
}));

const entry = (): LoreEntry => ({
  id: 'lore:1',
  name: 'Aelith',
  kind: 'character',
  status: 'proposal',
  description: 'An archivist.',
  aliases: ['Archivist'],
  relations: [],
  sources: ['notes.md'],
  scope: {},
  activation: {
    enabled: true,
    constant: false,
    primary_keys: ['Aelith'],
    secondary_keys: [],
    selective_logic: 'AND_ANY',
    order: 100,
    recursive: false,
    prevent_recursion: false,
    exclude_recursion: false,
  },
  raw_fields: {},
});

const worldInfo: WorldInfoPayload = {
  name: 'Pinned',
  entries: {
    '17': {
      uid: 17,
      key: ['Aelith'],
      content: '{{char}} keeps the brass key.',
      extensions: { probability: 25 },
      unknown_field: { preserve: true },
    },
  },
  unknown_top_level: { preserve: true },
};

const apiFixture = (overrides: Partial<LoreApi> = {}): LoreApi => ({
  list: vi.fn(async () => [entry()]),
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(async () => ({ ...entry(), status: 'canon' })),
  delete: vi.fn(async () => ({ ok: true })),
  select: vi.fn(),
  listWorldInfo: vi.fn(async () => []),
  getWorldInfo: vi.fn(),
  importWorldInfo: vi.fn(async (name: string) => ({
    name,
    entries: 1,
    unsupported_options: ['Pinned:17:extensions.probability'],
  })),
  deleteWorldInfo: vi.fn(async () => ({ ok: true })),
  ...overrides,
});

describe('LorePanel', () => {
  afterEach((): void => {
    cleanup();
  });

  it('edits status and sends an explicit canon promotion to the project API', async () => {
    const api = apiFixture();
    render(<LorePanel projectId="fixture" loreApi={api} />);
    await screen.findByText('Aelith');
    fireEvent.click(screen.getByRole('button', { name: /Aelith/ }));
    fireEvent.change(screen.getByLabelText('lore.status'), {
      target: { value: 'canon' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'lore.save' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledOnce());
    expect(api.update).toHaveBeenCalledWith(
      'lore:1',
      expect.objectContaining({ status: 'canon' })
    );
  });

  it('shows unsupported settings before importing raw World Info', async () => {
    const api = apiFixture();
    render(<LorePanel projectId="fixture" loreApi={api} />);
    const file = new File([JSON.stringify(worldInfo)], 'pinned.json', {
      type: 'application/json',
    });
    fireEvent.change(screen.getByLabelText('lore.chooseFile'), {
      target: { files: [file] },
    });
    await screen.findByText('Pinned:17:extensions.probability');
    fireEvent.click(screen.getByRole('button', { name: 'lore.confirmImport' }));
    await waitFor(() => expect(api.importWorldInfo).toHaveBeenCalledOnce());
    expect(api.importWorldInfo).toHaveBeenCalledWith('Pinned', worldInfo);
  });
});
