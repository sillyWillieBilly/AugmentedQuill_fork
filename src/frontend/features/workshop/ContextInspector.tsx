// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Explain the actual model context, lore choices and estimated token budget. */
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkshopContext } from './types';

export function ContextInspector({
  context,
}: {
  context: WorkshopContext;
}): React.JSX.Element {
  const { t } = useTranslation();
  const reasonLabel = (reason: string): string =>
    t(`workshop.reasons.${reason}`, { defaultValue: reason.replaceAll('_', ' ') });
  return (
    <details className="rounded-lg border border-brand-gray-500/20 p-3 text-xs">
      <summary className="cursor-pointer font-medium">{t('workshop.context')}</summary>
      <p className="my-3">
        {t('workshop.budget', {
          used: context.budget.estimated_prompt_tokens,
          reserved: context.budget.output_reserve_tokens,
          limit: context.budget.context_limit_tokens,
        })}
      </p>
      {context.budget.context_budget_tokens !== undefined && (
        <p>
          {t('workshop.budgetCap', { limit: context.budget.context_budget_tokens })}
        </p>
      )}
      {context.warnings.map((warning: string, index: number) => (
        <p key={index} className="my-2 text-amber-500">
          {warning}
        </p>
      ))}
      <h4 className="mt-3 font-semibold">
        {t('workshop.loreIncluded', { count: context.selected_lore.length })}
      </h4>
      <ul className="my-2 space-y-2">
        {context.selected_lore.map((entry: Record<string, unknown>, index: number) => {
          const decision = context.lore_decisions?.find(
            (item: NonNullable<WorkshopContext['lore_decisions']>[number]): boolean =>
              item.entry_id === entry.id && item.included
          );
          return (
            <li key={String(entry.id ?? index)}>
              <span className="font-medium">
                {String(entry.name ?? entry.id ?? index + 1)}
              </span>
              {(decision || entry.reason !== undefined) && (
                <span> — {reasonLabel(decision?.reason ?? String(entry.reason))}</span>
              )}
              {decision &&
                (decision.matched_primary.length > 0 ||
                  decision.matched_secondary.length > 0) && (
                  <p className="mt-1 text-brand-gray-500">
                    {t('workshop.matchedKeys', {
                      keys: [
                        ...decision.matched_primary,
                        ...decision.matched_secondary,
                      ].join(', '),
                    })}
                  </p>
                )}
              <details className="mt-1">
                <summary className="cursor-pointer">{t('workshop.loreRecord')}</summary>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(entry, null, 2)}
                </pre>
              </details>
            </li>
          );
        })}
      </ul>
      <details className="my-3">
        <summary className="cursor-pointer">
          {t('workshop.loreExcluded', { count: context.excluded_lore.length })}
        </summary>
        <ul className="mt-2 space-y-1">
          {context.excluded_lore.map(
            (entry: WorkshopContext['excluded_lore'][number]) => (
              <li key={entry.id}>
                {entry.id}: {reasonLabel(entry.reason)}
              </li>
            )
          )}
        </ul>
      </details>
      {Boolean(context.unsupported_options?.length) && (
        <details className="my-3 text-amber-500">
          <summary className="cursor-pointer">{t('workshop.unsupported')}</summary>
          <ul className="mt-2 space-y-1">
            {context.unsupported_options?.map((option: string) => (
              <li key={option}>{option}</li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary className="cursor-pointer">{t('workshop.exactMessages')}</summary>
        {context.messages.map(
          (message: WorkshopContext['messages'][number], index: number) => (
            <details key={index} className="mt-2">
              <summary className="cursor-pointer font-semibold">
                {t(`workshop.role.${message.role}`)}
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-black/10 p-2 text-[11px]">
                {message.content}
              </pre>
            </details>
          )
        )}
      </details>
    </details>
  );
}
