// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Workshop a pinned manuscript passage and explicitly apply chosen wording. */
import React, { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Square, MapPin, RotateCcw } from 'lucide-react';
import type { EditorHandle } from '../editor/Editor';
import type { LLMConfig } from '../../types';
import { useWorkshop } from './useWorkshop';
import { PassageDiff } from './PassageDiff';
import { ContextInspector } from './ContextInspector';
import type { WorkshopAlternative, WorkshopTurn, WorkshopSession } from './types';

interface AlternativeProps {
  alternative: WorkshopAlternative;
  original: string;
  language: string;
  decision?: 'applied' | 'rejected';
  onDecide: (decision: 'applied' | 'rejected', replacement: string) => void;
}

function AlternativeCard({
  alternative,
  original,
  language,
  decision,
  onDecide,
}: AlternativeProps): React.JSX.Element {
  const { t } = useTranslation();
  const [replacement, setReplacement] = useState(alternative.replacement);
  const [editing, setEditing] = useState(false);
  return (
    <article className="rounded-lg border border-brand-gray-500/25 bg-black/5 p-3">
      <h4 className="mb-2 text-xs font-semibold">{alternative.label}</h4>
      {editing ? (
        <textarea
          aria-label={t('workshop.replacement')}
          lang={language}
          spellCheck
          value={replacement}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            setReplacement(event.target.value)
          }
          className="min-h-24 w-full resize-y rounded border border-brand-gray-500/30 bg-transparent p-2 font-serif text-sm"
        />
      ) : (
        <PassageDiff original={original} replacement={replacement} />
      )}
      {decision ? (
        <p className="mt-3 text-xs text-brand-gray-500">{t(`workshop.${decision}`)}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={() => onDecide('applied', replacement)}
            className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500"
          >
            {t('workshop.apply')}
          </button>
          <button
            type="button"
            onClick={() => setEditing(!editing)}
            className="rounded px-2 py-1.5 hover:bg-brand-gray-500/15"
          >
            {t(editing ? 'workshop.compare' : 'workshop.adjust')}
          </button>
          <button
            type="button"
            onClick={() => onDecide('rejected', replacement)}
            className="rounded px-2 py-1.5 hover:bg-brand-gray-500/15"
          >
            {t('workshop.reject')}
          </button>
        </div>
      )}
    </article>
  );
}

interface WorkshopPanelProps {
  projectId: string;
  editorRef: RefObject<EditorHandle | null>;
  model: LLMConfig;
  language: string;
}

export function WorkshopPanel({
  projectId,
  editorRef,
  model,
  language,
}: WorkshopPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const workshop = useWorkshop(projectId, editorRef);
  const [input, setInput] = useState('');
  const [viewpoint, setViewpoint] = useState('');
  const [timeline, setTimeline] = useState('');
  const [timelinePosition, setTimelinePosition] = useState('');
  const [attachError, setAttachError] = useState<string | null>(null);
  const { session } = workshop;
  useEffect(() => {
    setViewpoint(session?.scopeContext?.viewpoint ?? '');
    setTimeline(session?.scopeContext?.timeline ?? '');
    setTimelinePosition(session?.scopeContext?.timelinePosition?.toString() ?? '');
  }, [session?.id]);
  const attach = (kind: 'sentence' | 'paragraph'): void => {
    setAttachError(null);
    void workshop
      .attach(kind)
      .catch((cause: unknown) =>
        setAttachError(cause instanceof Error ? cause.message : String(cause))
      );
  };
  const send = (): void => {
    if (!input.trim() || workshop.isLoading) return;
    const text = input;
    setAttachError(null);
    setInput('');
    void workshop
      .send(
        text,
        model.name,
        viewpoint,
        timeline,
        timelinePosition === '' ? undefined : Number(timelinePosition)
      )
      .then((recorded: boolean) => {
        if (!recorded) setInput((current: string): string => current || text);
      });
  };
  const error = attachError ?? workshop.error;
  const errorText =
    error && ['document', 'changed', 'range', 'markers', 'empty'].includes(error)
      ? t(`workshop.error.${error}`)
      : error;

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t('workshop.title')}>
      <header className="space-y-3 border-b border-brand-gray-500/20 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('workshop.title')}</h2>
          <span
            className="max-w-36 truncate text-[10px] text-brand-gray-500"
            title={model.name}
          >
            {model.name}
          </span>
        </div>
        <p className="text-xs text-brand-gray-500">{t('workshop.subtitle')}</p>
        {session ? (
          <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-medium text-indigo-400">
              <MapPin size={12} />
              {session.target.chapterTitle} ·{' '}
              {t(`workshop.kind.${session.target.kind}`)}
            </div>
            <blockquote className="max-h-36 overflow-auto whitespace-pre-wrap break-words font-serif text-sm leading-relaxed">
              {session.target.originalText}
            </blockquote>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-brand-gray-500/30 p-3 text-xs leading-relaxed">
            {t('workshop.empty')}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            disabled={workshop.isLoading}
            onClick={() => attach('sentence')}
            className="rounded border border-brand-gray-500/30 px-2 py-1.5 hover:bg-brand-gray-500/10 disabled:opacity-40"
          >
            {t('workshop.attach')}
          </button>
          <button
            type="button"
            disabled={workshop.isLoading}
            onClick={() => attach('paragraph')}
            className="rounded px-2 py-1.5 hover:bg-brand-gray-500/10 disabled:opacity-40"
          >
            {t('workshop.paragraph')}
          </button>
        </div>
        {workshop.sessions.length > 1 && (
          <select
            aria-label={t('workshop.history')}
            value={session?.id ?? ''}
            disabled={workshop.isLoading}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              workshop.select(event.target.value)
            }
            className="w-full rounded border border-brand-gray-500/30 bg-transparent p-1.5 text-xs"
          >
            {workshop.sessions.map((item: WorkshopSession) => (
              <option key={item.id} value={item.id}>
                {item.target.chapterTitle}: {item.target.originalText.slice(0, 55)}
              </option>
            ))}
          </select>
        )}
        <details className="text-xs">
          <summary className="cursor-pointer text-brand-gray-500">
            {t('workshop.scope')}
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label>
              {t('workshop.viewpoint')}
              <input
                value={viewpoint}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setViewpoint(event.target.value)
                }
                className="mt-1 w-full rounded border border-brand-gray-500/30 bg-transparent p-1.5"
              />
            </label>
            <label>
              {t('workshop.timeline')}
              <input
                value={timeline}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setTimeline(event.target.value)
                }
                className="mt-1 w-full rounded border border-brand-gray-500/30 bg-transparent p-1.5"
              />
            </label>
            <label className="col-span-2">
              {t('workshop.timelinePosition')}
              <input
                type="number"
                min="0"
                step="1"
                value={timelinePosition}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setTimelinePosition(event.target.value)
                }
                className="mt-1 w-full rounded border border-brand-gray-500/30 bg-transparent p-1.5"
              />
              <span className="mt-1 block text-[10px] text-brand-gray-500">
                {t('workshop.timelineHint')}
              </span>
            </label>
          </div>
        </details>
      </header>

      <div
        className="min-h-0 flex-1 space-y-5 overflow-auto px-4 py-4"
        aria-live="polite"
      >
        {session?.turns.map((turn: WorkshopTurn) => (
          <article key={turn.id} className="space-y-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-brand-gray-500">
              {t(`workshop.role.${turn.role}`)}
            </h3>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {turn.content}
            </p>
            {turn.response?.alternatives.map((alternative: WorkshopAlternative) => (
              <AlternativeCard
                key={alternative.id}
                alternative={alternative}
                original={session.target.originalText}
                language={language}
                decision={turn.decisions?.[alternative.id]}
                onDecide={(decision: 'applied' | 'rejected', replacement: string) =>
                  workshop.decide(turn.id, alternative.id, decision, replacement)
                }
              />
            ))}
            {turn.response && <ContextInspector context={turn.response.context} />}
          </article>
        ))}
        {workshop.isLoading && (
          <p role="status" className="animate-pulse text-xs text-indigo-400">
            {t('workshop.thinking')}
          </p>
        )}
      </div>

      <footer className="border-t border-brand-gray-500/20 p-3">
        {workshop.cancelled && (
          <p role="status" className="mb-2 text-xs text-brand-gray-500">
            {t('workshop.cancelled')}
          </p>
        )}
        {errorText && (
          <div
            role="alert"
            className="mb-3 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-500"
          >
            {errorText}
          </div>
        )}
        {workshop.storageError && (
          <p role="alert" className="mb-2 text-xs text-amber-500">
            {t('workshop.storageError')}
          </p>
        )}
        <form
          onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            send();
          }}
        >
          <textarea
            lang={language}
            spellCheck
            aria-label={t('workshop.message')}
            placeholder={t('workshop.placeholder')}
            maxLength={8000}
            value={input}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
              setInput(event.target.value)
            }
            onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                send();
              }
            }}
            className="min-h-24 max-h-52 w-full resize-y rounded-lg border border-brand-gray-500/30 bg-transparent p-3 text-sm outline-none focus:border-indigo-500"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-brand-gray-500">
              {t('workshop.applyHint')}
            </span>
            {workshop.isLoading ? (
              <button
                type="button"
                onClick={workshop.stop}
                aria-label={t('workshop.stop')}
                className="rounded-md bg-brand-gray-500/20 p-2"
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || !projectId}
                aria-label={t('workshop.send')}
                className="rounded-md bg-indigo-600 p-2 text-white disabled:opacity-40"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </form>
        {session && !workshop.isLoading && (
          <button
            type="button"
            className="mt-2 flex items-center gap-1 text-[10px] text-brand-gray-500 hover:text-indigo-400"
            onClick={() => {
              const lastUser = [...session.turns]
                .reverse()
                .find((turn: WorkshopTurn): boolean => turn.role === 'user');
              if (lastUser)
                void workshop.send(
                  lastUser.content,
                  model.name,
                  viewpoint,
                  timeline,
                  timelinePosition === '' ? undefined : Number(timelinePosition)
                );
            }}
          >
            <RotateCcw size={11} />
            {t('workshop.regenerate')}
          </button>
        )}
      </footer>
    </section>
  );
}
