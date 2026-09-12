// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the content revision unit so editor saves remain bound to the
 * document that was loaded and queued per document without fetching a new
 * base immediately before a write.
 */

import { ApiRequestError } from './apiClients/shared';

export interface RevisionedContent {
  content: string;
  revision: string;
  filename: string;
  document_key: string;
}

export interface ContentWriteOptions {
  expected_revision?: string;
  expected_filename?: string;
  expected_document_key?: string;
}

export interface ContentSaveFailure {
  status: number;
  message: string;
  payload: Record<string, unknown> | null;
}

/** Return structured failure information when an HTTP content save fails. */
export function contentSaveFailure(error: unknown): ContentSaveFailure | null {
  if (!(error instanceof ApiRequestError)) return null;
  const payload =
    error.payload !== null && typeof error.payload === 'object'
      ? (error.payload as Record<string, unknown>)
      : null;
  return { status: error.status, message: error.message, payload };
}

/** Stable key used by save queues and the save-status store. */
export function contentDocumentKey(projectName: string, documentKey: string): string {
  return JSON.stringify([projectName, documentKey]);
}

type QueuedOperation<T> = () => Promise<T>;

const contentSaveQueues = new Map<string, Promise<unknown>>();
const contentSaveGenerations = new Map<string, number>();

/** Invalidate queued saves before an explicit reload or document replacement. */
export function invalidateContentSaves(key: string): void {
  contentSaveGenerations.set(key, (contentSaveGenerations.get(key) ?? 0) + 1);
}

/**
 * Serialize writes for one project/document while allowing independent
 * documents to save concurrently.  A failed operation does not strand the
 * queue; the next operation runs and can observe the retained conflict state.
 */
export function enqueueContentSave<T>(
  key: string,
  operation: QueuedOperation<T>
): Promise<T> {
  const previous = contentSaveQueues.get(key) ?? Promise.resolve();
  const generation = contentSaveGenerations.get(key) ?? 0;
  const next = previous
    .catch(() => undefined)
    .then(() => {
      if ((contentSaveGenerations.get(key) ?? 0) !== generation) {
        return undefined as T;
      }
      return operation();
    });
  contentSaveQueues.set(key, next);
  void next.then(
    (): void => {
      if (contentSaveQueues.get(key) === next) contentSaveQueues.delete(key);
    },
    (): void => {
      if (contentSaveQueues.get(key) === next) contentSaveQueues.delete(key);
    }
  );
  return next;
}
