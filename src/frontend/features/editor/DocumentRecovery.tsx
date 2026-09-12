// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Preview durable manuscript checkpoints and restore through guarded editor saves. */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api';
import type {
  ContentRecoveryApi,
  ContentRecoveryDetail,
  ContentRecoverySummary,
} from '../../services/apiClients/contentRecovery';
import { getSaveStatus } from '../../stores/saveStatusStore';
import { downloadBuffer, type LocalDraft } from './localDraft';

interface DocumentRecoveryProps {
  projectId: string;
  documentKey: string;
  filename: string;
  pending: boolean;
  getContent: () => string;
  onRestore: (draft: LocalDraft) => void;
  recoveryApi?: ContentRecoveryApi;
}

interface RecoveryPreview {
  detail: ContentRecoveryDetail;
  currentContent: string;
  revision?: string;
}

export function DocumentRecovery({
  projectId,
  documentKey,
  filename,
  pending,
  getContent,
  onRestore,
  recoveryApi,
}: DocumentRecoveryProps): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<ContentRecoverySummary[]>([]);
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [target, setTarget] = useState<'before' | 'after'>('before');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    []
  );

  const refresh = async (): Promise<void> => {
    const generation = ++request.current;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const response = await (
        recoveryApi ?? api.forProject(projectId).contentRecovery
      ).list();
      if (generation === request.current)
        setRecords(
          response.records.filter(
            (record: ContentRecoverySummary): boolean =>
              record.document_key === documentKey
          )
        );
    } catch (cause) {
      if (generation === request.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === request.current) setBusy(false);
    }
  };

  const inspect = async (id: string): Promise<void> => {
    const generation = ++request.current;
    const currentContent = getContent();
    const revision = getSaveStatus(projectId, documentKey)?.revision;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const detail = await (
        recoveryApi ?? api.forProject(projectId).contentRecovery
      ).get(id);
      if (detail.document_key !== documentKey)
        throw new Error(t('workshop.recovery.documentChanged'));
      if (generation === request.current)
        setPreview({ detail, currentContent, revision });
    } catch (cause) {
      if (generation === request.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === request.current) setBusy(false);
    }
  };

  const restore = (): void => {
    const status = getSaveStatus(projectId, documentKey);
    if (
      !preview ||
      pending ||
      status?.state !== 'saved' ||
      !preview.revision ||
      status.revision !== preview.revision ||
      getContent() !== preview.currentContent
    ) {
      setError(t('workshop.recovery.documentChanged'));
      return;
    }
    try {
      onRestore({
        projectId,
        documentKey,
        content: preview.detail[`${target}_content`],
        baseRevision: preview.revision,
        updatedAt: new Date().toISOString(),
      });
      setPreview(null);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="mt-1">
      <button
        type="button"
        className="underline"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) void refresh();
        }}
      >
        {t('workshop.recovery.title')}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded border border-brand-gray-500/30 p-3">
          <p>{t('workshop.recovery.hint')}</p>
          <button
            type="button"
            className="underline"
            disabled={busy}
            onClick={() => void refresh()}
          >
            {t('workshop.recovery.refresh')}
          </button>
          {busy && <p role="status">{t('workshop.recovery.loading')}</p>}
          {error && <p role="alert">{error}</p>}
          {!busy && records.length === 0 && <p>{t('workshop.recovery.empty')}</p>}
          <ul className="max-h-28 overflow-y-auto space-y-1">
            {records.map((record: ContentRecoverySummary) => (
              <li key={record.recovery_id}>
                <button
                  type="button"
                  className="underline"
                  disabled={busy}
                  onClick={() => void inspect(record.recovery_id)}
                >
                  {new Date(record.created_at).toLocaleString()} ·{' '}
                  {t(`workshop.recovery.${record.status}`)}
                </button>
              </li>
            ))}
          </ul>
          {preview && (
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                {t('workshop.recovery.version')}
                <select
                  value={target}
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                    setTarget(event.target.value as 'before' | 'after')
                  }
                  className="bg-transparent border rounded p-1"
                >
                  <option value="before">{t('workshop.recovery.before')}</option>
                  <option value="after">{t('workshop.recovery.after')}</option>
                </select>
              </label>
              <textarea
                readOnly
                aria-label={t('workshop.recovery.preview')}
                value={preview.detail[`${target}_content`]}
                className="w-full h-40 resize-y bg-transparent border rounded p-2 font-mono"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="underline"
                  disabled={busy || pending}
                  onClick={restore}
                >
                  {t('workshop.recovery.restore')}
                </button>
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    downloadBuffer(filename, preview.detail[`${target}_content`])
                  }
                >
                  {t('workshop.recovery.download')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
