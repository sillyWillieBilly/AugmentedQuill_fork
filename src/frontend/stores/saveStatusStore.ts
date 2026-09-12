// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Typed per-document save state.  Conflicts retain the original
 * loaded revision until an explicit reload, so a later save cannot silently
 * adopt a newer disk base or discard unsaved editor content.
 */

import { create, StoreApi } from 'zustand';
import { contentDocumentKey } from '../services/contentRevision';

export type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

export interface SaveStatus {
  projectName: string;
  documentKey: string;
  filename?: string;
  state: SaveState;
  /** Last accepted revision, or the original loaded revision after conflict. */
  revision?: string;
  /** Revision observed on the server when a guarded write conflicted. */
  currentRevision?: string;
  /** Canonical document key observed on the server when identity changed. */
  currentDocumentKey?: string;
  error?: string;
}

export interface SaveStatusStore {
  entries: Record<string, SaveStatus>;
  setLoaded: (params: {
    projectName: string;
    documentKey: string;
    filename: string;
    revision: string;
  }) => void;
  setSaving: (projectName: string, documentKey: string) => void;
  setSaved: (
    projectName: string,
    documentKey: string,
    revision: string,
    filename?: string
  ) => void;
  setConflict: (
    projectName: string,
    documentKey: string,
    message: string,
    currentRevision?: string,
    filename?: string,
    currentDocumentKey?: string
  ) => void;
  setError: (projectName: string, documentKey: string, message: string) => void;
  clear: (projectName: string, documentKey: string) => void;
}

interface SaveLoadedParams {
  projectName: string;
  documentKey: string;
  filename: string;
  revision: string;
}

function key(projectName: string, documentKey: string): string {
  return contentDocumentKey(projectName, documentKey);
}

function currentOrDefault(
  entries: Record<string, SaveStatus>,
  projectName: string,
  documentKey: string
): SaveStatus {
  return (
    entries[key(projectName, documentKey)] ?? {
      projectName,
      documentKey,
      state: 'idle',
    }
  );
}

export const useSaveStatusStore = create<SaveStatusStore>()(
  (set: StoreApi<SaveStatusStore>['setState']) => ({
    entries: {},

    setLoaded: (params: SaveLoadedParams): void => {
      const { projectName, documentKey, filename, revision } = params;
      set((state: SaveStatusStore) => ({
        entries: {
          ...state.entries,
          [key(projectName, documentKey)]: {
            projectName,
            documentKey,
            filename,
            revision,
            state: 'saved',
          },
        },
      }));
    },

    setSaving: (projectName: string, documentKey: string): void =>
      set((state: SaveStatusStore) => {
        const current: SaveStatus = currentOrDefault(
          state.entries,
          projectName,
          documentKey
        );
        return {
          entries: {
            ...state.entries,
            [key(projectName, documentKey)]: {
              ...current,
              state: 'saving',
              error: undefined,
            },
          },
        };
      }),

    setSaved: (
      projectName: string,
      documentKey: string,
      revision: string,
      filename?: string
    ): void =>
      set((state: SaveStatusStore) => {
        const current: SaveStatus = currentOrDefault(
          state.entries,
          projectName,
          documentKey
        );
        return {
          entries: {
            ...state.entries,
            [key(projectName, documentKey)]: {
              ...current,
              filename: filename ?? current.filename,
              revision,
              state: 'saved',
              currentRevision: undefined,
              currentDocumentKey: undefined,
              error: undefined,
            },
          },
        };
      }),

    setConflict: (
      projectName: string,
      documentKey: string,
      message: string,
      currentRevision?: string,
      filename?: string,
      currentDocumentKey?: string
    ): void =>
      set((state: SaveStatusStore) => {
        const current: SaveStatus = currentOrDefault(
          state.entries,
          projectName,
          documentKey
        );
        return {
          entries: {
            ...state.entries,
            [key(projectName, documentKey)]: {
              ...current,
              filename: filename ?? current.filename,
              state: 'conflict',
              currentRevision,
              currentDocumentKey,
              error: message,
            },
          },
        };
      }),

    setError: (projectName: string, documentKey: string, message: string): void =>
      set((state: SaveStatusStore) => {
        const current: SaveStatus = currentOrDefault(
          state.entries,
          projectName,
          documentKey
        );
        return {
          entries: {
            ...state.entries,
            [key(projectName, documentKey)]: {
              ...current,
              state: 'error',
              error: message,
            },
          },
        };
      }),

    clear: (projectName: string, documentKey: string): void =>
      set((state: SaveStatusStore) => {
        const next = { ...state.entries };
        delete next[key(projectName, documentKey)];
        return { entries: next };
      }),
  })
);

export function getSaveStatus(
  projectName: string,
  documentKey: string
): SaveStatus | undefined {
  return useSaveStatusStore.getState().entries[key(projectName, documentKey)];
}
