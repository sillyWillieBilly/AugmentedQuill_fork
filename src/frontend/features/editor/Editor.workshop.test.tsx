// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Exercise workshop capture/application through the real CodeMirror editor. */
// @vitest-environment jsdom

import React, { createRef } from 'react';
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor, type EditorHandle } from './Editor';
import {
  useStoryStore,
  resetStoryStore,
  type StoryStoreState,
} from '../../stores/storyStore';
import { capturePassage } from '../workshop/passageTarget';
import { stripInlineInternalMarkers } from './internalTags';
import { readLocalDraft } from './localDraft';
import type { ViewMode, WritingUnit } from '../../types';
import { useSaveStatusStore } from '../../stores/saveStatusStore';

const raw =
  '<!--scene:1:start-->She waited. The tide rose. She waited.<!--scene:1:end-->';
const chapter: WritingUnit = {
  id: '1',
  scope: 'chapter',
  title: 'Harbour',
  filename: 'harbour.md',
  document_key: 'chapters/harbour.md',
  content: raw,
  summary: '',
};
const crlfChapter: WritingUnit = {
  ...chapter,
  content:
    '<!--scene:1:start-->First paragraph.\r\n\r\nSecond sentence.<!--scene:1:end-->\r\n\r\nOutside paragraph.',
};
const mixedNewlineChapter: WritingUnit = {
  ...chapter,
  content:
    '<!--scene:1:start-->First.\r\nSecond.\nThird sentence.<!--scene:1:end-->\r\nOutside.\nTail.',
};
const lfFirstMixedChapter: WritingUnit = {
  ...chapter,
  content:
    '<!--scene:1:start-->First.\nSecond.\r\nThird sentence.<!--scene:1:end-->\nOutside.',
};
const onChange = vi.fn();

function editorElement(
  editor: React.RefObject<EditorHandle | null>,
  viewMode: ViewMode,
  chapterOverride: WritingUnit
): React.ReactElement {
  return (
    <Editor
      ref={editor}
      chapter={chapterOverride}
      settings={{
        theme: 'mixed',
        brightness: 1,
        contrast: 1,
        fontSize: 16,
        maxWidth: 800,
        sidebarWidth: 320,
        showDiff: true,
      }}
      viewMode={viewMode}
      onChange={onChange}
      language="en"
      aiControls={{ onAiAction: vi.fn(), isAiLoading: false }}
      suggestionControls={{
        continuations: [],
        suggestionMode: 'guided',
        setSuggestionMode: vi.fn(),
        isSuggesting: false,
        onTriggerSuggestions: vi.fn(),
        onAcceptContinuation: vi.fn(),
        isSuggestionMode: false,
        onKeyboardSuggestionAction: vi.fn(),
      }}
    />
  );
}

function mountEditor(
  viewMode: ViewMode = 'raw',
  chapterOverride: WritingUnit = chapter
): {
  editor: React.RefObject<EditorHandle | null>;
  rerender: ReturnType<typeof render>['rerender'];
  rerenderChapter: (nextChapter: WritingUnit) => void;
} {
  const editor = createRef<EditorHandle>();
  const mounted = render(editorElement(editor, viewMode, chapterOverride));
  const rerenderChapter = (nextChapter: WritingUnit): void => {
    mounted.rerender(editorElement(editor, viewMode, nextChapter));
  };
  const { rerender } = mounted;
  return { editor, rerender, rerenderChapter };
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  onChange.mockClear();
  useStoryStore.setState((state: StoryStoreState) => ({
    story: { ...state.story, id: 'fixture' },
  }));
});
afterEach(() => {
  cleanup();
  useSaveStatusStore.getState().clear('fixture', chapter.document_key!);
  resetStoryStore();
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.useRealTimers();
});

describe('Editor workshop integration', () => {
  it.each(['raw', 'markdown', 'wysiwyg'] as const)(
    'captures the same raw target in %s mode',
    async (mode: ViewMode) => {
      const { editor } = mountEditor(mode);
      act(() => {
        editor.current?.jumpToPosition(30, 30);
      });
      const source = editor.current?.getPassageSnapshot();
      expect(source?.content).toBe(raw);
      const target = await capturePassage(source!);
      expect(target.originalText).toBe('She waited.');
      expect(target.from).toBe('She waited. The tide rose. '.length);
      expect(target.projectId).toBe('fixture');
    }
  );

  it('preserves CRLF and marked surrounding prose when applying one paragraph', async () => {
    vi.useFakeTimers();
    const { editor } = mountEditor('raw', crlfChapter);
    const visible = stripInlineInternalMarkers(crlfChapter.content);
    const caret = visible.indexOf('Second sentence') + 3;
    act(() => {
      editor.current?.jumpToPosition(caret, caret);
    });

    const source = editor.current?.getPassageSnapshot();
    expect(source?.content).toBe(crlfChapter.content);
    expect(source?.selection).toEqual({ anchor: caret, head: caret });
    const target = await capturePassage(source!);
    expect(target.originalText).toBe('Second sentence.');
    expect(target.from).toBe(visible.indexOf('Second sentence'));

    act(() => {
      editor.current?.applyPassage(target, 'Rewritten sentence.');
    });

    expect(editor.current?.getPassageSnapshot()?.content).toBe(
      '<!--scene:1:start-->First paragraph.\r\n\r\nRewritten sentence.<!--scene:1:end-->\r\n\r\nOutside paragraph.'
    );
    act(() => {
      vi.advanceTimersByTime(301);
    });
    expect(onChange).toHaveBeenLastCalledWith(
      '1',
      {
        content:
          '<!--scene:1:start-->First paragraph.\r\n\r\nRewritten sentence.<!--scene:1:end-->\r\n\r\nOutside paragraph.',
      },
      false
    );

    act(() => {
      editor.current?.undo();
    });
    expect(editor.current?.getPassageSnapshot()?.content).toBe(crlfChapter.content);
    act(() => {
      editor.current?.redo();
    });
    expect(editor.current?.getPassageSnapshot()?.content).toBe(
      '<!--scene:1:start-->First paragraph.\r\n\r\nRewritten sentence.<!--scene:1:end-->\r\n\r\nOutside paragraph.'
    );
  });

  it('keeps the CodeMirror view and history when typing the first newline', () => {
    const { editor } = mountEditor();
    const view = editor.current?.getEditorView();
    expect(view).not.toBeNull();

    act(() => {
      view?.dispatch({
        changes: { from: view.state.doc.length, insert: '\nNext paragraph.' },
      });
    });

    expect(editor.current?.getEditorView()).toBe(view);
    expect(
      stripInlineInternalMarkers(editor.current?.getPassageSnapshot()?.content || '')
    ).toBe('She waited. The tide rose. She waited.\nNext paragraph.');
    act(() => {
      editor.current?.undo();
    });
    expect(editor.current?.getPassageSnapshot()?.content).toBe(raw);
  });

  it('keeps the view and history when the parent acknowledges that newline', () => {
    vi.useFakeTimers();
    const { editor, rerenderChapter } = mountEditor();
    const view = editor.current?.getEditorView();
    expect(view).not.toBeNull();

    act(() => {
      view?.dispatch({
        changes: { from: view.state.doc.length, insert: '\nNext paragraph.' },
      });
      vi.advanceTimersByTime(301);
    });
    const acknowledgedContent = editor.current?.getPassageSnapshot()?.content;
    expect(acknowledgedContent).toContain('\nNext paragraph.');

    act(() => {
      rerenderChapter({ ...chapter, content: acknowledgedContent! });
    });

    expect(editor.current?.getEditorView()).toBe(view);
    act(() => {
      editor.current?.undo();
    });
    expect(editor.current?.getPassageSnapshot()?.content).toBe(raw);
  });

  it('retains a CRLF separator after the acknowledged buffer becomes one line', () => {
    vi.useFakeTimers();
    const { editor, rerenderChapter } = mountEditor('raw', crlfChapter);
    const view = editor.current?.getEditorView();
    expect(view).not.toBeNull();
    const oneLine = stripInlineInternalMarkers(crlfChapter.content).replace(
      /\r\n|\r|\n/g,
      ' '
    );

    act(() => {
      view?.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: oneLine },
      });
      vi.advanceTimersByTime(301);
    });
    const acknowledgedContent = editor.current?.getPassageSnapshot()?.content;
    expect(acknowledgedContent).not.toMatch(/\r\n|\r|\n/);

    act(() => {
      rerenderChapter({ ...crlfChapter, content: acknowledgedContent! });
    });

    expect(editor.current?.getEditorView()).toBe(view);
    expect(view?.state.lineBreak).toBe('\r\n');
  });

  it('preserves mixed line endings outside a workshop replacement', async () => {
    const { editor } = mountEditor('raw', mixedNewlineChapter);
    const visible = stripInlineInternalMarkers(mixedNewlineChapter.content);
    const caret = visible.indexOf('Third sentence') + 2;
    act(() => {
      editor.current?.jumpToPosition(caret, caret);
    });
    const target = await capturePassage(editor.current?.getPassageSnapshot()!);
    expect(target.originalText).toBe('Third sentence.');

    act(() => {
      editor.current?.applyPassage(target, 'Rewritten.');
    });

    expect(editor.current?.getPassageSnapshot()?.content).toBe(
      '<!--scene:1:start-->First.\r\nSecond.\nRewritten.<!--scene:1:end-->\r\nOutside.\nTail.'
    );
  });

  it('keeps a CRLF literal when the document separator is LF', async () => {
    const { editor } = mountEditor('raw', lfFirstMixedChapter);
    const visible = stripInlineInternalMarkers(lfFirstMixedChapter.content);
    const from = visible.indexOf('Third sentence');
    act(() => {
      editor.current?.jumpToPosition(from, from);
    });
    const target = await capturePassage(editor.current?.getPassageSnapshot()!);
    expect(target.from).toBe(from);
    expect(target.originalText).toBe('Third sentence.');

    act(() => {
      editor.current?.applyPassage(target, 'Rewritten.');
    });

    expect(editor.current?.getPassageSnapshot()?.content).toBe(
      '<!--scene:1:start-->First.\nSecond.\r\nRewritten.<!--scene:1:end-->\nOutside.'
    );
  });

  it('keeps the manuscript selection while focus moves to chat', async () => {
    const { editor } = mountEditor();
    act(() => {
      editor.current?.jumpToPosition(0, 10);
    });
    const input = document.createElement('textarea');
    document.body.append(input);
    input.focus();
    expect(editor.current?.getPassageSnapshot()?.selection).toEqual({
      anchor: 0,
      head: 10,
    });
    input.remove();
  });

  it('captures unsaved typing, applies one transaction and supports immediate undo/redo', async () => {
    const { editor } = mountEditor();
    act(() => {
      const view = editor.current?.getEditorView();
      view?.dispatch({ changes: { from: 0, insert: '🌊 ' }, selection: { anchor: 4 } });
    });
    const source = editor.current?.getPassageSnapshot();
    expect(stripInlineInternalMarkers(source!.content)).toContain('🌊 She waited.');
    const target = await capturePassage(source!);
    act(() => {
      editor.current?.applyPassage(target, 'She watched the water.');
    });
    expect(editor.current?.getPassageSnapshot()?.content).toBe(
      '<!--scene:1:start-->She watched the water. The tide rose. She waited.<!--scene:1:end-->'
    );
    act(() => {
      editor.current?.undo();
    });
    expect(editor.current?.getPassageSnapshot()?.content).toBe(source?.content);
    act(() => {
      editor.current?.redo();
    });
    expect(editor.current?.getEditorView()?.state.doc.toString()).toBe(
      'She watched the water. The tide rose. She waited.'
    );
  });

  it('keeps a stale proposal available and refuses to overwrite new typing', async () => {
    const { editor } = mountEditor();
    const target = await capturePassage(editor.current!.getPassageSnapshot()!);
    act(() => {
      editor.current
        ?.getEditorView()
        ?.dispatch({ changes: { from: 0, insert: 'New ' } });
    });
    expect(() => editor.current?.applyPassage(target, 'She ran.')).toThrow('changed');
    expect(editor.current?.getEditorView()?.state.doc.toString()).toContain(
      'New She waited.'
    );
    expect(target.originalText).toBe('She waited.');
  });

  it('does not let a retained editor handle act on a newly selected chapter', async () => {
    const { editor, rerender } = mountEditor();
    const oldHandle = editor.current!;
    const target = await capturePassage(editor.current!.getPassageSnapshot()!);
    await act(async () => {
      rerender(
        <Editor
          ref={editor}
          chapter={{
            ...chapter,
            id: '2',
            title: 'Second chapter',
            document_key: 'chapters/second.md',
            content: 'Second chapter prose.',
          }}
          settings={{
            theme: 'mixed',
            brightness: 1,
            contrast: 1,
            fontSize: 16,
            maxWidth: 800,
            sidebarWidth: 320,
            showDiff: true,
          }}
          viewMode="raw"
          onChange={onChange}
          language="en"
          aiControls={{ onAiAction: vi.fn(), isAiLoading: false }}
          suggestionControls={{
            continuations: [],
            suggestionMode: 'guided',
            setSuggestionMode: vi.fn(),
            isSuggesting: false,
            onTriggerSuggestions: vi.fn(),
            onAcceptContinuation: vi.fn(),
            isSuggestionMode: false,
            onKeyboardSuggestionAction: vi.fn(),
          }}
        />
      );
    });

    expect(oldHandle.getPassageSnapshot()).toBeNull();
    expect(() => oldHandle.applyPassage(target, 'She ran.')).toThrow('document');
  });

  it('backs up typing immediately and cancels the pending write when leaving the editor', async () => {
    vi.useFakeTimers();
    const { editor } = mountEditor();
    act(() => {
      editor.current
        ?.getEditorView()
        ?.dispatch({ changes: { from: 0, insert: 'New ' } });
    });
    expect(
      stripInlineInternalMarkers(
        readLocalDraft('fixture', 'chapters/harbour.md')?.content || ''
      )
    ).toContain('New She waited.');
    cleanup();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(
      stripInlineInternalMarkers(
        readLocalDraft('fixture', 'chapters/harbour.md')?.content || ''
      )
    ).toContain('New She waited.');
    vi.useRealTimers();
  });

  it('resynchronizes a reloaded buffer while the reload request is still pending', async () => {
    vi.useFakeTimers();
    let resolveReload: (() => void) | undefined;
    const onReloadContent = vi.fn(
      () =>
        new Promise<void>((resolve: () => void) => {
          resolveReload = (): void => resolve();
        })
    );
    const { editor, rerender } = mountEditor();

    act(() => {
      editor.current?.getEditorView()?.dispatch({
        changes: { from: 0, insert: 'New ' },
      });
    });
    useSaveStatusStore
      .getState()
      .setConflict('fixture', chapter.document_key!, 'stale disk revision');

    rerender(
      <Editor
        ref={editor}
        chapter={chapter}
        settings={{
          theme: 'mixed',
          brightness: 1,
          contrast: 1,
          fontSize: 16,
          maxWidth: 800,
          sidebarWidth: 320,
          showDiff: true,
        }}
        viewMode="raw"
        onChange={onChange}
        onReloadContent={onReloadContent}
        language="en"
        aiControls={{ onAiAction: vi.fn(), isAiLoading: false }}
        suggestionControls={{
          continuations: [],
          suggestionMode: 'guided',
          setSuggestionMode: vi.fn(),
          isSuggesting: false,
          onTriggerSuggestions: vi.fn(),
          onAcceptContinuation: vi.fn(),
          isSuggestionMode: false,
          onKeyboardSuggestionAction: vi.fn(),
        }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Download local wording and reload disk' })
    );
    expect(onReloadContent).toHaveBeenCalledTimes(1);

    // The reload callback updates the same document's chapter prop before its
    // promise resolves.  The editor must accept that disk content immediately
    // instead of retaining the pre-reload pending gate forever.
    useSaveStatusStore.getState().setLoaded({
      projectName: 'fixture',
      documentKey: chapter.document_key!,
      filename: chapter.filename!,
      revision: 'reloaded-revision',
    });
    rerender(
      <Editor
        ref={editor}
        chapter={{ ...chapter, content: 'Reloaded from disk.' }}
        settings={{
          theme: 'mixed',
          brightness: 1,
          contrast: 1,
          fontSize: 16,
          maxWidth: 800,
          sidebarWidth: 320,
          showDiff: true,
        }}
        viewMode="raw"
        onChange={onChange}
        onReloadContent={onReloadContent}
        language="en"
        aiControls={{ onAiAction: vi.fn(), isAiLoading: false }}
        suggestionControls={{
          continuations: [],
          suggestionMode: 'guided',
          setSuggestionMode: vi.fn(),
          isSuggesting: false,
          onTriggerSuggestions: vi.fn(),
          onAcceptContinuation: vi.fn(),
          isSuggestionMode: false,
          onKeyboardSuggestionAction: vi.fn(),
        }}
      />
    );
    await act(async () => {});
    expect(editor.current?.getPassageSnapshot()?.content).toBe('Reloaded from disk.');

    resolveReload?.();
    await act(async () => {});
  });
});
