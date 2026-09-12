// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Keep project-scoped native lore and raw World Info calls together. */

import { deleteJson, fetchJson, postJson, projectEndpoint, putJson } from './shared';

export type LoreStatus = 'canon' | 'belief' | 'proposal';
export type LoreKind =
  'character' | 'location' | 'organization' | 'object' | 'event' | 'rule' | 'other';
export type SelectiveLogic = 'AND_ANY' | 'NOT_ALL' | 'NOT_ANY' | 'AND_ALL';

export type JsonObject = Record<string, unknown>;

export interface LoreScope {
  book_id?: string | null;
  chapter_id?: string | number | null;
  chapter_start?: number | null;
  chapter_end?: number | null;
  scene_id?: string | number | null;
  scene_start?: number | null;
  scene_end?: number | null;
  viewpoint?: string | null;
  timeline_id?: string | null;
  timeline_position?: number | null;
  timeline_start?: number | null;
  timeline_end?: number | null;
}

export interface LoreActivation {
  enabled: boolean;
  constant: boolean;
  primary_keys: string[];
  secondary_keys: string[];
  selective_logic: SelectiveLogic;
  order: number;
  recursive: boolean;
  prevent_recursion: boolean;
  exclude_recursion: boolean;
  case_sensitive?: boolean | null;
  match_whole_words?: boolean | null;
  [key: string]: unknown;
}

export interface LoreRelation extends JsonObject {
  target_id?: string;
  relation?: string;
}

export interface LoreEntry {
  id: string;
  name: string;
  kind: LoreKind | string;
  status: LoreStatus;
  description: string;
  aliases: string[];
  relations: LoreRelation[];
  sources: unknown[];
  scope: LoreScope;
  activation: LoreActivation;
  belief_actor?: string | null;
  book?: string | null;
  raw_record?: JsonObject | null;
  raw_fields: JsonObject;
  [key: string]: unknown;
}

export interface LoreEntryInput {
  name: string;
  kind: LoreKind | string;
  status: LoreStatus;
  description: string;
  aliases: string[];
  relations: LoreRelation[];
  sources: unknown[];
  scope: LoreScope;
  activation: LoreActivation;
  belief_actor?: string | null;
}

export type LoreEntryUpdate = Partial<LoreEntryInput>;

export interface LoreContextRequest {
  scan_text: string;
  scope: LoreScope;
  budget_tokens?: number | null;
  include_beliefs: boolean;
  include_proposals: boolean;
  recursive: boolean;
  max_recursion_steps: number;
}

export interface LoreDecision {
  entry_id: string;
  included: boolean;
  reason: string;
  matched_primary: string[];
  matched_secondary: string[];
  estimated_tokens: number;
  priority: number;
  recursion_step: number;
}

export interface LoreSelectionResult {
  selected: LoreEntry[];
  decisions: LoreDecision[];
  context_text: string;
  estimated_tokens: number;
  budget_tokens?: number | null;
  budget_warning?: string | null;
  warnings: string[];
  unsupported_options: string[];
}

export interface WorldInfoBookSummary {
  name: string;
  unsupported_options: string[];
}

export type WorldInfoPayload = JsonObject & {
  entries: JsonObject | JsonObject[];
};

export interface LoreApi {
  list: (query?: string) => Promise<LoreEntry[]>;
  create: (payload: LoreEntryInput) => Promise<LoreEntry>;
  get: (entryId: string) => Promise<LoreEntry>;
  update: (entryId: string, payload: LoreEntryUpdate) => Promise<LoreEntry>;
  delete: (entryId: string) => Promise<{ ok: boolean }>;
  select: (payload: LoreContextRequest) => Promise<LoreSelectionResult>;
  listWorldInfo: () => Promise<WorldInfoBookSummary[]>;
  getWorldInfo: (bookName: string) => Promise<WorldInfoPayload>;
  importWorldInfo: (
    bookName: string,
    payload: WorldInfoPayload
  ) => Promise<{
    name: string;
    entries: number;
    unsupported_options: string[];
  }>;
  deleteWorldInfo: (bookName: string) => Promise<{ ok: boolean }>;
}

const encodePathPart = (value: string): string => encodeURIComponent(value);

export const createLoreApi = (projectName: string): LoreApi => ({
  list: (query?: string): Promise<LoreEntry[]> => {
    const params = new URLSearchParams();
    if (query?.trim()) params.set('query', query);
    const queryString = params.toString();
    const path = queryString ? `/lore?${queryString}` : '/lore';
    return fetchJson<LoreEntry[]>(
      projectEndpoint(projectName, path),
      undefined,
      'Failed to load lore'
    );
  },

  create: (payload: LoreEntryInput): Promise<LoreEntry> =>
    postJson<LoreEntry>(
      projectEndpoint(projectName, '/lore'),
      payload,
      'Failed to create lore entry'
    ),

  get: (entryId: string): Promise<LoreEntry> =>
    fetchJson<LoreEntry>(
      projectEndpoint(projectName, `/lore/${encodePathPart(entryId)}`),
      undefined,
      'Failed to load lore entry'
    ),

  update: (entryId: string, payload: LoreEntryUpdate): Promise<LoreEntry> =>
    putJson<LoreEntry>(
      projectEndpoint(projectName, `/lore/${encodePathPart(entryId)}`),
      payload,
      'Failed to update lore entry'
    ),

  delete: (entryId: string): Promise<{ ok: boolean }> =>
    deleteJson<{ ok: boolean }>(
      projectEndpoint(projectName, `/lore/${encodePathPart(entryId)}`),
      'Failed to delete lore entry'
    ),

  select: (payload: LoreContextRequest): Promise<LoreSelectionResult> =>
    postJson<LoreSelectionResult>(
      projectEndpoint(projectName, '/lore/select'),
      payload,
      'Failed to select lore context'
    ),

  listWorldInfo: (): Promise<WorldInfoBookSummary[]> =>
    fetchJson<WorldInfoBookSummary[]>(
      projectEndpoint(projectName, '/lore/world-info'),
      undefined,
      'Failed to list World Info books'
    ),

  getWorldInfo: (bookName: string): Promise<WorldInfoPayload> =>
    fetchJson<WorldInfoPayload>(
      projectEndpoint(projectName, `/lore/world-info/${encodePathPart(bookName)}`),
      undefined,
      'Failed to export World Info book'
    ),

  importWorldInfo: (
    bookName: string,
    payload: WorldInfoPayload
  ): Promise<{
    name: string;
    entries: number;
    unsupported_options: string[];
  }> =>
    postJson<{
      name: string;
      entries: number;
      unsupported_options: string[];
    }>(
      projectEndpoint(projectName, `/lore/world-info/${encodePathPart(bookName)}`),
      payload,
      'Failed to import World Info book'
    ),

  deleteWorldInfo: (bookName: string): Promise<{ ok: boolean }> =>
    deleteJson<{ ok: boolean }>(
      projectEndpoint(projectName, `/lore/world-info/${encodePathPart(bookName)}`),
      'Failed to delete World Info book'
    ),
});
