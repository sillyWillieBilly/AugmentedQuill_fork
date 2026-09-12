// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Navigate existing divisions in linked Markdown using a checked live buffer. */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Chapter } from '../../types/domain';
import type { EditorHandle } from '../editor/Editor';
import type { PassageSnapshot } from '../workshop/passageTarget';
import { useThemeClasses } from '../layout/ThemeContext';
import { parseLinkedSceneOutline, type LinkedOutlineEntry } from './linkedSceneOutline';

interface LinkedSceneOutlineProps {
  projectId: string;
  chapter: Chapter | null;
  editorRef: React.RefObject<EditorHandle | null>;
  isLoading: boolean;
  onNavigate: () => void;
  onClose: () => void;
}

export default function LinkedSceneOutline({
  projectId,
  chapter,
  editorRef,
  isLoading,
  onNavigate,
  onClose,
}: LinkedSceneOutlineProps): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useThemeClasses();
  const [snapshot, setSnapshot] = useState<PassageSnapshot | null>(null);
  const [message, setMessage] = useState<'changed' | 'unavailable' | null>(null);
  const documentKey =
    chapter?.document_key ||
    (chapter
      ? `${chapter.book_id ? `books/${chapter.book_id}/` : ''}chapters/${chapter.filename || chapter.id}`
      : '');
  const read = useCallback((): PassageSnapshot | null => {
    if (isLoading || !chapter) return null;
    const fresh = editorRef.current?.getPassageSnapshot();
    return fresh?.projectId === projectId &&
      fresh.documentId === chapter.id &&
      fresh.documentKey === documentKey &&
      fresh.scope === 'chapter'
      ? fresh
      : null;
  }, [isLoading, chapter, editorRef, projectId, documentKey]);
  const refresh = useCallback((): void => {
    const fresh = read();
    setSnapshot(fresh);
    setMessage(fresh ? null : 'unavailable');
  }, [read]);
  useEffect((): (() => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    // A restored Scenes/Split view can mount before CodeMirror's live handle.
    // Retry only that initial read; chapter changes/unmount cancel the old read.
    const capture = (): void => {
      const fresh = read();
      setSnapshot(fresh);
      setMessage(fresh ? null : 'unavailable');
      if (!fresh && chapter && !isLoading && ++attempts < 20) {
        timer = setTimeout(capture, 100);
      }
    };
    capture();
    return (): void => clearTimeout(timer);
  }, [read, chapter?.content, chapter, isLoading]);
  const current =
    snapshot?.projectId === projectId &&
    snapshot.documentId === chapter?.id &&
    snapshot.documentKey === documentKey
      ? snapshot
      : null;
  const entries = current
    ? parseLinkedSceneOutline(current.content, current.lineSeparator)
    : [];
  const navigate = (entry: LinkedOutlineEntry): void => {
    const fresh = read();
    if (!fresh || !current) {
      setSnapshot(null);
      setMessage('unavailable');
      return;
    }
    if (
      fresh.content !== current.content ||
      fresh.lineSeparator !== current.lineSeparator
    ) {
      setSnapshot(fresh);
      setMessage('changed');
      return;
    }
    editorRef.current?.jumpToPosition(entry.offset, entry.offset);
    onNavigate();
  };
  return (
    <section
      aria-label={t('workshop.outline.title')}
      className={`flex h-full min-h-0 min-w-0 flex-col ${theme.bg} ${theme.text}`}
    >
      <div className={`shrink-0 space-y-2 border-b p-4 ${theme.border}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{t('workshop.outline.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-2 py-1 text-sm"
          >
            {t('workshop.outline.close')}
          </button>
        </div>
        <p className="break-words text-sm font-medium">{chapter?.title}</p>
        <p className={`text-sm ${theme.muted}`}>{t('workshop.outline.description')}</p>
        <button
          type="button"
          onClick={refresh}
          disabled={isLoading || !chapter}
          className="rounded border px-2 py-1 text-sm disabled:opacity-50"
        >
          {t('workshop.outline.refresh')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {!chapter ? (
          <p>{t('workshop.outline.noChapter')}</p>
        ) : isLoading ? (
          <p>{t('workshop.outline.loading')}</p>
        ) : (
          <>
            {message && (
              <p role="status" className="mb-3 text-sm">
                {t(`workshop.outline.${message}`)}
              </p>
            )}
            {entries.length === 1 && (
              <p className={`mb-3 text-sm ${theme.muted}`}>
                {t('workshop.outline.empty')}
              </p>
            )}
            <ol className="space-y-2">
              {entries.map((entry: LinkedOutlineEntry, index: number) => (
                <li key={`${entry.kind}:${entry.offset}:${index}`}>
                  <button
                    type="button"
                    onClick={() => navigate(entry)}
                    className={`w-full space-y-1 rounded border p-3 text-left hover:brightness-110 ${theme.card} ${theme.border}`}
                  >
                    <span className="block text-xs">
                      {t(`workshop.outline.${entry.kind}`, { id: entry.title })} ·{' '}
                      {t('workshop.outline.line', { line: entry.line })}
                    </span>
                    {entry.kind === 'heading' && (
                      <span className="block break-words font-medium">
                        {entry.title}
                      </span>
                    )}
                    {entry.excerpt && (
                      <span className={`block break-words text-sm ${theme.muted}`}>
                        {entry.excerpt}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
