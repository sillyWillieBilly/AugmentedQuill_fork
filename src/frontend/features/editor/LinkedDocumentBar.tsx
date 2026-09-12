// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Identify the original Markdown file receiving editor saves. */
import React from 'react';
import { useTranslation } from 'react-i18next';

export function LinkedDocumentBar({
  sourcePath,
  manuscriptStatus,
}: {
  sourcePath?: string;
  manuscriptStatus?: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (!sourcePath) return null;
  return (
    <div className="shrink-0 border-b border-brand-gray-500/20 bg-indigo-500/5 px-4 py-2 text-xs">
      <p className="font-medium text-indigo-600 dark:text-indigo-300">
        {t('workshop.linked.original')}
        {manuscriptStatus ? ` · ${manuscriptStatus}` : ''}
      </p>
      <p className="mt-1 break-all text-brand-gray-500" title={sourcePath}>
        {sourcePath}
      </p>
      <p className="mt-1 text-brand-gray-500">{t('workshop.linked.saveHint')}</p>
    </div>
  );
}
