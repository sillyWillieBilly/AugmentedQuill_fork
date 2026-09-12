// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Verify checked, read-only navigation in live linked Markdown buffers. */
// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types/domain';
import type { EditorHandle } from '../editor/Editor';
import type { PassageSnapshot } from '../workshop/passageTarget';
import LinkedSceneOutline from './LinkedSceneOutline';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));

let live: PassageSnapshot | null;
const jump = vi.fn();
const mutate = vi.fn();
const onNavigate = vi.fn();
const onClose = vi.fn();
const chapter: Chapter = {
  id: '5',
  title: 'Chapter five',
  summary: '',
  filename: 'chapter-05.md',
  document_key: 'linked:book/manuscript/chapter-05.md',
  content: '# Chapter five\nSaved opening.',
};
const editorRef = {
  current: {
    getPassageSnapshot: () => live,
    jumpToPosition: jump,
    setContent: mutate,
    applyPassage: mutate,
  } as unknown as EditorHandle,
};
function panel(
  selectedChapter: Chapter | null = chapter,
  isLoading: boolean = false
): React.JSX.Element {
  return (
    <LinkedSceneOutline
      projectId="fixture"
      chapter={selectedChapter}
      editorRef={editorRef}
      isLoading={isLoading}
      onNavigate={onNavigate}
      onClose={onClose}
    />
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  live = {
    projectId: 'fixture',
    documentId: chapter.id,
    documentKey: chapter.document_key!,
    chapterTitle: chapter.title,
    content:
      '\uFEFF# Chapter five\r\n\r\n🌊 Unsaved opening.\r\n## Arrival\r\nThe quay.',
    lineSeparator: '\r\n',
    scope: 'chapter',
    selection: { anchor: 0, head: 0 },
    language: 'en',
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('LinkedSceneOutline', () => {
  it('navigates the exact live UTF-16 position without selecting or mutating prose', () => {
    render(panel());
    expect(screen.getByText('🌊 Unsaved opening.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Arrival/ }));
    const offset = live!.content.indexOf('## Arrival');
    expect(jump).toHaveBeenCalledExactlyOnceWith(offset, offset);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('refreshes changed unsaved content and requires choosing again before navigating', () => {
    render(panel());
    live = {
      ...live!,
      content: live!.content.replace(
        '## Arrival',
        'New unsaved line.\r\n## Later arrival'
      ),
    };
    fireEvent.click(screen.getByRole('button', { name: /Arrival/ }));
    expect(jump).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('workshop.outline.changed');
    fireEvent.click(screen.getByRole('button', { name: /Later arrival/ }));
    expect(jump).toHaveBeenCalledExactlyOnceWith(
      live.content.indexOf('## Later'),
      live.content.indexOf('## Later')
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each([
    { projectId: 'another-project' },
    { documentId: '6' },
    { documentKey: 'linked:book/manuscript/chapter-06.md' },
    { scope: 'story' as const },
  ])('refuses a different live document: %j', (change: Partial<PassageSnapshot>) => {
    render(panel());
    live = { ...live!, ...change };
    fireEvent.click(screen.getByRole('button', { name: /Arrival/ }));
    expect(screen.getByRole('status').textContent).toBe('workshop.outline.unavailable');
    expect(jump).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('refreshes explicitly and when chapter content changes, and closes without editing', () => {
    const view = render(panel());
    live = { ...live!, content: '# Chapter\nJust prose.\n\nAnother paragraph.' };
    fireEvent.click(screen.getByRole('button', { name: 'workshop.outline.refresh' }));
    expect(screen.getByText('workshop.outline.empty')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    live = { ...live!, content: '# Chapter\n## Restored heading\nProse.' };
    view.rerender(panel({ ...chapter, content: live.content }));
    expect(screen.getByRole('button', { name: /Restored heading/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'workshop.outline.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(jump).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('does not use saved source as a substitute when the live editor is unavailable', () => {
    live = null;
    render(panel());
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('workshop.outline.unavailable');
  });

  it('fills a restored outline when the editor handle becomes ready after mount', () => {
    vi.useFakeTimers();
    const readySnapshot = live;
    live = null;
    render(panel());
    expect(screen.queryByRole('listitem')).toBeNull();
    live = readySnapshot;
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('button', { name: /Arrival/ })).toBeTruthy();
    expect(jump).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels pending editor readiness reads when the outline closes', () => {
    vi.useFakeTimers();
    live = null;
    const view = render(panel());
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows loading or missing-chapter state without enabling stale entries', () => {
    const view = render(panel(chapter, true));
    expect(screen.getByText('workshop.outline.loading')).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
    view.rerender(panel(null));
    expect(screen.getByText('workshop.outline.noChapter')).toBeTruthy();
    expect(jump).not.toHaveBeenCalled();
  });
});
