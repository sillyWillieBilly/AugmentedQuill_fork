// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: English fallback text for the passage workshop. */
export const workshopEnglish = {
  workshop: {
    title: 'Passage workshop',
    tab: 'Workshop',
    chatTab: 'Project chat',
    loreTab: 'Lore',
    linked: {
      original: 'Editing original Markdown',
      saveHint:
        'Typing and applied wording save directly to this file. Watch the save status below.',
      structure:
        'These are the original files selected for this workspace. Drafts and alternatives keep their own status.',
      lore: 'Open the Lore tab on the right to inspect and edit the sourced knowledge used by Workshop.',
      workshopOnly:
        'Use Workshop for this linked book. It discusses the passage and offers wording you can choose to apply.',
    },
    subtitle: 'Explore the wording, with your story and lore close at hand.',
    empty:
      'Leave the caret in a sentence or select a passage. Your first message will attach that exact text.',
    attach: 'Use current passage',
    paragraph: 'Use paragraph',
    history: 'Previous workshops',
    scope: 'Viewpoint and story time',
    viewpoint: 'Viewpoint',
    timeline: 'Timeline ID',
    timelinePosition: 'Position in this timeline',
    timelineHint:
      'An explicit scene or event number. Lore can be available only from or until this point.',
    message: 'Workshop message',
    placeholder: 'I don’t like this line. Let’s workshop it…',
    thinking: 'Considering the passage and its context…',
    cancelled: 'Generation stopped. Your manuscript is unchanged.',
    send: 'Send to workshop',
    stop: 'Stop generation',
    applyHint: 'Your prose changes when you apply a proposal.',
    apply: 'Apply wording',
    reject: 'Reject',
    adjust: 'Adjust wording',
    compare: 'Show comparison',
    diff: 'Proposed changes',
    replacement: 'Replacement wording',
    applied: 'Applied in the editor. See the document’s save status.',
    rejected: 'Rejected',
    regenerate: 'Explore more alternatives',
    context: 'Context used',
    exactMessages: 'Exact messages sent to the model',
    loreIncluded: 'Lore included ({{count}})',
    loreExcluded: 'Lore excluded ({{count}})',
    loreRecord: 'Included record',
    unsupported: 'Preserved World Info settings that are not implemented',
    budgetCap: 'Workshop context cap: {{limit}} estimated tokens',
    matchedKeys: 'Matched keys: {{keys}}',
    reasons: {
      constant: 'Always included',
      matched: 'Matched passage or nearby prose',
      already_activated: 'Already included in an earlier recursion step',
      disabled: 'Disabled',
      status_excluded: 'Proposal or excluded belief',
      scope_excluded: 'Outside the current chapter, scene, viewpoint or timeline',
      primary_not_matched: 'No primary keyword or alias matched',
      secondary_not_satisfied: 'Secondary keyword conditions not met',
      excluded_from_recursion: 'Excluded from recursive activation',
      budget_exceeded: 'Did not fit in the lore budget',
    },
    budget:
      'Estimated prompt: {{used}} tokens · Response reserve: {{reserved}} · Context limit: {{limit}}',
    storageError:
      'The browser could not retain this workshop. Keep this tab open and copy any wording you need.',
    chatNotice: 'Project chat can edit chapters and lore when you ask it to.',
    save: {
      idle: 'Document open',
      pending: 'Unsaved changes · browser draft retained',
      saving: 'Saving…',
      saved: 'Saved',
      conflict: 'Save conflict · your local wording is retained',
      error: 'Save failed · your local wording is retained',
      download: 'Download current wording',
      reload: 'Download local wording and reload disk',
      storageError:
        'The browser could not retain your draft. Download your wording before leaving this document.',
      recovery: 'A local draft from {{date}} is available.',
      restore: 'Recover in editor',
      downloadRecovery: 'Download recovered draft',
      recoveryConflict:
        'The recovered draft has a different disk revision. Review it alongside the current file; automatic saving is paused.',
    },
    role: { user: 'You', assistant: 'Writing partner', system: 'Story instructions' },
    recovery: {
      title: 'Saved recovery history',
      hint: 'Preview earlier wording, then restore it in the editor. You can undo the change; saving checks the current disk revision.',
      refresh: 'Refresh checkpoints',
      loading: 'Loading recovery history…',
      empty: 'No saved checkpoints for this document yet.',
      committed: 'Saved change',
      prepared: 'Interrupted or unacknowledged save',
      version: 'Checkpoint wording',
      before: 'Before this save',
      after: 'After this save',
      preview: 'Recovery wording preview',
      restore: 'Restore checkpoint in editor',
      download: 'Download checkpoint wording',
      documentChanged:
        'The document changed or has unsaved work. Finish or recover that save, then reopen this checkpoint before restoring it.',
    },
    kind: { selection: 'Selection', sentence: 'Sentence', paragraph: 'Paragraph' },
    error: {
      document:
        'Open the original project and chapter to apply this proposal, or attach a new passage.',
      changed:
        'The manuscript has changed since this passage was attached. Your proposal is still here; attach the current wording to continue.',
      range:
        'This selection cannot be mapped precisely. Select the complete passage again.',
      markers:
        'This change would move or damage a scene or annotation boundary. Adjust the selection or wording.',
      empty: 'Place the caret in prose or select a non-empty passage first.',
    },
  },
};
