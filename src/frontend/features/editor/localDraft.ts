// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Preserve exact unsaved buffers independently of navigation and server saves. */
import { contentDocumentKey } from '../../services/contentRevision';
import { manuscriptFingerprint } from '../workshop/passageTarget';

export interface LocalDraft {
  projectId: string;
  documentKey: string;
  content: string;
  baseRevision?: string;
  updatedAt: string;
}

function storageKey(projectId: string, documentKey: string): string {
  return `aq-unsaved-v1:${contentDocumentKey(projectId, documentKey)}`;
}

export function readLocalDraft(
  projectId: string,
  documentKey: string
): LocalDraft | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(storageKey(projectId, documentKey)) || 'null'
    );
    if (!value || typeof value !== 'object') return null;
    const draft = value as Partial<LocalDraft>;
    if (
      draft.projectId !== projectId ||
      draft.documentKey !== documentKey ||
      typeof draft.content !== 'string' ||
      typeof draft.updatedAt !== 'string' ||
      (draft.baseRevision !== undefined && typeof draft.baseRevision !== 'string')
    )
      return null;
    return draft as LocalDraft;
  } catch {
    return null;
  }
}

/** Return failure explicitly: storage quota/privacy errors are not successful backups. */
export function writeLocalDraft(draft: LocalDraft): boolean {
  try {
    localStorage.setItem(
      storageKey(draft.projectId, draft.documentKey),
      JSON.stringify(draft)
    );
    return true;
  } catch {
    return false;
  }
}

/** Clear only the exact buffer acknowledged by the server, never a newer local edit. */
export async function clearAcknowledgedDraft(
  projectId: string,
  documentKey: string,
  revision: string
): Promise<boolean> {
  const draft = readLocalDraft(projectId, documentKey);
  if (!draft || (await manuscriptFingerprint(draft.content)) !== revision) return false;
  const current = readLocalDraft(projectId, documentKey);
  if (current?.content === draft.content && current.updatedAt === draft.updatedAt) {
    localStorage.removeItem(storageKey(projectId, documentKey));
    return true;
  }
  return false;
}

export function downloadBuffer(filename: string, content: string): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: 'text/markdown;charset=utf-8' })
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filename.replace(/\.[^.]+$/, '') || 'manuscript'}-unsaved.md`;
  anchor.click();
  setTimeout((): void => URL.revokeObjectURL(url), 1000);
}
