// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Make disk-save failures and recoverable local prose visible beside the manuscript. */
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { contentDocumentKey } from '../../services/contentRevision';
import {
  getSaveStatus,
  useSaveStatusStore,
  type SaveStatusStore,
} from '../../stores/saveStatusStore';
import {
  clearAcknowledgedDraft,
  downloadBuffer,
  readLocalDraft,
  type LocalDraft,
} from './localDraft';

const DocumentRecovery = lazy(() =>
  import('./DocumentRecovery').then((module: typeof import('./DocumentRecovery')) => ({
    default: module.DocumentRecovery,
  }))
);

interface EditorSaveBarProps {
  projectId: string;
  documentKey: string;
  filename: string;
  content: string;
  storageError: boolean;
  pending: boolean;
  getContent: () => string;
  onRestore: (draft: LocalDraft) => void;
  onReload?: () => Promise<void>;
}

export function EditorSaveBar({
  projectId,
  documentKey,
  filename,
  content,
  storageError,
  pending,
  getContent,
  onRestore,
  onReload,
}: EditorSaveBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const status = useSaveStatusStore(
    (state: SaveStatusStore) =>
      state.entries[contentDocumentKey(projectId, documentKey)]
  );
  const [recovery, setRecovery] = useState<LocalDraft | null>(() => {
    const saved = readLocalDraft(projectId, documentKey);
    return saved?.content !== content ? saved : null;
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const readContent = useRef(getContent);
  readContent.current = getContent;
  const recoveryObservation = useRef({
    content: getContent(),
    revision: status?.revision,
  });
  useEffect(() => {
    let active = true;
    const saved = readLocalDraft(projectId, documentKey);
    setRecovery(saved?.content !== content ? saved : null);
    recoveryObservation.current = {
      content: readContent.current(),
      revision: status?.revision,
    };
    if (status?.state === 'saved' && status.revision) {
      void clearAcknowledgedDraft(projectId, documentKey, status.revision)
        .catch(() => undefined)
        .then((cleared: boolean | undefined) => {
          if (active && cleared) setRecovery(null);
        });
    }
    return (): void => {
      active = false;
    };
  }, [projectId, documentKey, content, status?.revision, status?.state]);
  const failed = status?.state === 'conflict' || status?.state === 'error';
  return (
    <div
      className={`shrink-0 border-b border-brand-gray-500/20 px-4 py-2 text-xs ${failed || storageError ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'text-brand-gray-500'}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span role="status">
          {t(
            `workshop.save.${pending && !failed ? 'pending' : status?.state || 'idle'}`
          )}
        </span>
        {(failed || recovery || storageError) && (
          <button
            type="button"
            className="underline"
            onClick={() => downloadBuffer(filename, getContent())}
          >
            {t('workshop.save.download')}
          </button>
        )}
        {failed && onReload && (
          <button
            type="button"
            className="underline"
            disabled={loading}
            onClick={async () => {
              downloadBuffer(filename, getContent());
              setLoading(true);
              setError('');
              try {
                await onReload();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              } finally {
                setLoading(false);
              }
            }}
          >
            {t('workshop.save.reload')}
          </button>
        )}
      </div>
      {failed && <p className="mt-1">{status.error}</p>}
      {storageError && (
        <p role="alert" className="mt-1">
          {t('workshop.save.storageError')}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1">
          {error}
        </p>
      )}
      {recovery && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span>
            {t('workshop.save.recovery', {
              date: new Date(recovery.updatedAt).toLocaleString(),
            })}
          </span>
          <button
            type="button"
            className="underline"
            onClick={() => {
              if (
                getContent() !== recoveryObservation.current.content ||
                getSaveStatus(projectId, documentKey)?.revision !==
                  recoveryObservation.current.revision
              ) {
                setError(t('workshop.recovery.documentChanged'));
                return;
              }
              onRestore(recovery);
              setRecovery(null);
            }}
          >
            {t('workshop.save.restore')}
          </button>
          <button
            type="button"
            className="underline"
            onClick={() => downloadBuffer(filename, recovery.content)}
          >
            {t('workshop.save.downloadRecovery')}
          </button>
        </div>
      )}
      <Suspense fallback={null}>
        <DocumentRecovery
          key={contentDocumentKey(projectId, documentKey)}
          projectId={projectId}
          documentKey={documentKey}
          filename={filename}
          pending={pending}
          getContent={getContent}
          onRestore={onRestore}
        />
      </Suspense>
    </div>
  );
}
