// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Hook for loading, caching and mutating annotations for the current
 * prose scope.  Consumers call `refresh()` after the chapter changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import type { Annotation } from '../../services/apiClients/annotations';
import { notifyError } from '../../services/errorNotifier';
import { useStoryStore, StoryStoreState } from '../../stores/storyStore';

export interface AnnotationState {
  annotations: Annotation[];
  isLoading: boolean;
  refresh: (params?: {
    scope_type?: string;
    chapter_id?: string | null;
    book_id?: string | null;
  }) => void;
  createAnnotation: (payload: {
    scope_type: string;
    chapter_id?: string | null;
    book_id?: string | null;
    start_offset: number;
    end_offset: number;
    comment: string;
  }) => Promise<Annotation | null>;
  updateAnnotation: (id: string, comment: string) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
}

const isCurrentNativeProject = (projectName: string): boolean => {
  if (!projectName) return false;
  const story = useStoryStore.getState().story;
  return story.id === projectName && story.storage_mode !== 'linked-markdown';
};

export function useAnnotations(projectName: string): AnnotationState {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const activeProjectId = useStoryStore(
    (state: StoryStoreState): string => state.story.id
  );
  const storageMode = useStoryStore(
    (state: StoryStoreState): string | undefined => state.story.storage_mode
  );
  const isLinkedMarkdown =
    activeProjectId === projectName && storageMode === 'linked-markdown';
  const requestGeneration = useRef(0);
  const paramsRef = useRef<{
    scope_type?: string;
    chapter_id?: string | null;
    book_id?: string | null;
  }>({});

  const refresh = useCallback(
    (params?: {
      scope_type?: string;
      chapter_id?: string | null;
      book_id?: string | null;
    }) => {
      if (params) {
        paramsRef.current = params;
      }
      const generation = ++requestGeneration.current;
      if (!isCurrentNativeProject(projectName)) {
        setAnnotations([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      const requestedProjectName = projectName;
      api
        .forProject(requestedProjectName)
        .annotations.list(paramsRef.current)
        .then((nextAnnotations: Annotation[]): void => {
          if (
            generation === requestGeneration.current &&
            isCurrentNativeProject(requestedProjectName)
          ) {
            setAnnotations(nextAnnotations);
          }
        })
        .catch((err: unknown): void => {
          if (
            generation === requestGeneration.current &&
            isCurrentNativeProject(requestedProjectName)
          ) {
            notifyError('Load annotations', err);
          }
        })
        .finally((): void => {
          if (generation === requestGeneration.current) {
            setIsLoading(false);
          }
        });
    },
    [projectName]
  );

  // Clear app-only annotation state on every project or storage-mode change.
  // Linked Markdown projects do not have the legacy annotation store, and an
  // old request must not repopulate annotations after the project switches.
  useEffect(() => {
    requestGeneration.current += 1;
    paramsRef.current = {};
    setAnnotations([]);
    setIsLoading(false);
    if (projectName && activeProjectId === projectName && !isLinkedMarkdown) {
      refresh();
    }
  }, [projectName, activeProjectId, storageMode, refresh]);

  const createAnnotation = useCallback(
    async (payload: {
      scope_type: string;
      chapter_id?: string | null;
      book_id?: string | null;
      start_offset: number;
      end_offset: number;
      comment: string;
    }): Promise<Annotation | null> => {
      if (!isCurrentNativeProject(projectName)) return null;
      try {
        const created = await api.forProject(projectName).annotations.create(payload);
        if (!isCurrentNativeProject(projectName)) return null;
        setAnnotations((prev: Annotation[]): Annotation[] => [...prev, created]);
        return created;
      } catch (err) {
        notifyError('Create annotation', err);
        return null;
      }
    },
    [projectName]
  );

  const updateAnnotation = useCallback(
    async (id: string, comment: string) => {
      if (!isCurrentNativeProject(projectName)) return;
      try {
        const updated = await api
          .forProject(projectName)
          .annotations.update(id, comment);
        if (!isCurrentNativeProject(projectName)) return;
        setAnnotations((prev: Annotation[]): Annotation[] =>
          prev.map((a: Annotation): Annotation => (a.id === id ? updated : a))
        );
      } catch (err) {
        notifyError('Update annotation', err);
      }
    },
    [projectName]
  );

  const deleteAnnotation = useCallback(
    async (id: string) => {
      if (!isCurrentNativeProject(projectName)) return;
      try {
        await api.forProject(projectName).annotations.remove(id);
        if (!isCurrentNativeProject(projectName)) return;
        setAnnotations((prev: Annotation[]): Annotation[] =>
          prev.filter((a: Annotation): boolean => a.id !== id)
        );
      } catch (err) {
        notifyError('Delete annotation', err);
      }
    },
    [projectName]
  );

  return {
    annotations,
    isLoading,
    refresh,
    createAnnotation,
    updateAnnotation,
    deleteAnnotation,
  };
}
