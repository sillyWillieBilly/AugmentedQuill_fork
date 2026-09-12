// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Keep LorePanel defaults, JSON import checks, and form conversions pure. */

/* Preserve explicit annotations where the callback shape is not inferable
 * cleanly from JSON values. */
/* eslint-disable @typescript-eslint/typedef */

import type {
  JsonObject,
  LoreActivation,
  LoreEntry,
  LoreEntryInput,
  LoreKind,
  LoreRelation,
  LoreScope,
  LoreStatus,
  SelectiveLogic,
  WorldInfoPayload,
} from '../../services/apiClients/lore';

export interface LoreDraft extends LoreEntryInput {
  id?: string;
}

export const LORE_STATUSES: LoreStatus[] = ['proposal', 'canon', 'belief'];
export const LORE_KINDS: LoreKind[] = [
  'character',
  'location',
  'organization',
  'object',
  'event',
  'rule',
  'other',
];
export const SELECTIVE_LOGICS: SelectiveLogic[] = [
  'AND_ANY',
  'NOT_ALL',
  'NOT_ANY',
  'AND_ALL',
];

export const emptyScope = (): LoreScope => ({
  book_id: null,
  chapter_id: null,
  chapter_start: null,
  chapter_end: null,
  scene_id: null,
  scene_start: null,
  scene_end: null,
  viewpoint: null,
  timeline_id: null,
  timeline_position: null,
  timeline_start: null,
  timeline_end: null,
});

export const defaultActivation = (): LoreActivation => ({
  enabled: true,
  constant: false,
  primary_keys: [],
  secondary_keys: [],
  selective_logic: 'AND_ANY',
  order: 100,
  recursive: false,
  prevent_recursion: false,
  exclude_recursion: false,
  case_sensitive: null,
  match_whole_words: null,
});

export const emptyLoreDraft = (): LoreDraft => ({
  name: '',
  kind: 'other',
  status: 'proposal',
  description: '',
  aliases: [],
  relations: [],
  sources: [],
  scope: emptyScope(),
  activation: defaultActivation(),
  belief_actor: null,
});

export const draftFromEntry = (entry: LoreEntry): LoreDraft => ({
  id: entry.id,
  name: entry.name,
  kind: entry.kind,
  status: entry.status,
  description: entry.description,
  aliases: [...entry.aliases],
  relations: entry.relations.map((relation: LoreRelation): LoreRelation => ({
    ...relation,
  })),
  sources: [...entry.sources],
  scope: { ...emptyScope(), ...entry.scope },
  activation: { ...defaultActivation(), ...entry.activation },
  belief_actor: entry.belief_actor ?? null,
});

export const draftPayload = (draft: LoreDraft): LoreEntryInput => ({
  name: draft.name.trim(),
  kind: draft.kind,
  status: draft.status,
  description: draft.description,
  aliases: draft.aliases,
  relations: draft.relations,
  sources: draft.sources,
  scope: compactScope(draft.scope),
  activation: draft.activation,
  belief_actor: draft.belief_actor?.trim() || null,
});

export const compactScope = (scope: LoreScope): LoreScope => {
  const result: LoreScope = {};
  Object.entries(scope).forEach(([key, value]: [string, unknown]): void => {
    if (value !== null && value !== undefined && value !== '') {
      result[key as keyof LoreScope] = value as never;
    }
  });
  return result;
};

export const linesFromValues = (values: string[]): string => values.join('\n');

export const valuesFromLines = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((item: string): string => item.trim())
    .filter(Boolean);

export const parseJsonArray = <T>(value: string, label: string): T[] => {
  if (!value.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array.`);
  }
  return parsed as T[];
};

const UNSUPPORTED_WORLD_INFO_FIELDS = new Set([
  'probability',
  'useProbability',
  'use_probability',
  'sticky',
  'cooldown',
  'delay',
  'position',
  'depth',
  'scanDepth',
  'scan_depth',
  'role',
  'outletName',
  'outlet_name',
  'automationId',
  'automation_id',
  'triggers',
  'vectorized',
  'group',
  'groupOverride',
  'group_override',
  'groupWeight',
  'group_weight',
  'ignoreBudget',
  'ignore_budget',
  'delayUntilRecursion',
  'delay_until_recursion',
  'recursive',
  'useGroupScoring',
  'use_group_scoring',
  'matchPersonaDescription',
  'match_persona_description',
  'matchCharacterDescription',
  'match_character_description',
  'matchCharacterPersonality',
  'match_character_personality',
  'matchCharacterDepthPrompt',
  'match_character_depth_prompt',
  'matchScenario',
  'match_scenario',
  'matchCreatorNotes',
  'match_creator_notes',
]);

const worldInfoRecords = (payload: WorldInfoPayload): Array<[string, JsonObject]> => {
  if (Array.isArray(payload.entries)) {
    return payload.entries.flatMap(
      (entry: JsonObject, index: number): Array<[string, JsonObject]> => [
        [String(entry.uid ?? entry.id ?? index), entry],
      ]
    );
  }
  return Object.entries(payload.entries).flatMap(
    ([uid, entry]: [string, unknown]): Array<[string, JsonObject]> =>
      isJsonObject(entry) ? [[uid, entry]] : []
  );
};

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringValues = (value: unknown): string[] => {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: unknown): item is string => typeof item === 'string')
    .map((item: string): string => item.trim())
    .filter(Boolean);
};

/** Match the backend warning format before a file is imported. */
export const unsupportedWorldInfoOptions = (
  bookName: string,
  payload: WorldInfoPayload
): string[] => {
  const found = new Set<string>();
  worldInfoRecords(payload).forEach(([uid, record]): void => {
    UNSUPPORTED_WORLD_INFO_FIELDS.forEach((field: string): void => {
      if (field in record) found.add(`${bookName}:${uid}:${field}`);
      const extensions = record.extensions;
      if (isJsonObject(extensions) && field in extensions) {
        found.add(`${bookName}:${uid}:extensions.${field}`);
      }
    });
    if (
      typeof record.content === 'string' &&
      (record.content.includes('{{') || record.content.includes('@@'))
    ) {
      found.add(`${bookName}:${uid}:macros_or_decorators`);
    }
    const keyFields = ['key', 'keys', 'keysecondary', 'secondary_keys'];
    if (
      keyFields.some((field: string): boolean =>
        stringValues(record[field]).some((value: string): boolean =>
          value.startsWith('/')
        )
      )
    ) {
      found.add(`${bookName}:${uid}:regex_keys`);
    }
  });
  return [...found].sort();
};

export const worldInfoBookName = (
  fileName: string,
  payload: WorldInfoPayload
): string => {
  if (typeof payload.name === 'string' && payload.name.trim())
    return payload.name.trim();
  return fileName.replace(/\.json$/i, '').trim() || 'Imported World Info';
};

export const parseWorldInfoText = (
  fileName: string,
  text: string
): { bookName: string; payload: WorldInfoPayload; warnings: string[] } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('World Info file is not valid JSON.');
  }
  if (!isJsonObject(parsed) || !('entries' in parsed)) {
    throw new Error('World Info JSON must contain an entries object or array.');
  }
  if (!isJsonObject(parsed.entries) && !Array.isArray(parsed.entries)) {
    throw new Error('World Info entries must be an object or array.');
  }
  const payload = parsed as WorldInfoPayload;
  const bookName = worldInfoBookName(fileName, payload);
  return {
    bookName,
    payload,
    warnings: unsupportedWorldInfoOptions(bookName, payload),
  };
};

export const serializeWorldInfo = (payload: WorldInfoPayload): string =>
  `${JSON.stringify(payload, null, 2)}\n`;
