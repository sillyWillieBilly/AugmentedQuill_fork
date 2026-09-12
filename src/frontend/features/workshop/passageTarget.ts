// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Capture immutable manuscript targets and plan checked, exact edits. */

import {
  stripInlineInternalMarkers,
  toOriginalOffset,
  transferInternalMarkers,
  validateMarkerIntegrity,
} from '../editor/internalTags';

export interface PassageSnapshot {
  projectId: string;
  documentId: string;
  documentKey: string;
  chapterTitle: string;
  bookId?: string;
  scope: 'chapter' | 'story';
  /** Canonical Markdown, including internal scene and annotation markers. */
  content: string;
  /** Offsets in the marker-stripped CodeMirror document, in UTF-16 code units. */
  selection: { anchor: number; head: number };
  /** CodeMirror's logical line separator; wrapping never adds source lines. */
  lineSeparator?: string;
  language: string;
}

export interface PassageTarget extends Omit<
  PassageSnapshot,
  'selection' | 'lineSeparator'
> {
  id: string;
  fingerprint: string;
  kind: 'selection' | 'sentence' | 'paragraph';
  from: number;
  to: number;
  rawFrom: number;
  rawTo: number;
  originalText: string;
  contextBefore: string;
  contextAfter: string;
  sceneId: string | null;
}

export class PassageConflict extends Error {
  constructor(
    public readonly code: 'document' | 'changed' | 'range' | 'markers' | 'empty'
  ) {
    super(code);
    this.name = 'PassageConflict';
  }
}

interface TextRange {
  from: number;
  to: number;
}

/** Resolve paragraph boundaries without treating visual wrapping as a line break. */
function paragraphRange(text: string, caret: number): TextRange {
  let from = 0;
  let to = text.length;
  for (const match of text.matchAll(/\r?\n[\t ]*\r?\n/g)) {
    if (match.index + match[0].length <= caret) from = match.index + match[0].length;
    else if (match.index >= caret) {
      to = match.index;
      break;
    }
  }
  return trimRange(text, { from, to });
}

/** Trim a resolved sentence/paragraph while retaining explicit selections verbatim. */
function trimRange(text: string, range: TextRange): TextRange {
  let { from, to } = range;
  while (from < to && /\s/u.test(text[from])) from++;
  while (to > from && /\s/u.test(text[to - 1])) to--;
  return { from, to };
}

/** Check source positions at grapheme boundaries, not just within string length. */
function validateRange(text: string, range: TextRange, language: string): void {
  const { from, to } = range;
  if (
    ![from, to].every(Number.isInteger) ||
    from < 0 ||
    to > text.length ||
    to < from
  ) {
    throw new PassageConflict('range');
  }
  const boundaries = new Set([0, text.length]);
  try {
    for (const part of new Intl.Segmenter(language, {
      granularity: 'grapheme',
    }).segment(text)) {
      boundaries.add(part.index);
    }
  } catch {
    throw new PassageConflict('range');
  }
  if (!boundaries.has(from) || !boundaries.has(to)) throw new PassageConflict('range');
}

/** Resolve the caret's sentence, falling back visibly when no clear ending exists. */
function caretRange(
  text: string,
  caret: number,
  language: string,
  paragraph: boolean
): {
  range: TextRange;
  kind: 'sentence' | 'paragraph';
} {
  const range = paragraphRange(text, caret);
  const prose = text.slice(range.from, range.to);
  if (!paragraph) {
    for (const part of new Intl.Segmenter(language, {
      granularity: 'sentence',
    }).segment(prose)) {
      const start = range.from + part.index;
      const end = start + part.segment.length;
      if (caret >= start && (caret < end || (caret === end && end === range.to))) {
        const trimmed = trimRange(text, { from: start, to: end });
        const sentence = text.slice(trimmed.from, trimmed.to);
        if (
          /[.!?。！？]["'”’»\])]*$/u.test(sentence) &&
          !/^(?:Mr|Mrs|Ms|Dr|Prof|St)\.$/iu.test(sentence)
        ) {
          return { range: trimmed, kind: 'sentence' };
        }
      }
    }
  }
  return { range, kind: 'paragraph' };
}

/** Hash exactly the captured UTF-8 source bytes; do not normalize Unicode/newlines. */
export async function manuscriptFingerprint(content: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content)
  );
  return Array.from(new Uint8Array(digest), (value: number): string =>
    value.toString(16).padStart(2, '0')
  ).join('');
}

/** Resolve the enclosing scene from the canonical marker stream. */
function sceneAt(content: string, position: number): string | null {
  let active: string | null = null;
  for (const match of content
    .slice(0, position)
    .matchAll(/<!--scene:([^:>]+):(start|end)-->/g)) {
    active = match[2] === 'start' ? match[1] : null;
  }
  return active;
}

/** Capture once; future selection changes never mutate this conversation target. */
export async function capturePassage(
  snapshot: PassageSnapshot,
  preferred: 'sentence' | 'paragraph' = 'sentence'
): Promise<PassageTarget> {
  const text = stripInlineInternalMarkers(snapshot.content);
  const { anchor, head } = snapshot.selection;
  const selected = { from: Math.min(anchor, head), to: Math.max(anchor, head) };
  validateRange(text, selected, snapshot.language);
  const resolved =
    selected.from !== selected.to && preferred !== 'paragraph'
      ? { range: selected, kind: 'selection' as const }
      : caretRange(text, head, snapshot.language, preferred === 'paragraph');
  const { from, to } = resolved.range;
  if (!text.slice(from, to).trim()) throw new PassageConflict('empty');
  const rawFrom = toOriginalOffset(snapshot.content, from, { snapPastMarkers: true });
  const rawTo = toOriginalOffset(snapshot.content, to);
  const {
    selection: _selection,
    lineSeparator: _lineSeparator,
    ...document
  } = snapshot;
  return Object.freeze({
    ...document,
    id: crypto.randomUUID(),
    fingerprint: await manuscriptFingerprint(snapshot.content),
    kind: resolved.kind,
    from,
    to,
    rawFrom,
    rawTo,
    originalText: text.slice(from, to),
    contextBefore: text.slice(Math.max(0, from - 2000), from),
    contextAfter: text.slice(to, to + 2000),
    sceneId: sceneAt(snapshot.content, rawFrom),
  });
}

export interface PassageEdit {
  content: string;
  from: number;
  to: number;
  insert: string;
}

/** Produce an exact replacement; a changed source requires a new author decision. */
export function planPassageReplacement(
  current: PassageSnapshot,
  target: PassageTarget,
  replacement: string
): PassageEdit {
  if (
    current.projectId !== target.projectId ||
    current.documentId !== target.documentId ||
    current.documentKey !== target.documentKey ||
    current.scope !== target.scope
  ) {
    throw new PassageConflict('document');
  }
  if (current.content !== target.content) throw new PassageConflict('changed');
  const visible = stripInlineInternalMarkers(current.content);
  try {
    validateRange(visible, { from: target.from, to: target.to }, current.language);
  } catch {
    throw new PassageConflict('range');
  }
  if (
    target.rawFrom !==
      toOriginalOffset(current.content, target.from, { snapPastMarkers: true }) ||
    target.rawTo !== toOriginalOffset(current.content, target.to)
  ) {
    throw new PassageConflict('range');
  }
  if (
    visible.slice(target.from, target.to) !== target.originalText ||
    stripInlineInternalMarkers(current.content.slice(target.rawFrom, target.rawTo)) !==
      target.originalText
  ) {
    throw new PassageConflict('range');
  }
  if (/<!--\s*(?:scene|annotation):/iu.test(replacement))
    throw new PassageConflict('markers');
  try {
    validateMarkerIntegrity(current.content);
  } catch {
    throw new PassageConflict('markers');
  }
  // Transfer against the complete marker stream: the selected fragment can
  // contain only one edge of a scene/annotation and cannot be parsed as a span.
  const nextVisible =
    visible.slice(0, target.from) + replacement + visible.slice(target.to);
  const content = transferInternalMarkers(current.content, nextVisible);
  const prefix = current.content.slice(0, target.rawFrom);
  const suffix = current.content.slice(target.rawTo);
  if (
    !content.startsWith(prefix) ||
    !content.endsWith(suffix) ||
    content.length < prefix.length + suffix.length
  ) {
    throw new PassageConflict('markers');
  }
  try {
    validateMarkerIntegrity(content);
  } catch {
    throw new PassageConflict('markers');
  }
  return { content, from: target.from, to: target.to, insert: replacement };
}
