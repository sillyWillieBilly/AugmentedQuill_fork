// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Validate persisted conversations before rendering or applying restored proposals. */
import type { WorkshopSession } from './types';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item: unknown): boolean => typeof item === 'string');
const textFields = (value: RecordValue, keys: string[]): boolean =>
  keys.every((key: string): boolean => typeof value[key] === 'string');

function validResponse(value: unknown): boolean {
  if (
    !record(value) ||
    !textFields(value, ['discussion', 'target_id', 'fingerprint']) ||
    !Array.isArray(value.alternatives) ||
    !record(value.context)
  )
    return false;
  if (
    !value.alternatives.every(
      (item: unknown): boolean =>
        record(item) && textFields(item, ['id', 'label', 'replacement'])
    )
  )
    return false;
  const ctx = value.context;
  return (
    Array.isArray(ctx.messages) &&
    ctx.messages.every(
      (item: unknown): boolean => record(item) && textFields(item, ['role', 'content'])
    ) &&
    Array.isArray(ctx.selected_lore) &&
    ctx.selected_lore.every(record) &&
    Array.isArray(ctx.excluded_lore) &&
    ctx.excluded_lore.every(
      (item: unknown): boolean => record(item) && textFields(item, ['id', 'reason'])
    ) &&
    strings(ctx.warnings) &&
    record(ctx.budget) &&
    ['context_limit_tokens', 'estimated_prompt_tokens', 'output_reserve_tokens'].every(
      (key: string): boolean => typeof (ctx.budget as RecordValue)[key] === 'number'
    ) &&
    (ctx.unsupported_options === undefined || strings(ctx.unsupported_options)) &&
    (ctx.lore_decisions === undefined ||
      (Array.isArray(ctx.lore_decisions) &&
        ctx.lore_decisions.every(
          (item: unknown): boolean =>
            record(item) &&
            textFields(item, ['entry_id', 'reason']) &&
            strings(item.matched_primary) &&
            strings(item.matched_secondary)
        )))
  );
}

export function isStoredWorkshop(
  value: unknown,
  projectId: string
): value is WorkshopSession {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    !record(value.target) ||
    !Array.isArray(value.turns)
  )
    return false;
  const target = value.target;
  if (
    value.scopeContext !== undefined &&
    (!record(value.scopeContext) ||
      !textFields(value.scopeContext, ['viewpoint', 'timeline']) ||
      (value.scopeContext.timelinePosition !== undefined &&
        (!Number.isInteger(value.scopeContext.timelinePosition) ||
          Number(value.scopeContext.timelinePosition) < 0)))
  )
    return false;
  if (
    target.projectId !== projectId ||
    !textFields(target, [
      'id',
      'documentId',
      'documentKey',
      'chapterTitle',
      'content',
      'fingerprint',
      'originalText',
      'contextBefore',
      'contextAfter',
      'language',
    ]) ||
    !['chapter', 'story'].includes(String(target.scope)) ||
    !['selection', 'sentence', 'paragraph'].includes(String(target.kind)) ||
    !['from', 'to', 'rawFrom', 'rawTo'].every(
      (key: string): boolean =>
        Number.isInteger(target[key]) && Number(target[key]) >= 0
    )
  )
    return false;
  return value.turns.every(
    (turn: unknown): boolean =>
      record(turn) &&
      textFields(turn, ['id', 'content']) &&
      ['user', 'assistant'].includes(String(turn.role)) &&
      (turn.response === undefined || validResponse(turn.response)) &&
      (turn.decisions === undefined ||
        (record(turn.decisions) &&
          Object.values(turn.decisions).every(
            (decision: unknown): boolean =>
              decision === 'applied' || decision === 'rejected'
          )))
  );
}
