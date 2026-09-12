// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Protect intervening editor text from a previously displayed browser recovery draft. */
// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditorSaveBar } from './EditorSaveBar';
import { useSaveStatusStore } from '../../stores/saveStatusStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./DocumentRecovery', () => ({ DocumentRecovery: () => null }));
vi.mock('./localDraft', () => ({
  readLocalDraft: () => ({
    projectId: 'book',
    documentKey: 'chapter',
    content: 'Recovered draft',
    baseRevision: 'loaded',
    updatedAt: '2026-09-12T12:00:00Z',
  }),
  clearAcknowledgedDraft: async () => false,
  downloadBuffer: vi.fn(),
}));
beforeEach(() => {
  useSaveStatusStore.setState({ entries: {} });
  useSaveStatusStore.getState().setLoaded({
    projectName: 'book',
    documentKey: 'chapter',
    revision: 'loaded',
    filename: 'chapter.md',
  });
});
afterEach(cleanup);

it('keeps the draft visible and refuses to overwrite text typed after the recovery row appeared', () => {
  let content = 'Disk wording';
  const restore = vi.fn();
  render(
    <EditorSaveBar
      projectId="book"
      documentKey="chapter"
      filename="chapter.md"
      content={content}
      storageError={false}
      pending={false}
      getContent={() => content}
      onRestore={restore}
    />
  );
  content = 'Newer local wording';
  fireEvent.click(screen.getByRole('button', { name: 'workshop.save.restore' }));
  expect(restore).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe(
    'workshop.recovery.documentChanged'
  );
  expect(screen.getByRole('button', { name: 'workshop.save.restore' })).toBeTruthy();
});
