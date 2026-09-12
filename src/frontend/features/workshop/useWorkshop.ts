// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Keep workshop targets attached to conversations through discussion and apply. */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { api } from '../../services/api';
import type { EditorHandle } from '../editor/Editor';
import { capturePassage, PassageConflict } from './passageTarget';
import type { WorkshopSession, WorkshopTurn } from './types';
import { isStoredWorkshop } from './workshopStorage';

interface WorkshopState {
  sessions: WorkshopSession[];
  currentId: string | null;
}
const emptyState: WorkshopState = { sessions: [], currentId: null };

export interface WorkshopController {
  sessions: WorkshopSession[];
  session: WorkshopSession | null;
  isLoading: boolean;
  error: string | null;
  storageError: boolean;
  cancelled: boolean;
  send: (
    text: string,
    modelName: string,
    viewpoint: string,
    timeline: string,
    timelinePosition?: number
  ) => Promise<boolean>;
  attach: (kind?: 'sentence' | 'paragraph') => Promise<WorkshopSession>;
  decide: (
    turnId: string,
    alternativeId: string,
    decision: 'applied' | 'rejected',
    replacement: string
  ) => void;
  clearError: () => void;
  select: (id: string) => void;
  stop: () => void;
}

/** Recover local workshop conversations without trusting malformed browser data. */
function restore(projectId: string): WorkshopState {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`aq-workshop-v1:${projectId}`) || 'null'
    );
    if (
      !value ||
      typeof value !== 'object' ||
      !('sessions' in value) ||
      !Array.isArray(value.sessions)
    )
      return emptyState;
    const sessions = value.sessions.filter((item: unknown): item is WorkshopSession =>
      isStoredWorkshop(item, projectId)
    );
    const currentId =
      'currentId' in value && typeof value.currentId === 'string'
        ? value.currentId
        : null;
    return { sessions, currentId };
  } catch {
    return emptyState;
  }
}

/** Own only conversation state: manuscript writes require a separate explicit apply. */
export function useWorkshop(
  projectId: string,
  editorRef: RefObject<EditorHandle | null>
): WorkshopController {
  const [state, setState] = useState<WorkshopState>(() => restore(projectId));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const session =
    state.sessions.find(
      (item: WorkshopSession): boolean => item.id === state.currentId
    ) ?? null;

  useEffect(
    () => () => {
      activeRequest.current?.abort();
    },
    []
  );
  useEffect(() => {
    try {
      localStorage.setItem(`aq-workshop-v1:${projectId}`, JSON.stringify(state));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [projectId, state]);

  const updateSession = (
    id: string,
    update: (previous: WorkshopSession) => WorkshopSession
  ): void => {
    setState((previous: WorkshopState): WorkshopState => ({
      ...previous,
      sessions: previous.sessions.map((item: WorkshopSession): WorkshopSession =>
        item.id === id ? update(item) : item
      ),
    }));
  };

  const attach = async (
    kind: 'sentence' | 'paragraph' = 'sentence'
  ): Promise<WorkshopSession> => {
    const snapshot = editorRef.current?.getPassageSnapshot();
    if (!snapshot || snapshot.projectId !== projectId)
      throw new PassageConflict('document');
    const target = await capturePassage(snapshot, kind);
    const created: WorkshopSession = { id: crypto.randomUUID(), target, turns: [] };
    setState((previous: WorkshopState): WorkshopState => ({
      sessions: [...previous.sessions, created],
      currentId: created.id,
    }));
    setError(null);
    setCancelled(false);
    return created;
  };

  const send = async (
    text: string,
    modelName: string,
    viewpoint: string,
    timeline: string,
    timelinePosition?: number
  ): Promise<boolean> => {
    if (!text.trim() || activeRequest.current) return false;
    let recorded = false;
    const controller = new AbortController();
    activeRequest.current = controller;
    setIsLoading(true);
    setCancelled(false);
    setError(null);
    try {
      const current = session ?? (await attach());
      if (controller.signal.aborted) return false;
      if (current.turns.length === 0) {
        const fresh = editorRef.current?.getPassageSnapshot();
        if (
          !fresh ||
          fresh.projectId !== current.target.projectId ||
          fresh.documentKey !== current.target.documentKey
        )
          throw new PassageConflict('document');
        if (fresh.content !== current.target.content)
          throw new PassageConflict('changed');
      }
      const userTurn: WorkshopTurn = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text.trim(),
      };
      const turns = [...current.turns, userTurn];
      updateSession(current.id, (previous: WorkshopSession): WorkshopSession => ({
        ...previous,
        turns,
        scopeContext: { viewpoint, timeline, timelinePosition },
      }));
      recorded = true;
      const response = await api.forProject(projectId).workshop.discuss(
        {
          target: current.target,
          messages: turns.slice(-12).map((turn: WorkshopTurn) => ({
            role: turn.role,
            content: turn.response
              ? JSON.stringify({
                  discussion: turn.content,
                  alternatives: turn.response.alternatives,
                  decisions: turn.decisions ?? {},
                })
              : turn.content,
          })),
          ...(modelName ? { model_name: modelName } : {}),
          ...(viewpoint.trim() ? { author_viewpoint: viewpoint.trim() } : {}),
          ...(timeline.trim() ? { timeline: timeline.trim() } : {}),
          ...(timelinePosition !== undefined
            ? { timeline_position: timelinePosition }
            : {}),
        },
        controller.signal
      );
      if (controller.signal.aborted || activeRequest.current !== controller)
        return recorded;
      if (
        response.target_id !== current.target.id ||
        response.fingerprint !== current.target.fingerprint
      )
        throw new PassageConflict('document');
      updateSession(current.id, (previous: WorkshopSession): WorkshopSession => ({
        ...previous,
        turns: [
          ...previous.turns,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: response.discussion,
            response,
          },
        ],
      }));
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setIsLoading(false);
      }
    }
    return recorded;
  };

  const decide = (
    turnId: string,
    alternativeId: string,
    decision: 'applied' | 'rejected',
    replacement: string
  ): void => {
    if (!session) return;
    try {
      if (decision === 'applied') {
        if (!editorRef.current) throw new PassageConflict('document');
        editorRef.current.applyPassage(session.target, replacement);
      }
      updateSession(session.id, (previous: WorkshopSession): WorkshopSession => ({
        ...previous,
        turns: previous.turns.map((turn: WorkshopTurn): WorkshopTurn =>
          turn.id === turnId
            ? { ...turn, decisions: { ...turn.decisions, [alternativeId]: decision } }
            : turn
        ),
      }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return {
    sessions: state.sessions,
    session,
    isLoading,
    error,
    storageError,
    cancelled,
    send,
    attach,
    decide,
    clearError: (): void => setError(null),
    select: (id: string): void => {
      setState((previous: WorkshopState): WorkshopState => ({
        ...previous,
        currentId: id,
      }));
      setError(null);
    },
    stop: (): void => {
      activeRequest.current?.abort();
      activeRequest.current = null;
      setIsLoading(false);
      setCancelled(true);
    },
  };
}
