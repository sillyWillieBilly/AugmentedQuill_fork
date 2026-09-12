// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Project-bound editor for explicit lore metadata and raw World Info. */

/* The panel contains many small JSX field handlers whose DOM event types are
 * inferred from their concrete input elements. */
/* eslint-disable @typescript-eslint/typedef */
/* eslint-disable max-lines-per-function -- the self-contained panel keeps its form sections together. */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  FileJson,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  JsonObject,
  LoreApi,
  LoreEntry,
  LoreEntryInput,
  LoreKind,
  LoreScope,
  LoreStatus,
  SelectiveLogic,
  WorldInfoBookSummary,
  WorldInfoPayload,
} from '../../services/apiClients/lore';
import { createLoreApi } from '../../services/apiClients/lore';
import {
  draftFromEntry,
  draftPayload,
  emptyLoreDraft,
  LORE_KINDS,
  LORE_STATUSES,
  linesFromValues,
  parseJsonArray,
  parseWorldInfoText,
  SELECTIVE_LOGICS,
  serializeWorldInfo,
  valuesFromLines,
  type LoreDraft,
} from './loreUtils';

interface PendingWorldInfoImport {
  fileName: string;
  bookName: string;
  payload: WorldInfoPayload;
  warnings: string[];
}

export interface LorePanelProps {
  projectId: string;
  /** Injectable for tests and for callers that already use the API client cache. */
  loreApi?: LoreApi;
}

const jsonText = (value: unknown): string => JSON.stringify(value ?? [], null, 2);

const stringOrNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const numberOrNull = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const downloadJson = (bookName: string, payload: WorldInfoPayload): void => {
  const blob = new Blob([serializeWorldInfo(payload)], { type: 'application/json' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${bookName.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '') || 'world-info'}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
};

export const LorePanel: React.FC<LorePanelProps> = ({
  projectId,
  loreApi: injectedApi,
}: LorePanelProps): React.JSX.Element => {
  const { t } = useTranslation();
  const client = useMemo<LoreApi>(
    () => injectedApi ?? createLoreApi(projectId),
    [injectedApi, projectId]
  );
  const [entries, setEntries] = useState<LoreEntry[]>([]);
  const [books, setBooks] = useState<WorldInfoBookSummary[]>([]);
  const [draft, setDraft] = useState<LoreDraft | null>(null);
  const [relationsText, setRelationsText] = useState('[]');
  const [sourcesText, setSourcesText] = useState('[]');
  const [search, setSearch] = useState('');
  const [pendingImport, setPendingImport] = useState<PendingWorldInfoImport | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const [nextEntries, nextBooks] = await Promise.all([
        client.list(),
        client.listWorldInfo(),
      ]);
      setEntries(nextEntries);
      setBooks(nextBooks);
      setDraft((current: LoreDraft | null): LoreDraft | null => {
        if (!current) return current;
        const refreshed = nextEntries.find((entry) => entry.id === current.id);
        return refreshed ? draftFromEntry(refreshed) : null;
      });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('lore.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [client, t]);

  useEffect((): void => {
    void load();
  }, [load]);

  const filteredEntries = useMemo((): LoreEntry[] => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter((entry: LoreEntry): boolean =>
      [entry.name, entry.description, ...entry.aliases]
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle)
    );
  }, [entries, search]);

  const selectEntry = (entry: LoreEntry): void => {
    const next = draftFromEntry(entry);
    setDraft(next);
    setRelationsText(jsonText(next.relations));
    setSourcesText(jsonText(next.sources));
    setError(null);
    setNotice(null);
  };

  const newEntry = (): void => {
    const next = emptyLoreDraft();
    setDraft(next);
    setRelationsText('[]');
    setSourcesText('[]');
    setError(null);
    setNotice(null);
  };

  const updateDraft = (changes: Partial<LoreDraft>): void => {
    setDraft((current: LoreDraft | null): LoreDraft | null =>
      current ? { ...current, ...changes } : current
    );
  };

  const updateScope = <K extends keyof LoreScope>(
    key: K,
    value: LoreScope[K]
  ): void => {
    setDraft((current: LoreDraft | null): LoreDraft | null =>
      current ? { ...current, scope: { ...current.scope, [key]: value } } : current
    );
  };

  const updateActivation = <K extends keyof LoreDraft['activation']>(
    key: K,
    value: LoreDraft['activation'][K]
  ): void => {
    setDraft((current: LoreDraft | null): LoreDraft | null =>
      current
        ? { ...current, activation: { ...current.activation, [key]: value } }
        : current
    );
  };

  const save = async (): Promise<void> => {
    if (!draft || !draft.name.trim()) {
      setError(t('lore.validationError'));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const relations = parseJsonArray<JsonObject>(relationsText, t('lore.relations'));
      const sources = parseJsonArray<unknown>(sourcesText, t('lore.sources'));
      const payload: LoreEntryInput = draftPayload({ ...draft, relations, sources });
      const saved = draft.id
        ? await client.update(draft.id, payload)
        : await client.create(payload);
      setEntries((current: LoreEntry[]): LoreEntry[] => {
        const withoutSaved = current.filter((entry) => entry.id !== saved.id);
        return [...withoutSaved, saved].sort((a, b) => a.name.localeCompare(b.name));
      });
      selectEntry(saved);
      setNotice(t('lore.saveSuccess'));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('lore.validationError'));
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!draft?.id) return;
    if (!window.confirm(t('Are you sure you want to delete this entry?'))) return;
    setIsSaving(true);
    setError(null);
    try {
      await client.delete(draft.id);
      setEntries((current: LoreEntry[]): LoreEntry[] =>
        current.filter((entry) => entry.id !== draft.id)
      );
      setDraft(null);
      setNotice(t('lore.deleteSuccess'));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('lore.loadError'));
    } finally {
      setIsSaving(false);
    }
  };

  const readWorldInfo = async (file: File): Promise<void> => {
    setError(null);
    try {
      const parsed = parseWorldInfoText(file.name, await file.text());
      setPendingImport({ fileName: file.name, ...parsed });
    } catch (cause: unknown) {
      setPendingImport(null);
      setError(cause instanceof Error ? cause.message : t('lore.fileError'));
    }
  };

  const importWorldInfo = async (): Promise<void> => {
    if (!pendingImport) return;
    setIsSaving(true);
    setError(null);
    try {
      const imported = await client.importWorldInfo(
        pendingImport.bookName,
        pendingImport.payload
      );
      setPendingImport(null);
      await load();
      setNotice(`${t('lore.importSuccess')} ${imported.name}`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('lore.fileError'));
    } finally {
      setIsSaving(false);
    }
  };

  const exportWorldInfo = async (book: WorldInfoBookSummary): Promise<void> => {
    setError(null);
    try {
      downloadJson(book.name, await client.getWorldInfo(book.name));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('lore.fileError'));
    }
  };

  const removeWorldInfo = async (book: WorldInfoBookSummary): Promise<void> => {
    if (!window.confirm(`${t('lore.removeBook')}: ${book.name}?`)) return;
    setError(null);
    try {
      await client.deleteWorldInfo(book.name);
      setBooks((current: WorldInfoBookSummary[]): WorldInfoBookSummary[] =>
        current.filter((item) => item.name !== book.name)
      );
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('lore.fileError'));
    }
  };

  const renderScopeField = (
    key: keyof LoreScope,
    labelKey: string,
    numeric = false
  ): React.JSX.Element => {
    if (!draft) return <></>;
    const value = draft.scope[key];
    return (
      <label className="text-[11px] text-brand-gray-500">
        {t(labelKey)}
        <input
          type={numeric ? 'number' : 'text'}
          value={value ?? ''}
          onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
            updateScope(
              key,
              (numeric
                ? numberOrNull(event.target.value)
                : stringOrNull(event.target.value)) as LoreScope[typeof key]
            )
          }
          className="mt-1 w-full rounded border border-brand-gray-500/30 bg-transparent px-2 py-1.5 text-xs text-inherit"
        />
      </label>
    );
  };

  const renderActivation = (): React.JSX.Element => {
    if (!draft) return <></>;
    const activation = draft.activation;
    return (
      <details className="rounded border border-brand-gray-500/20 p-2" open>
        <summary className="cursor-pointer text-xs font-semibold">
          {t('lore.activation')}
        </summary>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={activation.enabled}
                onChange={(event): void =>
                  updateActivation('enabled', event.target.checked)
                }
              />
              {t('lore.enabled')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={activation.constant}
                onChange={(event): void =>
                  updateActivation('constant', event.target.checked)
                }
              />
              {t('lore.constant')}
            </label>
          </div>
          <label className="block text-[11px] text-brand-gray-500">
            {t('lore.primaryKeys')}
            <textarea
              value={linesFromValues(activation.primary_keys)}
              onChange={(event): void =>
                updateActivation('primary_keys', valuesFromLines(event.target.value))
              }
              rows={3}
              className="mt-1 w-full resize-y rounded border border-brand-gray-500/30 bg-transparent px-2 py-1.5 text-xs text-inherit"
            />
          </label>
          <label className="block text-[11px] text-brand-gray-500">
            {t('lore.secondaryKeys')}
            <textarea
              value={linesFromValues(activation.secondary_keys)}
              onChange={(event): void =>
                updateActivation('secondary_keys', valuesFromLines(event.target.value))
              }
              rows={2}
              className="mt-1 w-full resize-y rounded border border-brand-gray-500/30 bg-transparent px-2 py-1.5 text-xs text-inherit"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-brand-gray-500">
              {t('lore.selectiveLogic')}
              <select
                value={activation.selective_logic}
                onChange={(event): void =>
                  updateActivation(
                    'selective_logic',
                    event.target.value as SelectiveLogic
                  )
                }
                className="mt-1 w-full rounded border border-brand-gray-500/30 bg-transparent px-2 py-1.5 text-xs text-inherit"
              >
                {SELECTIVE_LOGICS.map((logic: SelectiveLogic): React.JSX.Element => (
                  <option key={logic} value={logic}>
                    {t(`lore.logicOptions.${logic}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-brand-gray-500">
              {t('lore.order')}
              <input
                type="number"
                value={activation.order}
                onChange={(event): void =>
                  updateActivation('order', Number(event.target.value) || 0)
                }
                className="mt-1 w-full rounded border border-brand-gray-500/30 bg-transparent px-2 py-1.5 text-xs text-inherit"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={activation.prevent_recursion}
                onChange={(event): void =>
                  updateActivation('prevent_recursion', event.target.checked)
                }
              />
              {t('lore.preventRecursion')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={activation.exclude_recursion}
                onChange={(event): void =>
                  updateActivation('exclude_recursion', event.target.checked)
                }
              />
              {t('lore.excludeRecursion')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={activation.case_sensitive === true}
                onChange={(event): void =>
                  updateActivation('case_sensitive', event.target.checked)
                }
              />
              {t('lore.caseSensitive')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={activation.match_whole_words === true}
                onChange={(event): void =>
                  updateActivation('match_whole_words', event.target.checked)
                }
              />
              {t('lore.matchWholeWords')}
            </label>
          </div>
        </div>
      </details>
    );
  };

  const renderEditor = (): React.JSX.Element => {
    if (!draft) {
      return <p className="p-4 text-xs text-brand-gray-500">{t('lore.selectEntry')}</p>;
    }
    return (
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold">
            {draft.id ? t('lore.editEntry') : t('lore.newEntry')}
          </h3>
          {draft.id && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={isSaving}
              aria-label={t('lore.delete')}
              className="rounded p-1.5 text-red-400 hover:bg-red-500/10 disabled:opacity-40"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <label className="block text-[11px] text-brand-gray-500">
          {t('lore.name')}
          <input
            value={draft.name}
            onChange={(event): void => updateDraft({ name: event.target.value })}
            className="mt-1 w-full rounded border border-brand-gray-500/30 bg-transparent px-2 py-1.5 text-sm text-inherit"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-brand-gray-500">
            {t('lore.kind')}
            <select
              value={LORE_KINDS.includes(draft.kind as LoreKind) ? draft.kind : 'other'}
              onChange={(event): void => updateDraft({ kind: event.target.value })}
              className="mt-1 w-full rounded border border-brand-gray-500/30 bg-transparent px-2 py-1.5 text-xs text-inherit"
            >
              {LORE_KINDS.map((kind: LoreKind): React.JSX.Element => (
                <option key={kind} value={kind}>
                  {t(`lore.kindOptions.${kind}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-brand-gray-500">
            {t('lore.status')}
            <select
              value={draft.status}
              onChange={(event): void =>
                updateDraft({ status: event.target.value as LoreStatus })
              }
              className="mt-1 w-full rounded border border-brand-gray-500/30 bg-transparent px-2 py-1.5 text-xs text-inherit"
            >
              {LORE_STATUSES.map((status: LoreStatus): React.JSX.Element => (
                <option key={status} value={status}>
                  {t(`lore.${status}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-[10px] leading-relaxed text-brand-gray-500">
          {t('lore.proposalHint')}
        </p>
        <label className="block text-[11px] text-brand-gray-500">
          {t('lore.beliefActor')}
          <input
            value={draft.belief_actor ?? ''}
            onChange={(event): void =>
              updateDraft({ belief_actor: event.target.value })
            }
            className="mt-1 w-full rounded border border-brand-gray-500/30 bg-transparent px-2 py-1.5 text-xs text-inherit"
          />
        </label>
        <label className="block text-[11px] text-brand-gray-500">
          {t('lore.description')}
          <textarea
            value={draft.description}
            onChange={(event): void => updateDraft({ description: event.target.value })}
            rows={5}
            className="mt-1 w-full resize-y rounded border border-brand-gray-500/30 bg-transparent px-2 py-1.5 text-sm text-inherit"
          />
        </label>
        <label className="block text-[11px] text-brand-gray-500">
          {t('lore.aliases')}
          <textarea
            value={linesFromValues(draft.aliases)}
            onChange={(event): void =>
              updateDraft({ aliases: valuesFromLines(event.target.value) })
            }
            rows={2}
            className="mt-1 w-full resize-y rounded border border-brand-gray-500/30 bg-transparent px-2 py-1.5 text-xs text-inherit"
          />
        </label>
        <label className="block text-[11px] text-brand-gray-500">
          {t('lore.relations')}
          <textarea
            aria-label={t('lore.relations')}
            value={relationsText}
            onChange={(event): void => setRelationsText(event.target.value)}
            rows={3}
            className="mt-1 w-full resize-y rounded border border-brand-gray-500/30 bg-transparent px-2 py-1.5 font-mono text-[11px] text-inherit"
          />
          <span className="mt-1 block text-[10px]">{t('lore.relationHelp')}</span>
        </label>
        <label className="block text-[11px] text-brand-gray-500">
          {t('lore.sources')}
          <textarea
            aria-label={t('lore.sources')}
            value={sourcesText}
            onChange={(event): void => setSourcesText(event.target.value)}
            rows={2}
            className="mt-1 w-full resize-y rounded border border-brand-gray-500/30 bg-transparent px-2 py-1.5 font-mono text-[11px] text-inherit"
          />
          <span className="mt-1 block text-[10px]">{t('lore.sourceHelp')}</span>
        </label>
        {renderActivation()}
        <details className="rounded border border-brand-gray-500/20 p-2">
          <summary className="cursor-pointer text-xs font-semibold">
            {t('lore.scope')}
          </summary>
          <p className="mt-2 text-[10px] text-brand-gray-500">{t('lore.scopeHint')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {renderScopeField('book_id', 'lore.bookId')}
            {renderScopeField('chapter_id', 'lore.chapterId')}
            {renderScopeField('chapter_start', 'lore.chapterStart', true)}
            {renderScopeField('chapter_end', 'lore.chapterEnd', true)}
            {renderScopeField('scene_id', 'lore.sceneId')}
            {renderScopeField('scene_start', 'lore.sceneStart', true)}
            {renderScopeField('scene_end', 'lore.sceneEnd', true)}
            {renderScopeField('viewpoint', 'lore.viewpoint')}
            {renderScopeField('timeline_id', 'lore.timelineId')}
            {renderScopeField('timeline_position', 'lore.timelinePosition', true)}
            {renderScopeField('timeline_start', 'lore.timelineStart', true)}
            {renderScopeField('timeline_end', 'lore.timelineEnd', true)}
          </div>
        </details>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            <Save size={13} />
            {t('lore.save')}
          </button>
        </div>
      </div>
    );
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t('lore.title')}>
      <header className="shrink-0 space-y-3 border-b border-brand-gray-500/20 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">{t('lore.title')}</h2>
            <p className="mt-1 text-[10px] text-brand-gray-500">{t('lore.subtitle')}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load()}
              disabled={isLoading || isSaving}
              aria-label={t('lore.refresh')}
              className="rounded p-1.5 text-brand-gray-500 hover:bg-brand-gray-500/10 disabled:opacity-40"
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              onClick={newEntry}
              disabled={isSaving}
              className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              <Plus size={13} />
              {t('lore.newEntry')}
            </button>
          </div>
        </div>
        <input
          aria-label={t('lore.search')}
          value={search}
          onChange={(event): void => setSearch(event.target.value)}
          placeholder={t('lore.search')}
          className="w-full rounded border border-brand-gray-500/30 bg-transparent px-2 py-1.5 text-xs text-inherit"
        />
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <p
            role="alert"
            className="mx-4 mt-3 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="mx-4 mt-3 rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-300"
          >
            {notice}
          </p>
        )}
        <div className="border-b border-brand-gray-500/20 p-4">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-brand-gray-500">
            {t('lore.native')}
          </h3>
          {isLoading && entries.length === 0 ? (
            <p className="text-xs text-brand-gray-500">{t('Loading...')}</p>
          ) : filteredEntries.length === 0 ? (
            <p className="text-xs text-brand-gray-500">{t('lore.empty')}</p>
          ) : (
            <div className="space-y-1">
              {filteredEntries.map((entry: LoreEntry): React.JSX.Element => (
                <button
                  type="button"
                  key={entry.id}
                  onClick={(): void => selectEntry(entry)}
                  aria-pressed={draft?.id === entry.id}
                  className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-2 text-left text-xs ${draft?.id === entry.id ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-transparent hover:border-brand-gray-500/20 hover:bg-brand-gray-500/10'}`}
                >
                  <span className="min-w-0 truncate">{entry.name}</span>
                  <span className="shrink-0 rounded bg-brand-gray-500/10 px-1.5 py-0.5 text-[10px] text-brand-gray-500">
                    {t(`lore.${entry.status}`)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {renderEditor()}
        <section
          className="border-t border-brand-gray-500/20 p-4"
          aria-label={t('lore.worldInfo')}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-brand-gray-500">
              {t('lore.worldInfo')}
            </h3>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-brand-gray-500/30 px-2 py-1.5 text-[11px] hover:bg-brand-gray-500/10">
              <Upload size={13} />
              {t('lore.chooseFile')}
              <input
                ref={fileInputRef}
                type="file"
                aria-label={t('lore.chooseFile')}
                accept="application/json,.json"
                className="sr-only"
                onChange={(event): void => {
                  const file = event.target.files?.[0];
                  if (file) void readWorldInfo(file);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-brand-gray-500">
            {t('lore.importHint')}
          </p>
          {pendingImport && (
            <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 text-xs font-medium">
                <FileJson size={14} />
                <span className="truncate">{pendingImport.bookName}</span>
              </div>
              <p className="mt-1 text-[10px] text-brand-gray-500">
                {t('lore.pendingImport')}: {pendingImport.fileName}
              </p>
              {pendingImport.warnings.length > 0 && (
                <div className="mt-2 text-[10px] text-amber-200">
                  <p>{t('lore.unsupportedBeforeImport')}</p>
                  <ul className="mt-1 list-inside list-disc">
                    {pendingImport.warnings.map(
                      (warning: string): React.JSX.Element => (
                        <li key={warning}>{warning}</li>
                      )
                    )}
                  </ul>
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void importWorldInfo()}
                  disabled={isSaving}
                  className="rounded bg-indigo-600 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
                >
                  {t('lore.confirmImport')}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingImport(null)}
                  className="rounded px-2 py-1.5 text-[11px] text-brand-gray-500 hover:bg-brand-gray-500/10"
                >
                  {t('lore.cancelImport')}
                </button>
              </div>
            </div>
          )}
          <div className="mt-3 space-y-2">
            {books.length === 0 ? (
              <p className="text-xs text-brand-gray-500">{t('lore.noBooks')}</p>
            ) : (
              books.map((book: WorldInfoBookSummary): React.JSX.Element => (
                <details
                  key={book.name}
                  className="rounded border border-brand-gray-500/20 p-2"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate">{book.name}</span>
                    {book.unsupported_options.length > 0 && (
                      <span className="shrink-0 text-[10px] text-amber-300">
                        {book.unsupported_options.length} {t('lore.unsupported')}
                      </span>
                    )}
                  </summary>
                  {book.unsupported_options.length > 0 && (
                    <ul className="mt-2 list-inside list-disc text-[10px] text-amber-200">
                      {book.unsupported_options.map(
                        (warning: string): React.JSX.Element => (
                          <li key={warning}>{warning}</li>
                        )
                      )}
                    </ul>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void exportWorldInfo(book)}
                      className="inline-flex items-center gap-1 rounded border border-brand-gray-500/30 px-2 py-1 text-[10px] hover:bg-brand-gray-500/10"
                    >
                      <Download size={12} />
                      {t('lore.export')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeWorldInfo(book)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 size={12} />
                      {t('lore.removeBook')}
                    </button>
                  </div>
                </details>
              ))
            )}
          </div>
        </section>
      </div>
    </section>
  );
};
