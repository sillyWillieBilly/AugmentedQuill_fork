// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Prove checkpoint inspection is read-only and cannot replace intervening editor work. */
// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentRecovery } from './DocumentRecovery';
import { useSaveStatusStore } from '../../stores/saveStatusStore';
import type { ContentRecoveryDetail } from '../../services/apiClients/contentRecovery';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const detail: ContentRecoveryDetail = {
  recovery_id: 'checkpoint',
  status: 'committed',
  document_key: 'chapters/0001.txt',
  filename: '0001.txt',
  before_revision: 'older',
  after_revision: 'loaded',
  created_at: '2026-09-12T12:00:00Z',
  before_content: 'Earlier 🌊 wording.\r\n',
  after_content: 'Current wording.',
};
const recoveryApi = {
  list: vi.fn(async () => ({ records: [detail] })),
  get: vi.fn(async () => detail),
  restore: vi.fn(),
};
let content = '';
const onRestore = vi.fn();
beforeEach(() => {
  content = detail.after_content;
  vi.clearAllMocks();
  useSaveStatusStore.setState({ entries: {} });
  useSaveStatusStore.getState().setLoaded({
    projectName: 'book',
    documentKey: detail.document_key,
    filename: detail.filename,
    revision: 'loaded',
  });
});
afterEach(cleanup);

async function openPreview(): Promise<void> {
  render(
    <DocumentRecovery
      projectId="book"
      documentKey={detail.document_key}
      filename={detail.filename}
      pending={false}
      getContent={() => content}
      onRestore={onRestore}
      recoveryApi={recoveryApi}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'workshop.recovery.title' }));
  fireEvent.click(
    await screen.findByRole('button', { name: /workshop.recovery.committed/ })
  );
  await screen.findByRole('textbox', { name: 'workshop.recovery.preview' });
}

it('previews exact checkpoint bytes without a write and restores only by explicit editor action', async () => {
  await openPreview();
  // The browser textarea normalizes CRLF visually; the underlying restore retains raw bytes.
  expect(onRestore).not.toHaveBeenCalled();
  expect(recoveryApi.restore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'workshop.recovery.restore' }));
  expect(onRestore).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: 'book',
      documentKey: detail.document_key,
      content: detail.before_content,
      baseRevision: 'loaded',
    })
  );
});

it('retains a newer buffer typed after checkpoint inspection', async () => {
  await openPreview();
  content += ' Newer unsaved sentence.';
  fireEvent.click(screen.getByRole('button', { name: 'workshop.recovery.restore' }));
  expect(onRestore).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe(
    'workshop.recovery.documentChanged'
  );
  expect(
    screen.getByRole('textbox', { name: 'workshop.recovery.preview' })
  ).toBeTruthy();
});

it('refuses recovery after a save conflict or a changed loaded revision', async () => {
  await openPreview();
  useSaveStatusStore
    .getState()
    .setConflict('book', detail.document_key, 'External edit', 'newer');
  fireEvent.click(screen.getByRole('button', { name: 'workshop.recovery.restore' }));
  expect(onRestore).not.toHaveBeenCalled();
  useSaveStatusStore.getState().setSaved('book', detail.document_key, 'newer');
  fireEvent.click(screen.getByRole('button', { name: 'workshop.recovery.restore' }));
  expect(onRestore).not.toHaveBeenCalled();
});
