// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Keep global story history shortcuts from doubling local editor undo. */
// @vitest-environment jsdom

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBrowserHistory } from './useBrowserHistory';

interface HarnessProps {
  undo: () => void;
  redo: () => void;
}

function HistoryHarness({ undo, redo }: HarnessProps): null {
  useBrowserHistory({
    historyIndex: 0,
    canUndo: true,
    canRedo: true,
    undoSteps: vi.fn(),
    redoSteps: vi.fn(),
    undo,
    redo,
  });
  return null;
}

function shortcut(
  target: EventTarget,
  key: string = 'z',
  shiftKey: boolean = false
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: true,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe('useBrowserHistory keyboard routing', () => {
  it('does not invoke story undo after a local editor handler prevents the event', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    render(<HistoryHarness undo={undo} redo={redo} />);

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.addEventListener('keydown', (event: KeyboardEvent) => {
      event.preventDefault();
    });
    document.body.append(editor);

    const event = shortcut(editor);
    expect(event.defaultPrevented).toBe(true);
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it('leaves native input and contenteditable undo to their local history', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    render(<HistoryHarness undo={undo} redo={redo} />);

    const input = document.createElement('input');
    document.body.append(input);
    shortcut(input);

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.append(editor);
    shortcut(editor, 'y');

    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it('handles the shortcut from a noneditable target', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    render(<HistoryHarness undo={undo} redo={redo} />);

    const target = document.createElement('div');
    document.body.append(target);
    const event = shortcut(target);

    expect(event.defaultPrevented).toBe(true);
    expect(undo).toHaveBeenCalledOnce();
    expect(redo).not.toHaveBeenCalled();
  });
});
