// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Index explicit Markdown divisions without changing the manuscript. */

import { stripInlineInternalMarkers, toVisibleOffset } from '../editor/internalTags';

export interface LinkedOutlineEntry {
  kind: 'opening' | 'heading' | 'scene' | 'break';
  /** Source heading text or existing scene marker identifier. */
  title: string;
  /** Marker-stripped UTF-16 offset, retaining the source line separators. */
  offset: number;
  line: number;
  excerpt: string;
}

type IndexedEntry = LinkedOutlineEntry & { excerptStart: number };

/** Logical source lines follow the same configured separator as CodeMirror. */
export function parseLinkedSceneOutline(
  content: string,
  lineSeparator?: string
): LinkedOutlineEntry[] {
  const separator = lineSeparator ?? content.match(/\r\n|\r|\n/)?.[0] ?? '\n';
  const lines = content.split(separator);
  const visible = stripInlineInternalMarkers(content);
  const entries: IndexedEntry[] = [
    {
      kind: 'opening',
      title: '',
      offset: content.startsWith('\uFEFF') ? 1 : 0,
      line: 1,
      excerpt: '',
      excerptStart: 0,
    },
  ];
  let rawStart = 0;
  let firstContent = true;
  let fence: { character: string; length: number } | null = null;
  const add = (
    kind: LinkedOutlineEntry['kind'],
    title: string,
    rawOffset: number,
    line: number,
    excerptStart: number
  ): void => {
    entries.push({
      kind,
      title,
      offset: toVisibleOffset(content, rawOffset),
      line,
      excerpt: '',
      excerptStart: toVisibleOffset(content, excerptStart),
    });
  };
  lines.forEach((rawLine: string, index: number) => {
    const line = stripInlineInternalMarkers(rawLine).replace(/^\uFEFF/u, '');
    const nextStart = Math.min(
      rawStart + rawLine.length + separator.length,
      content.length
    );
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence.character &&
        fenceMatch[1].length >= fence.length &&
        !fenceMatch[2].trim()
      )
        fence = null;
    } else if (
      fenceMatch &&
      (fenceMatch[1][0] !== '`' || !fenceMatch[2].includes('`'))
    ) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
      firstContent = false;
    } else {
      const heading = /^ {0,3}(#{1,6})(?:[\t ]+(.*)|[\t ]*)$/u.exec(line);
      if (heading) {
        if (firstContent && heading[1].length === 1) {
          entries[0].excerptStart = toVisibleOffset(content, nextStart);
        } else {
          add(
            'heading',
            (heading[2] || '').replace(/[\t ]+#+[\t ]*$/u, '').trim(),
            rawStart,
            index + 1,
            nextStart
          );
        }
      } else if (
        /^ {0,3}(?:(?:\*[\t ]*){3,}|(?:-[\t ]*){3,}|(?:_[\t ]*){3,})$/u.test(line)
      ) {
        // A closing rule before an export-only page break starts no new scene.
        const following = stripInlineInternalMarkers(content.slice(nextStart))
          .replace(
            /<div\s+style=(["'])\s*page-break-after:\s*always;?\s*\1\s*>\s*<\/div>/giu,
            ''
          )
          .trim();
        if (following) add('break', '', rawStart, index + 1, nextStart);
      }
      for (const marker of rawLine.matchAll(/<!--scene:([^:>]+):start-->/gu)) {
        add(
          'scene',
          marker[1],
          rawStart + marker.index,
          index + 1,
          rawStart + marker.index + marker[0].length
        );
      }
      if (line.trim()) firstContent = false;
    }
    rawStart = nextStart;
  });
  return entries
    .sort((a: IndexedEntry, b: IndexedEntry) => a.offset - b.offset)
    .map(
      (
        { excerptStart, ...entry }: IndexedEntry,
        index: number,
        all: IndexedEntry[]
      ) => {
        const end = all[index + 1]?.offset ?? visible.length;
        return {
          ...entry,
          excerpt: Array.from(
            visible
              .slice(excerptStart, Math.max(excerptStart, end))
              .replace(/\s+/gu, ' ')
              .trim()
          )
            .slice(0, 120)
            .join(''),
        };
      }
    );
}
