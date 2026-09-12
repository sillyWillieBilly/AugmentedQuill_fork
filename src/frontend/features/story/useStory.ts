// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the use story unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { useCallback, useEffect, useRef, startTransition } from 'react';
import {
  StoryState,
  Chapter,
  Book,
  Conflict,
  Scene,
  WritingUnit,
  SourcebookEntry,
} from '../../types';
import { api } from '../../services/api';
import { StoryApiPayload } from '../../services/apiTypes';
import {
  mapApiChapters,
  mapSelectStoryToState,
  mapStoryBooks,
  mapStorySourcebook,
  normalizeProjectType,
} from './storyMappers';
import { notifyError } from '../../services/errorNotifier';
import {
  areStoriesEqual,
  buildChapterUpdateLabel,
  buildDraftUpdateLabel,
  createHistoryEntry,
} from './historyUtils';
import type { StoryHistoryEntry } from './historyUtils';
import { useStoryStore, StoryStoreState } from '../../stores/storyStore';
import { useChatStore } from '../../stores/chatStore';
import {
  contentDocumentKey,
  contentSaveFailure,
  enqueueContentSave,
  invalidateContentSaves,
} from '../../services/contentRevision';
import { useSaveStatusStore } from '../../stores/saveStatusStore';
import type { SaveStatus } from '../../stores/saveStatusStore';

/** Maximum number of undo/redo states retained in memory. */
const MAX_HISTORY = 50;

function recordContentSaveFailure(
  projectName: string,
  documentKey: string,
  error: unknown
): void {
  const failure = contentSaveFailure(error);
  const statusStore = useSaveStatusStore.getState();
  if (failure?.status === 409) {
    const currentRevision =
      typeof failure.payload?.revision === 'string'
        ? failure.payload.revision
        : undefined;
    const filename =
      typeof failure.payload?.filename === 'string'
        ? failure.payload.filename
        : undefined;
    const currentDocumentKey =
      typeof failure.payload?.document_key === 'string'
        ? failure.payload.document_key
        : undefined;
    statusStore.setConflict(
      projectName,
      documentKey,
      failure.message,
      currentRevision,
      filename,
      currentDocumentKey
    );
    return;
  }
  statusStore.setError(
    projectName,
    documentKey,
    failure?.message ?? (error instanceof Error ? error.message : String(error))
  );
}

/**
 * Return the revision captured when this document was loaded.
 *
 * Normal prose saves must never turn a missing base into an unconditional
 * write.  This happens briefly while a chapter is being loaded, and can also
 * happen with a legacy API double that does not return revision metadata.  A
 * readable status error lets the editor keep the local buffer and retry after
 * a successful load/reload.
 */
function requireLoadedContentBase(
  projectName: string,
  documentKey: string
): SaveStatus | null {
  const status =
    useSaveStatusStore.getState().entries[contentDocumentKey(projectName, documentKey)];
  if (
    !status ||
    status.documentKey !== documentKey ||
    typeof status.revision !== 'string' ||
    status.revision.length === 0
  ) {
    useSaveStatusStore
      .getState()
      .setError(
        projectName,
        documentKey,
        'Cannot save until this document finishes loading with a revision. Reload it and try again.'
      );
    return null;
  }
  return status;
}

/**
 * Injectable dialog callbacks for useStory.
 * Defaults use window.confirm / window.alert, which can be replaced in tests
 * or by a React-based dialog system in App.tsx.
 */
export interface StoryDialogs {
  confirm: (message: string) => Promise<boolean>;
  alert: (message: string) => void;
}

const defaultDialogs: StoryDialogs = {
  confirm: (message: string): Promise<boolean> =>
    Promise.resolve(window.confirm(message)),
  alert: (message: string): void => notifyError(message),
};

// (INITIAL_STORY and initial history entry live in stores/storyStore.ts)
export const resolveExternalHistorySourceState = (
  explicitState: StoryState | undefined,
  latestState: StoryState,
  fallbackState: StoryState
): StoryState => {
  if (explicitState) return explicitState;
  return latestState || fallbackState;
};

export interface StoryHistoryOption {
  id: string;
  label: string;
  steps: number;
}

export interface ReloadDocumentResult {
  ok: boolean;
  projectName: string;
  documentKey: string;
  content?: string;
  revision?: string;
  filename?: string;
  error?: string;
}

const buildStoryDraft = (
  projectId: string,
  story: StoryApiPayload,
  content: string = ''
): WritingUnit => ({
  id: 'story',
  scope: 'story',
  title: story.project_title || projectId,
  summary: story.story_summary || '',
  content,
  notes: story.notes || '',
  private_notes: story.private_notes || '',
  conflicts: (story.conflicts ?? []) as Conflict[],
  filename: 'content.md',
});

export const buildInitialStoryState = (
  projectId: string,
  story: StoryApiPayload,
  chapters: Chapter[]
): StoryState => ({
  id: projectId,
  title: story.project_title || projectId,
  summary: story.story_summary || '',
  notes: story.notes || '',
  private_notes: story.private_notes || '',
  styleTags: story.tags || [],
  image_style: story.image_style || '',
  image_additional_info: story.image_additional_info || '',
  chapters,
  draft:
    story.project_type === 'short-story' ? buildStoryDraft(projectId, story) : null,
  projectType: normalizeProjectType(story.project_type ?? undefined),
  language: story.language || 'en',
  books: mapStoryBooks(story.books),
  sourcebook: mapStorySourcebook(story.sourcebook),
  conflicts: (story.conflicts ?? []) as Conflict[],
  llm_prefs: story.llm_prefs
    ? { prompt_overrides: story.llm_prefs.prompt_overrides ?? undefined }
    : undefined,
  currentChapterId:
    story.project_type === 'short-story'
      ? null
      : chapters.length > 0
        ? chapters[0].id
        : null,
  lastUpdated: Date.now(),
});

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const useStory = (dialogs: StoryDialogs = defaultDialogs) => {
  // --- State now lives in the Zustand storyStore --------------------------------
  // Components that subscribe to the store with granular selectors only re-render
  // when their specific slice changes, breaking the cascade that previously fired
  // on every debounced keystroke.
  const story = useStoryStore((s: StoryStoreState): StoryState => s.story);
  const currentChapterId = useStoryStore(
    (s: StoryStoreState): string | null => s.currentChapterId
  );
  const history = useStoryStore((s: StoryStoreState): StoryHistoryEntry[] => s.history);
  const currentIndex = useStoryStore((s: StoryStoreState): number => s.currentIndex);
  const baselineState = useStoryStore(
    (s: StoryStoreState): StoryState => s.baselineState
  );
  const loadChapterSignal = useStoryStore(
    (s: StoryStoreState): number => s.loadChapterSignal
  );
  const isChapterLoading = useStoryStore(
    (s: StoryStoreState): boolean => s.isChapterLoading
  );

  const hasFetchedRef = useRef(false);
  // latestStoryRef provides a synchronous view of story state during streaming
  // before React reconciles the Zustand store update into the component tree.
  const latestStoryRef = useRef(story);
  // Hold dialog callbacks in a ref so refreshStory callbacks never go stale.
  const dialogsRef = useRef(dialogs);
  useEffect((): void => {
    dialogsRef.current = dialogs;
  });

  useEffect((): void => {
    latestStoryRef.current = story;
  }, [story]);

  const pushState = useCallback(
    (newState: StoryState, label: string, isUserEdit: boolean = true): void => {
      const {
        history,
        currentIndex,
        currentChapterId: selectedChapterId,
      } = useStoryStore.getState();
      const updatedState = {
        ...newState,
        lastUpdated: Date.now(),
        // Always preserve the store's currentChapterId — never let a stale
        // ref value from latestStoryRef overwrite the real selection.
        currentChapterId: selectedChapterId,
      };
      const currentEntry = history[currentIndex];
      if (
        !isUserEdit &&
        currentEntry &&
        areStoriesEqual(currentEntry.state, updatedState)
      ) {
        // Avoid no-op history entries that cause apparent "double undo".
        useStoryStore.setState({ story: updatedState });
        latestStoryRef.current = updatedState;
        return;
      }

      // Baseline for diff display:
      // - AI/external: capture state BEFORE the push so new text is highlighted
      // - User edits: advance baseline to new state so nothing is highlighted
      const newBaseline = isUserEdit ? updatedState : history[currentIndex].state;

      const trimmed = history.slice(0, currentIndex + 1);
      trimmed.push(createHistoryEntry(updatedState, label, { isUserEdit }));
      const bounded = trimmed.slice(-MAX_HISTORY);
      useStoryStore.getState().pushHistoryState({
        story: updatedState,
        history: bounded,
        currentIndex: bounded.length - 1,
        baselineState: newBaseline,
      });
      // pushHistoryState now preserves currentChapterId in a single set() call,
      // avoiding a render flash between story update and chapter-id update.
      latestStoryRef.current = updatedState;
    },
    [] // empty – all state accessed via useStoryStore.getState()
  );

  // Stable ref to the latest pushState so mutation callbacks can hold empty
  // deps arrays and still always call the version with current history/index.
  const pushStateRef = useRef(pushState);
  pushStateRef.current = pushState;

  // Stable refs to history and currentIndex so pushExternalHistoryEntry can
  // use empty deps and still access the current values at call time.
  const historyRef = useRef(history);
  historyRef.current = history;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  // Stable ref to the latest currentChapterId for use inside memoized callbacks.
  const currentChapterIdRef = useRef(currentChapterId);
  currentChapterIdRef.current = currentChapterId;

  const pushExternalHistoryEntry = useCallback(
    (params: {
      label: string;
      state?: StoryState;
      onUndo?: () => Promise<void> | void;
      onRedo?: () => Promise<void> | void;
      /** When true, skip the areStoriesEqual check and always push a new
       *  history entry.  Use when the caller already knows the state changed
       *  (e.g. after patchSourcebook confirmed a diff), avoiding an expensive
       *  full-story JSON.stringify. */
      forceNewHistory?: boolean;
      /** Pre-fetched "before" content for chapters that were not loaded in
       *  memory when the AI tool ran.  Applied to the baseline so the diff
       *  view highlights changes in those chapters when the user navigates
       *  to them for the first time after an AI edit. */
      baselineChapterOverrides?: { id: string; content: string }[];
    }): void => {
      const history = historyRef.current;
      const currentIndex = currentIndexRef.current;
      const sourceState = resolveExternalHistorySourceState(
        params.state,
        latestStoryRef.current,
        latestStoryRef.current
      );
      const selectedChapterId = useStoryStore.getState().currentChapterId;
      const updatedState = {
        ...sourceState,
        lastUpdated: Date.now(),
        currentChapterId:
          sourceState.currentChapterId !== undefined
            ? sourceState.currentChapterId
            : selectedChapterId,
      };

      const currentEntry = history[currentIndex];
      if (
        !params.forceNewHistory &&
        currentEntry &&
        areStoriesEqual(currentEntry.state, updatedState)
      ) {
        // Update the existing entry with the undo/redo handlers if they are missing
        const updatedOnUndo = params.onUndo ?? currentEntry.onUndo;
        const updatedOnRedo = params.onRedo ?? currentEntry.onRedo;

        if (
          updatedOnUndo !== currentEntry.onUndo ||
          updatedOnRedo !== currentEntry.onRedo
        ) {
          const updatedHistory = [...history];
          updatedHistory[currentIndex] = {
            ...currentEntry,
            label: params.label,
            onUndo: updatedOnUndo,
            onRedo: updatedOnRedo,
          };
          useStoryStore.setState({ history: updatedHistory });
        }
        // Stories are equal in content; skip setStory to avoid a costly
        // full-app re-render when nothing meaningful changed.  The ref is
        // already current so subsequent pushes will build on correct state.
        latestStoryRef.current = updatedState;
        return;
      }

      const trimmed = history.slice(0, currentIndex + 1);
      trimmed.push(
        createHistoryEntry(updatedState, params.label, {
          onUndo: params.onUndo,
          onRedo: params.onRedo,
        })
      );
      const bounded = trimmed.slice(-MAX_HISTORY);
      const previousBaseline = history[currentIndex]?.state ?? updatedState;
      // Apply any pre-fetched "before" chapter content into the baseline so the
      // diff view can show accurate highlights for chapters that weren't loaded
      // in memory when the AI tool ran.
      const patchedBaseline = params.baselineChapterOverrides?.length
        ? {
            ...previousBaseline,
            chapters: previousBaseline.chapters.map((ch: Chapter): Chapter => {
              const override = params.baselineChapterOverrides!.find(
                (o: { id: string; content: string }): boolean => o.id === ch.id
              );
              return override ? { ...ch, content: override.content } : ch;
            }),
          }
        : previousBaseline;
      // Preserve the pre-update baseline for external history entries. This
      // keeps AI-generated prose and metadata changes highlighted until the
      // next user action advances the baseline.
      useStoryStore.getState().pushHistoryState({
        story: updatedState,
        history: bounded,
        currentIndex: bounded.length - 1,
        baselineState: patchedBaseline,
      });
      latestStoryRef.current = updatedState;
      useStoryStore
        .getState()
        .setCurrentChapterId(updatedState.currentChapterId ?? null);
    },
    []
  );

  const lastLoadedChapterId = useRef<string | null>(null);
  const chapterLoadGeneration = useRef(0);
  const chapterDocumentKeys = useRef<Record<string, string>>({});
  // isChapterLoading is now read from the Zustand store (declared at top of hook).

  const refreshStory = useCallback(
    async (historyLabel?: string, resetHistory: boolean = false): Promise<void> => {
      try {
        chapterLoadGeneration.current += 1;
        const projects = await api.projects.list();
        const currentProject = projects.current || latestStoryRef.current.id;
        if (!currentProject) return;

        const res = await api.projects.select(currentProject);
        if (res.error === 'invalid_config') {
          dialogsRef.current.alert(`Invalid story config: ${res.error_message}`);
          return;
        } else if (res.ok && res.story) {
          const projectApi = api.forProject(currentProject);
          const chapters: Chapter[] =
            res.story.project_type === 'short-story'
              ? []
              : mapApiChapters((await projectApi.chapters.list()).chapters);

          let newStory: StoryState = mapSelectStoryToState(
            currentProject,
            res.story,
            chapters,
            currentChapterIdRef.current,
            latestStoryRef.current.chapters,
            latestStoryRef.current.id
          );

          if (res.story.project_type === 'short-story') {
            const contentResponse = await projectApi.story.getContent();
            const documentKey =
              contentResponse.document_key ?? contentResponse.filename ?? 'content.md';
            const filename = contentResponse.filename ?? documentKey;
            if (typeof contentResponse.revision === 'string') {
              useSaveStatusStore.getState().setLoaded({
                projectName: currentProject,
                documentKey,
                filename,
                revision: contentResponse.revision,
              });
            }
            newStory = {
              ...newStory,
              draft: {
                ...buildStoryDraft(currentProject, res.story, contentResponse.content),
                filename,
                document_key: documentKey,
              },
              currentChapterId: null,
            };
          }

          // Scenes are project-level data and are not embedded in the main story
          // payload, so refresh must explicitly reload them to avoid losing the
          // in-memory scene list after tool-driven mutations.
          const refreshedScenes = await projectApi.scenes
            .list()
            .catch((e: unknown): Scene[] => {
              console.error('Failed to refresh scenes', e);
              return latestStoryRef.current.scenes ?? [];
            });
          newStory = {
            ...newStory,
            scenes: Array.isArray(refreshedScenes)
              ? refreshedScenes
              : (latestStoryRef.current.scenes ?? []),
          };

          lastLoadedChapterId.current = null;
          useStoryStore.getState().incrementLoadChapterSignal();
          if (historyLabel) {
            pushStateRef.current(newStory, historyLabel, false);
          } else if (resetHistory) {
            useStoryStore.setState({
              story: newStory,
              history: [createHistoryEntry(newStory, 'Load story')],
              currentIndex: 0,
              baselineState: newStory,
              currentChapterId: newStory.currentChapterId,
            });
            latestStoryRef.current = newStory;
          } else {
            useStoryStore.setState({
              story: newStory,
              currentChapterId: newStory.currentChapterId,
            });
            latestStoryRef.current = newStory;
          }
        }
      } catch (e) {
        console.error('Failed to refresh story', e);
      }
    },
    []
  );

  const selectChapter = useCallback((id: string | null): void => {
    const state = useStoryStore.getState();
    if (id !== state.currentChapterId) {
      chapterLoadGeneration.current += 1;
      lastLoadedChapterId.current = null;
      state.setCurrentChapterId(id);
      state.setStory((prev: StoryState) => ({ ...prev, currentChapterId: id }));
      latestStoryRef.current = { ...latestStoryRef.current, currentChapterId: id };
    }
  }, []);

  /**
   * Explicitly reload the currently selected document after the caller has
   * preserved any local buffer it wants to recover.  The request is bound to
   * the project/document captured before the await and is discarded if either
   * changes while the server is responding.
   */
  const reloadDocument = useCallback(async (): Promise<ReloadDocumentResult> => {
    const capturedStory = latestStoryRef.current;
    const projectName = capturedStory.id;
    const capturedChapterId = useStoryStore.getState().currentChapterId;
    const capturedChapter = capturedStory.chapters.find(
      (chapter: Chapter): boolean => chapter.id === capturedChapterId
    );
    const isDraft = capturedStory.projectType === 'short-story';
    const capturedDocumentKey = isDraft
      ? (capturedStory.draft?.document_key ??
        capturedStory.draft?.filename ??
        'content.md')
      : capturedChapter
        ? (chapterDocumentKeys.current[`${projectName}:${capturedChapter.id}`] ??
          capturedChapter.document_key ??
          capturedChapter.filename ??
          `chapter:${capturedChapter.id}`)
        : '';

    if (!projectName || !capturedDocumentKey || (!isDraft && !capturedChapter)) {
      return {
        ok: false,
        projectName,
        documentKey: capturedDocumentKey,
        error: 'The selected document is unavailable for reload.',
      };
    }

    const saveKey = contentDocumentKey(projectName, capturedDocumentKey);
    const saveStatus = useSaveStatusStore.getState().entries[saveKey];
    if (saveStatus?.state === 'saving') {
      return {
        ok: false,
        projectName,
        documentKey: capturedDocumentKey,
        error: 'A save is still in progress; reload after it finishes.',
      };
    }
    // Prevent a queued pre-reload save from starting while this GET is in
    // flight.  An already running save is rejected above because its status
    // is `saving`; a noncooperative filesystem write still needs the backend
    // revision guard to decide whether it may commit.
    invalidateContentSaves(saveKey);

    let response:
      | Awaited<ReturnType<ReturnType<typeof api.forProject>['story']['getContent']>>
      | Awaited<ReturnType<ReturnType<typeof api.forProject>['chapters']['get']>>;
    try {
      const projectApi = api.forProject(projectName);
      if (isDraft) {
        response = await projectApi.story.getContent();
      } else {
        const getChapter =
          typeof projectApi.chapters.get === 'function'
            ? projectApi.chapters.get
            : api.chapters.get;
        response = await getChapter(Number(capturedChapterId));
      }
    } catch (error) {
      return {
        ok: false,
        projectName,
        documentKey: capturedDocumentKey,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const responseDocumentKey = response.document_key;
    const responseRevision = response.revision;
    if (
      typeof responseDocumentKey !== 'string' ||
      typeof responseRevision !== 'string' ||
      responseDocumentKey !== capturedDocumentKey
    ) {
      return {
        ok: false,
        projectName,
        documentKey: capturedDocumentKey,
        error: 'The document identity changed while it was being reloaded.',
      };
    }

    const currentStory = latestStoryRef.current;
    const currentChapterId = useStoryStore.getState().currentChapterId;
    const currentChapter = currentStory.chapters.find(
      (chapter: Chapter): boolean => chapter.id === currentChapterId
    );
    const currentDocumentKey = isDraft
      ? (currentStory.draft?.document_key ??
        currentStory.draft?.filename ??
        'content.md')
      : currentChapter
        ? (chapterDocumentKeys.current[`${projectName}:${currentChapter.id}`] ??
          currentChapter.document_key ??
          currentChapter.filename ??
          `chapter:${currentChapter.id}`)
        : '';
    if (
      currentStory.id !== projectName ||
      currentChapterId !== capturedChapterId ||
      currentDocumentKey !== capturedDocumentKey ||
      (!isDraft && !currentChapter)
    ) {
      return {
        ok: false,
        projectName,
        documentKey: capturedDocumentKey,
        error: 'The project or document changed while it was being reloaded.',
      };
    }

    const filename = response.filename;
    useSaveStatusStore.getState().setLoaded({
      projectName,
      documentKey: capturedDocumentKey,
      filename,
      revision: responseRevision,
    });

    const reloadedStory: StoryState = isDraft
      ? {
          ...currentStory,
          draft: currentStory.draft
            ? {
                ...currentStory.draft,
                content: response.content,
                filename,
                document_key: responseDocumentKey,
              }
            : currentStory.draft,
        }
      : {
          ...currentStory,
          chapters: currentStory.chapters.map((chapter: Chapter): Chapter =>
            chapter.id === capturedChapterId
              ? {
                  ...chapter,
                  content: response.content,
                  filename,
                  document_key: responseDocumentKey,
                }
              : chapter
          ),
        };
    if (!isDraft) {
      chapterDocumentKeys.current[`${projectName}:${capturedChapterId}`] =
        responseDocumentKey;
    }
    pushStateRef.current(reloadedStory, 'Reload document', true);
    return {
      ok: true,
      projectName,
      documentKey: responseDocumentKey,
      content: response.content,
      revision: responseRevision,
      filename,
    };
  }, []);

  // Load chapter content lazily so list refreshes stay responsive.
  useEffect((): void => {
    if (currentChapterId && currentChapterId !== lastLoadedChapterId.current) {
      useStoryStore.setState({ isChapterLoading: true });
      const selectedChapterId = currentChapterId;
      const projectName = latestStoryRef.current.id;
      const loadGeneration = ++chapterLoadGeneration.current;
      const loadContent = async (): Promise<void> => {
        try {
          const scopedChaptersApi = api.forProject(projectName).chapters;
          // Keep old injected API doubles working while production saves use
          // the project-bound client captured before the request starts.
          const getChapter =
            typeof scopedChaptersApi.get === 'function'
              ? scopedChaptersApi.get
              : api.chapters.get;
          const res = await getChapter(Number(selectedChapterId));
          if (
            loadGeneration !== chapterLoadGeneration.current ||
            useStoryStore.getState().currentChapterId !== selectedChapterId ||
            latestStoryRef.current.id !== projectName
          ) {
            return;
          }
          const documentKey =
            res.document_key ?? res.filename ?? `chapter:${selectedChapterId}`;
          const filename = res.filename ?? documentKey;
          if (typeof res.revision === 'string') {
            useSaveStatusStore.getState().setLoaded({
              projectName,
              documentKey,
              filename,
              revision: res.revision,
            });
          }
          chapterDocumentKeys.current[`${projectName}:${selectedChapterId}`] =
            documentKey;
          lastLoadedChapterId.current = selectedChapterId;
          startTransition((): void => {
            useStoryStore.setState((state: StoryStoreState) => {
              const baselineChapter = state.baselineState.chapters.find(
                (chapter: Chapter): boolean => chapter.id === selectedChapterId
              );
              // Only advance the baseline when its content is empty AND there is no
              // pending AI diff.  After an AI tool runs, pushExternalHistoryEntry sets
              // history[currentIndex].state to the same object as story, while
              // baselineState points to the older pre-AI snapshot.  If we advanced the
              // baseline here we would silently discard the pending diff for chapters
              // that had not been loaded into memory at the time the AI ran.
              const isAiDiffPending =
                state.history[state.currentIndex]?.state !== state.baselineState;
              const shouldSyncBaseline =
                !isAiDiffPending &&
                baselineChapter !== undefined &&
                (baselineChapter.content ?? '') === '';
              const updatedChapters = state.story.chapters.map((c: Chapter): Chapter =>
                c.id === selectedChapterId
                  ? {
                      ...c,
                      content: res.content,
                      filename,
                      notes: res.notes ?? undefined,
                      private_notes: res.private_notes ?? undefined,
                      conflicts: (res.conflicts ?? []) as Conflict[],
                      title: res.title ?? undefined,
                      summary: res.summary ?? undefined,
                    }
                  : c
              );

              // Only back-fill `content` in the history entry: it is the sole
              // field that is absent from the chapter-list payload and therefore
              // genuinely lazy-loaded.  All other fields (summary, notes,
              // private_notes, conflicts, title) are already present in the
              // history entry from the initial chapter-list load.  Writing them
              // here would overwrite the pre-AI values with AI-new values from
              // the disk response, corrupting the diff baseline.
              const nextHistory =
                state.currentIndex === 0 && state.history.length === 1
                  ? state.history.map(
                      (entry: StoryHistoryEntry, idx: number): StoryHistoryEntry =>
                        idx !== 0
                          ? entry
                          : {
                              ...entry,
                              state: {
                                ...entry.state,
                                chapters: entry.state.chapters.map(
                                  (chapter: Chapter): Chapter =>
                                    chapter.id === selectedChapterId
                                      ? { ...chapter, content: res.content }
                                      : chapter
                                ),
                              },
                            }
                    )
                  : state.history;

              return {
                story: {
                  ...state.story,
                  chapters: updatedChapters,
                },
                baselineState: shouldSyncBaseline
                  ? {
                      ...state.baselineState,
                      chapters: state.baselineState.chapters.map(
                        (chapter: Chapter): Chapter =>
                          chapter.id === selectedChapterId
                            ? {
                                ...chapter,
                                content: res.content,
                                notes: res.notes ?? undefined,
                                private_notes: res.private_notes ?? undefined,
                                conflicts: (res.conflicts ?? []) as Conflict[],
                                title: res.title ?? undefined,
                                summary: res.summary ?? undefined,
                              }
                            : chapter
                      ),
                    }
                  : state.baselineState,
                history: nextHistory,
                isChapterLoading: false,
              };
            });
          });
        } catch (e) {
          console.error('Failed to load chapter content', e);
          if (loadGeneration === chapterLoadGeneration.current) {
            startTransition(() => useStoryStore.setState({ isChapterLoading: false }));
          }
        }
      };
      loadContent();
    } else {
      useStoryStore.setState({ isChapterLoading: false });
    }
  }, [currentChapterId, loadChapterSignal]);

  const fetchStory = useCallback(async (): Promise<void> => {
    try {
      const projects = await api.projects.list();
      if (projects.current) {
        const res = await api.projects.select(projects.current);
        if (res.ok && res.story) {
          const projectApi = api.forProject(projects.current);
          const chapters =
            res.story.project_type === 'short-story'
              ? []
              : mapApiChapters((await projectApi.chapters.list()).chapters);

          let newStory = buildInitialStoryState(projects.current, res.story, chapters);

          if (res.story.project_type === 'short-story') {
            const contentResponse = await projectApi.story.getContent();
            const documentKey =
              contentResponse.document_key ?? contentResponse.filename ?? 'content.md';
            const filename = contentResponse.filename ?? documentKey;
            if (typeof contentResponse.revision === 'string') {
              useSaveStatusStore.getState().setLoaded({
                projectName: projects.current,
                documentKey,
                filename,
                revision: contentResponse.revision,
              });
            }
            newStory = {
              ...newStory,
              draft: {
                ...buildStoryDraft(
                  projects.current,
                  res.story,
                  contentResponse.content
                ),
                filename,
                document_key: documentKey,
              },
              currentChapterId: null,
            };
          }

          // Load scenes in parallel with (or after) the story shape is known.
          // Scenes are stored on the project but not embedded in the main
          // story response, so we must fetch them explicitly.
          const scenes = await projectApi.scenes.list().catch((e: unknown): Scene[] => {
            console.error('Failed to load scenes', e);
            return [];
          });
          newStory = { ...newStory, scenes };

          latestStoryRef.current = newStory;
          startTransition((): void => {
            useStoryStore.setState({
              story: newStory,
              history: [createHistoryEntry(newStory, 'Load story')],
              currentIndex: 0,
              baselineState: newStory,
              currentChapterId: newStory.currentChapterId,
            });
          });
        }
      }
    } catch (e) {
      console.error('Failed to fetch story', e);
    }
  }, []);

  useEffect((): void => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchStory();
    }
  }, [fetchStory]);

  const updateStoryMetadata = useCallback(
    async (
      title: string,
      summary: string,
      tags: string[],
      notes?: string,
      private_notes?: string,
      conflicts?: StoryState['conflicts'],
      language?: string
    ): Promise<void> => {
      const story = latestStoryRef.current;
      const projectApi = api.forProject(story.id);
      const metadataClient =
        typeof projectApi.story.updateMetadata === 'function'
          ? projectApi.story
          : api.story;
      const newState = {
        ...story,
        title,
        summary,
        styleTags: tags,
        notes,
        private_notes,
        conflicts: conflicts ?? story.conflicts,
        language,
        draft:
          story.projectType === 'short-story' && story.draft
            ? {
                ...story.draft,
                title,
                summary,
                notes,
                private_notes,
                conflicts: conflicts ?? story.draft.conflicts,
              }
            : story.draft,
      };
      pushStateRef.current(
        newState,
        `Update story metadata: ${title || story.title || 'Untitled'}`
      );

      try {
        await metadataClient.updateMetadata({
          title,
          summary,
          tags,
          notes,
          private_notes,
          conflicts,
          language,
        });
      } catch (e) {
        console.error('Failed to update story metadata', e);
      }
    },
    []
  );

  /* eslint-disable complexity */
  const updateStoryDraft = useCallback(
    async (
      partial: Partial<WritingUnit>,
      sync: boolean = true,
      pushHistory: boolean = true,
      isUserEdit: boolean = false
    ): Promise<void> => {
      const story = latestStoryRef.current;
      if (!story.draft) return;
      const projectName = story.id;
      const projectApi = api.forProject(projectName);
      const storyClient =
        typeof projectApi.story.updateContent === 'function'
          ? projectApi.story
          : (api.story as typeof projectApi.story);
      const documentKey =
        story.draft.document_key ?? story.draft.filename ?? 'content.md';

      const newState: StoryState = {
        ...story,
        title: partial.title ?? story.title,
        summary: partial.summary ?? story.summary,
        notes: partial.notes ?? story.notes,
        private_notes: partial.private_notes ?? story.private_notes,
        conflicts: partial.conflicts ?? story.conflicts,
        draft: { ...story.draft, ...partial },
        lastUpdated: Date.now(),
      };

      if (pushHistory) {
        pushStateRef.current(newState, buildDraftUpdateLabel(partial), isUserEdit);
      } else {
        // Keep the ref synchronous so subsequent logic sees the latest state
        // immediately.  The actual React state update is deferred as a
        // startTransition so rapid streaming-preview calls (rAF-rate) cannot
        // exceed React 19's nested-update limit.
        latestStoryRef.current = newState;
        startTransition(() => useStoryStore.setState({ story: newState }));
      }

      if (!sync) return;

      try {
        if (partial.content !== undefined) {
          const loadedBase = requireLoadedContentBase(projectName, documentKey);
          if (loadedBase) {
            await enqueueContentSave(
              contentDocumentKey(projectName, documentKey),
              async (): Promise<void> => {
                const status = requireLoadedContentBase(projectName, documentKey);
                if (!status) return;
                // A conflict is sticky until an explicit reload establishes a
                // new revision.  Keep the draft content and do not guess a base.
                if (status.state === 'conflict') return;
                useSaveStatusStore.getState().setSaving(projectName, documentKey);
                try {
                  const response = await storyClient.updateContent(
                    partial.content as string,
                    {
                      expected_revision: status.revision,
                      expected_filename: status.filename ?? story.draft?.filename,
                      expected_document_key: documentKey,
                    }
                  );
                  useSaveStatusStore
                    .getState()
                    .setSaved(
                      projectName,
                      documentKey,
                      response.revision,
                      response.filename
                    );
                } catch (error) {
                  recordContentSaveFailure(projectName, documentKey, error);
                  throw error;
                }
              }
            );
          }
        }

        if (
          partial.title !== undefined ||
          partial.summary !== undefined ||
          partial.notes !== undefined ||
          partial.private_notes !== undefined
        ) {
          const metadataClient =
            typeof projectApi.story.updateMetadata === 'function'
              ? projectApi.story
              : (api.story as typeof projectApi.story);
          await metadataClient.updateMetadata({
            title: partial.title ?? story.title,
            summary: partial.summary ?? story.summary,
            tags: story.styleTags,
            notes: partial.notes ?? story.notes,
            private_notes: partial.private_notes ?? story.private_notes,
            conflicts: partial.conflicts ?? story.conflicts,
            language: story.language,
          });
        }
      } catch (e) {
        console.error('Failed to update story draft', e);
      }
    },
    []
  );
  /* eslint-enable complexity */

  const updateStoryImageSettings = useCallback(
    async (style: string, info: string): Promise<void> => {
      const story = latestStoryRef.current;
      const newState = { ...story, image_style: style, image_additional_info: info };
      pushStateRef.current(newState, 'Update story image settings');
      try {
        await api.story.updateSettings({
          image_style: style,
          image_additional_info: info,
        });
      } catch (e) {
        console.error('Failed to update story image settings', e);
      }
    },
    []
  );

  const updateChapter = useCallback(
    async (
      id: string,
      partial: Partial<Chapter>,
      sync: boolean = true,
      pushHistory: boolean = true,
      isUserEdit: boolean = false
    ): Promise<void> => {
      const story = latestStoryRef.current;
      if (story.projectType === 'short-story') {
        await updateStoryDraft(partial, sync, pushHistory, isUserEdit);
        return;
      }

      // For streaming preview (sync=false, pushHistory=false), always use ref.
      // For all other cases, also use the ref now that updateChapter is a stable
      // useCallback — the ref is always current since it is updated on every render.
      const currentStory = latestStoryRef.current;
      const projectName = currentStory.id;
      const projectApi = api.forProject(projectName);
      const chaptersClient =
        typeof projectApi.chapters.updateContent === 'function'
          ? projectApi.chapters
          : (api.chapters as typeof projectApi.chapters);

      const chapter = currentStory.chapters.find(
        (ch: Chapter): boolean => ch.id === id
      );
      if (!chapter) return;

      const isDifferent = Object.entries(partial).some(
        ([key, value]: [
          string,
          string | import('../../types').Conflict[],
        ]): boolean => {
          if (value === undefined) return false;
          const old = (chapter as unknown as Record<string, unknown>)[key];
          return value !== old;
        }
      );

      const newChapters = currentStory.chapters.map((ch: Chapter): Chapter =>
        ch.id === id ? { ...ch, ...partial } : ch
      );
      const newState = {
        ...currentStory,
        chapters: newChapters,
        lastUpdated: Date.now(),
      };

      if (pushHistory) {
        pushStateRef.current(
          newState,
          buildChapterUpdateLabel(chapter, partial),
          isUserEdit
        );
      } else {
        latestStoryRef.current = newState;
        startTransition(() => useStoryStore.setState({ story: newState }));
      }

      if (!sync) return;

      if (!isDifferent) return;

      try {
        const numId = Number(id);
        if (partial.content !== undefined) {
          const documentKey =
            chapterDocumentKeys.current[`${projectName}:${id}`] ??
            chapter.document_key ??
            chapter.filename ??
            `chapter:${id}`;
          const loadedBase = requireLoadedContentBase(projectName, documentKey);
          if (loadedBase) {
            await enqueueContentSave(
              contentDocumentKey(projectName, documentKey),
              async (): Promise<void> => {
                const status = requireLoadedContentBase(projectName, documentKey);
                if (!status) return;
                // Keep a revision conflict sticky until an explicit chapter
                // reload.  This leaves the newer local editor content intact.
                if (status.state === 'conflict') return;
                useSaveStatusStore.getState().setSaving(projectName, documentKey);
                try {
                  const response = await chaptersClient.updateContent(
                    numId,
                    partial.content as string,
                    {
                      expected_revision: status.revision,
                      expected_filename: status.filename ?? chapter.filename,
                      expected_document_key: documentKey,
                    }
                  );
                  useSaveStatusStore
                    .getState()
                    .setSaved(
                      projectName,
                      documentKey,
                      response.revision,
                      response.filename
                    );
                } catch (error) {
                  recordContentSaveFailure(projectName, documentKey, error);
                  throw error;
                }
              }
            );
          }
        }
        if (partial.title !== undefined)
          await chaptersClient.updateTitle(numId, partial.title);
        if (partial.summary !== undefined)
          await chaptersClient.updateSummary(numId, partial.summary);
        // Metadata fields are managed through dedicated metadata flows to avoid
        // partial writes racing with dialog autosave.
      } catch (e) {
        console.error('Failed to update chapter', e);
      }
    },
    [updateStoryDraft]
  );

  const updateBook = useCallback(
    async (id: string, partial: Partial<Book>): Promise<void> => {
      const story = latestStoryRef.current;
      const newBooks =
        story.books?.map((b: Book): Book => (b.id === id ? { ...b, ...partial } : b)) ||
        [];
      const newState = { ...story, books: newBooks };
      const bookTitle =
        story.books?.find((book: Book): boolean => book.id === id)?.title ||
        partial.title ||
        'Untitled';
      pushStateRef.current(newState, `Update book: ${bookTitle}`);
      // Book persistence stays at call sites that own the surrounding workflow
      // (rename, reorder, metadata edit) to keep this hook narrowly scoped.
    },
    []
  );

  const addChapter = useCallback(
    async (
      title: string = 'New Chapter',
      _summary: string = '',
      bookId?: string
    ): Promise<void> => {
      try {
        const res = await api.chapters.create(title, '', bookId);
        const chaptersRes = await api.chapters.list();
        const newChapters: Chapter[] = mapApiChapters(chaptersRes.chapters);

        const newChapter = newChapters.find(
          (c: Chapter): boolean => c.id === String(res.id)
        );
        if (!newChapter) {
          throw new Error('Created chapter not found in refreshed chapter list');
        }

        const story = latestStoryRef.current;
        const refreshedScenes = story.id
          ? await api
              .forProject(story.id)
              .scenes.list()
              .catch((e: unknown): Scene[] => {
                console.error('Failed to refresh scenes after chapter creation', e);
                return story.scenes ?? [];
              })
          : (story.scenes ?? []);
        const newState: StoryState = {
          ...story,
          chapters: newChapters,
          scenes: Array.isArray(refreshedScenes)
            ? refreshedScenes
            : (story.scenes ?? []),
          currentChapterId: newChapter.id,
          lastUpdated: Date.now(),
        };
        pushStateRef.current(newState, `Create chapter: ${newChapter.title || title}`);
      } catch (e) {
        console.error('Failed to add chapter', e);
      }
    },
    []
  );

  const deleteChapter = useCallback(async (id: string): Promise<void> => {
    try {
      const story = latestStoryRef.current;
      const currentChapterId = currentChapterIdRef.current;
      const deletedChapter = story.chapters.find((c: Chapter): boolean => c.id === id);
      const currentChap = story.chapters.find(
        (c: Chapter): boolean => c.id === currentChapterId
      );

      await api.chapters.delete(Number(id));

      // Re-fetch after deletion because positional IDs can shift in series mode.
      const chaptersRes = await api.chapters.list();
      const newChapters: Chapter[] = mapApiChapters(chaptersRes.chapters);
      const refreshedScenes = story.id
        ? await api
            .forProject(story.id)
            .scenes.list()
            .catch((e: unknown): Scene[] => {
              console.error('Failed to refresh scenes after chapter deletion', e);
              return story.scenes ?? [];
            })
        : (story.scenes ?? []);

      // Re-anchor via stable file/book coordinates instead of transient numeric IDs.
      let newSelection = null;
      if (currentChapterId !== id && currentChap) {
        const matching = newChapters.find(
          (c: Chapter): boolean =>
            c.filename === currentChap.filename && c.book_id === currentChap.book_id
        );
        if (matching) {
          newSelection = matching.id;
        }
      }

      // Keep editor continuity by selecting a nearby chapter when possible.
      if (!newSelection && newChapters.length > 0) {
        const oldIndex = story.chapters.findIndex((c: Chapter): boolean => c.id === id);
        newSelection =
          newChapters[oldIndex]?.id || newChapters[newChapters.length - 1].id;
      }

      const newState: StoryState = {
        ...story,
        chapters: newChapters,
        scenes: Array.isArray(refreshedScenes) ? refreshedScenes : (story.scenes ?? []),
        currentChapterId: newSelection,
        lastUpdated: Date.now(),
      };
      pushStateRef.current(newState, `Delete chapter: ${deletedChapter?.title || id}`);
    } catch (e) {
      console.error('Failed to delete chapter', e);
    }
  }, []);

  const loadStory = useCallback(
    (storyToLoad: StoryState): void => {
      // Keep backend active-project context aligned before local state updates.
      if (storyToLoad.id) {
        api.projects
          .select(storyToLoad.id)
          .then((): Promise<void> => fetchStory())
          .catch((e: unknown): void => console.error('Failed to select project', e));
      }

      const loadedChapterId =
        storyToLoad.currentChapterId ??
        (storyToLoad.chapters.length > 0 ? storyToLoad.chapters[0].id : null);
      const newStory = { ...storyToLoad, currentChapterId: loadedChapterId };

      useStoryStore.setState({
        story: newStory,
        history: [createHistoryEntry(newStory, 'Load story')],
        currentIndex: 0,
        baselineState: newStory,
        isChapterLoading: false,
        currentChapterId: loadedChapterId,
      });
      latestStoryRef.current = newStory;
      lastLoadedChapterId.current = null;
      useStoryStore.getState().incrementLoadChapterSignal();
    },
    [story.id, fetchStory]
  );

  const undoSteps = useCallback(
    async (steps: number): Promise<void> => {
      const { currentIndex, history } = useStoryStore.getState();
      if (steps <= 0 || currentIndex <= 0) return;
      const targetIndex = Math.max(0, currentIndex - steps);
      const callbacks: Array<() => Promise<void> | void> = [];
      for (let idx = currentIndex; idx > targetIndex; idx -= 1) {
        const handler = history[idx].onUndo;
        if (handler) callbacks.push(handler);
      }

      const prevState = history[targetIndex].state;
      useChatStore.getState().setSessionMutations([]);

      // Mark the re-render as a transition so React can time-slice it,
      // keeping the main thread responsive (avoids click-handler violations).
      startTransition((): void => {
        // Baseline = the state we're leaving so undo-restored text is highlighted.
        useStoryStore.getState().jumpHistory({
          story: prevState,
          currentChapterId: prevState.currentChapterId ?? null,
          currentIndex: targetIndex,
          baselineState: history[currentIndex].state,
        });
      });
      // jumpHistory preserves currentChapterId from the store, not from
      // prevState.  Sync the ref so the next updateChapter reads the
      // correct chapter — otherwise typing after undo switches chapters.
      latestStoryRef.current = {
        ...prevState,
        currentChapterId: useStoryStore.getState().currentChapterId,
      };

      for (const callback of callbacks) {
        await callback();
      }
    },
    [] // empty – reads fresh state via getState()
  );

  const redoSteps = useCallback(
    async (steps: number): Promise<void> => {
      const { currentIndex, history } = useStoryStore.getState();
      if (steps <= 0 || currentIndex >= history.length - 1) return;
      const targetIndex = Math.min(history.length - 1, currentIndex + steps);
      const callbacks: Array<() => Promise<void> | void> = [];
      for (let idx = currentIndex + 1; idx <= targetIndex; idx += 1) {
        const handler = history[idx].onRedo;
        if (handler) callbacks.push(handler);
      }

      const nextState = history[targetIndex].state;

      // Mark the re-render as a transition so React can time-slice it,
      // keeping the main thread responsive (avoids click-handler violations).
      startTransition((): void => {
        // Baseline = the state we're leaving so redo-restored text is highlighted.
        useStoryStore.getState().jumpHistory({
          story: nextState,
          currentChapterId: nextState.currentChapterId ?? null,
          currentIndex: targetIndex,
          baselineState: history[currentIndex].state,
        });
      });
      latestStoryRef.current = {
        ...nextState,
        currentChapterId: useStoryStore.getState().currentChapterId,
      };

      for (const callback of callbacks) {
        await callback();
      }
    },
    [] // empty – reads fresh state via getState()
  );

  // With Zustand, undoSteps and redoSteps use getState() so they never need
  // to be recreated. The stable ref wrappers below are kept for backward compat.
  const undoStepsRef = useRef(undoSteps);
  undoStepsRef.current = undoSteps;
  const redoStepsRef = useRef(redoSteps);
  redoStepsRef.current = redoSteps;

  const undo = useCallback(async (): Promise<void> => {
    await undoStepsRef.current(1);
  }, []);

  const redo = useCallback(async (): Promise<void> => {
    await redoStepsRef.current(1);
  }, []);

  // Stable wrappers for multi-step undo/redo — same ref pattern as undo/redo
  // above, preventing historyControls from getting a new object on every
  // debounced keystroke (undoSteps/redoSteps themselves depend on history+index).
  const undoStepsStable = useCallback(async (steps: number): Promise<void> => {
    await undoStepsRef.current(steps);
  }, []);

  const redoStepsStable = useCallback(async (steps: number): Promise<void> => {
    await redoStepsRef.current(steps);
  }, []);

  // Baseline is managed explicitly via setBaselineState — see pushState,
  // undoSteps, redoSteps, and loadStory above.

  // Advance the baseline to the current story state.  Call this whenever
  // the user starts a new action (e.g. sends a new chat message) so that
  // the NEXT AI operation's diff is relative to the post-previous-turn state
  // rather than the original load state.
  const advanceBaselineToCurrentStory = useCallback((): void => {
    useStoryStore.setState({ baselineState: latestStoryRef.current });
  }, []);

  /**
   * Patch sourcebook entries in the reactive story store so consumers like
   * Scenes/Convergence Map re-render immediately on in-app sourcebook edits.
   *
   * Returns `true` when an actual change was applied, `false` for no-op.
   */
  const patchSourcebook = useCallback(
    (entry: SourcebookEntry | null, entryId?: string): boolean => {
      const changed = useStoryStore.getState().patchSourcebookEntry(entry, entryId);
      if (!changed) return false;
      latestStoryRef.current = useStoryStore.getState().story;
      return true;
    },
    []
  );

  const undoOptions: StoryHistoryOption[] = [];
  for (let idx = currentIndex; idx > 0 && undoOptions.length < 10; idx -= 1) {
    undoOptions.push({
      id: history[idx].id,
      label: history[idx].label,
      steps: currentIndex - idx + 1,
    });
  }

  const redoOptions: StoryHistoryOption[] = [];
  for (
    let idx = currentIndex + 1;
    idx < history.length && redoOptions.length < 10;
    idx += 1
  ) {
    redoOptions.push({
      id: history[idx].id,
      label: history[idx].label,
      steps: idx - currentIndex,
    });
  }

  return {
    story,
    currentChapterId,
    selectChapter: (id: string | null): void => selectChapter(id),
    updateStoryMetadata,
    updateStoryImageSettings,
    updateChapter,
    addChapter,
    deleteChapter,
    updateBook,
    loadStory,
    refreshStory,
    reloadDocument,
    undo,
    redo,
    undoSteps: undoStepsStable,
    redoSteps: redoStepsStable,
    pushExternalHistoryEntry,
    undoOptions,
    redoOptions,
    nextUndoLabel: currentIndex > 0 ? history[currentIndex].label : null,
    nextRedoLabel:
      currentIndex < history.length - 1 ? history[currentIndex + 1].label : null,
    historyIndex: currentIndex,
    historySize: history.length,
    canUndo: currentIndex > 0,
    canRedo: currentIndex < history.length - 1,
    baselineState,
    advanceBaselineToCurrentStory,
    patchSourcebook,
    isChapterLoading,
  };
};
