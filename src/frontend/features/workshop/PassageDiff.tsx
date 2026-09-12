// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Show the exact proposed prose change as an accessible inline comparison. */
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DiffMatchPatch from 'diff-match-patch';

export function PassageDiff({
  original,
  replacement,
}: {
  original: string;
  replacement: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const parts = useMemo(() => {
    const differ = new DiffMatchPatch();
    const changes = differ.diff_main(original, replacement);
    differ.diff_cleanupSemantic(changes);
    return changes;
  }, [original, replacement]);
  return (
    <div
      aria-label={t('workshop.diff')}
      className="whitespace-pre-wrap break-words font-serif text-sm leading-relaxed"
    >
      {parts.map(([operation, value]: [number, string], index: number) =>
        operation < 0 ? (
          <del key={index} className="bg-rose-500/15 text-rose-400">
            {value}
          </del>
        ) : operation > 0 ? (
          <ins key={index} className="bg-emerald-500/15 text-emerald-400 no-underline">
            {value}
          </ins>
        ) : (
          <span key={index}>{value}</span>
        )
      )}
    </div>
  );
}
