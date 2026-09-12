// Copyright (C) 2026 AugmentedQuill contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/** Purpose: Verify discussion, explicit application, refinement and cancellation in the panel. */
// @vitest-environment jsdom

import React from 'react';
import { webcrypto } from 'node:crypto';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorHandle } from '../editor/Editor';
import type { LLMConfig } from '../../types';
import { WorkshopPanel } from './WorkshopPanel';
import {
  planPassageReplacement,
  type PassageSnapshot,
  type PassageTarget,
} from './passageTarget';
import type { WorkshopRequest, WorkshopResponse } from './types';

const { discuss } = vi.hoisted(() => ({ discuss: vi.fn() }));
vi.mock('../../services/api', () => ({
  api: { forProject: () => ({ workshop: { discuss } }) },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const model: LLMConfig = {
  id: 'local',
  name: 'Writer',
  baseUrl: 'http://localhost:8080/v1',
  apiKey: '',
  timeout: 60,
  modelId: 'writer',
};
let live: PassageSnapshot;
const apply = vi.fn((target: PassageTarget, replacement: string): void => {
  live = {
    ...live,
    content: planPassageReplacement(live, target, replacement).content,
  };
});
const editorRef = {
  current: {
    getPassageSnapshot: () => live,
    applyPassage: apply,
  } as unknown as EditorHandle,
};

function response(request: WorkshopRequest): WorkshopResponse {
  return {
    target_id: request.target.id,
    fingerprint: request.target.fingerprint,
    discussion: 'Here are two ways to sharpen the line.',
    alternatives: [
      { id: 'a', label: 'More immediate', replacement: 'She listened.' },
      { id: 'b', label: 'More visual', replacement: 'She watched the tide.' },
    ],
    context: {
      messages: [{ role: 'system', content: 'Fixture instructions' }],
      selected_lore: [],
      excluded_lore: [],
      warnings: [],
      budget: {
        context_limit_tokens: 4096,
        estimated_prompt_tokens: 200,
        output_reserve_tokens: 1024,
      },
    },
  };
}

function send(text: string = 'I don’t like this line.'): void {
  fireEvent.change(screen.getByRole('textbox', { name: 'workshop.message' }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'workshop.send' }));
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  discuss.mockReset();
  apply.mockClear();
  live = {
    projectId: 'fixture',
    documentId: '1',
    documentKey: 'chapter:harbour.md',
    chapterTitle: 'Harbour',
    scope: 'chapter',
    content: 'She waited. The tide rose. She waited.',
    selection: { anchor: 30, head: 30 },
    language: 'en',
  };
  discuss.mockImplementation(async (request: WorkshopRequest) => response(request));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkshopPanel', () => {
  it('attaches the caret on send, discusses without writing and applies only the chosen alternative', async () => {
    render(
      <WorkshopPanel
        projectId="fixture"
        editorRef={editorRef}
        model={model}
        language="en"
      />
    );
    send();
    await screen.findByText('Here are two ways to sharpen the line.');
    expect(discuss.mock.calls[0][0].target.from).toBe(27);
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'workshop.reject' })[0]);
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'workshop.apply' }));
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ originalText: 'She waited.', from: 27 }),
      'She watched the tide.'
    );
    expect(live.content).toBe('She waited. The tide rose. She watched the tide.');
  });

  it('includes prior alternatives when the author refines an option', async () => {
    render(
      <WorkshopPanel
        projectId="fixture"
        editorRef={editorRef}
        model={model}
        language="en"
      />
    );
    send();
    await screen.findByText('Here are two ways to sharpen the line.');
    send('Keep the second version, but make it less formal.');
    await waitFor(() => expect(discuss).toHaveBeenCalledTimes(2));
    const request = discuss.mock.calls[1][0] as WorkshopRequest;
    expect(request.messages[1].content).toContain('She watched the tide.');
    expect(request.target.id).toBe(discuss.mock.calls[0][0].target.id);
    expect(apply).not.toHaveBeenCalled();
  });

  it('retains the proposal and shows a conflict when prose changes during generation', async () => {
    render(
      <WorkshopPanel
        projectId="fixture"
        editorRef={editorRef}
        model={model}
        language="en"
      />
    );
    send();
    await screen.findByText('Here are two ways to sharpen the line.');
    live = { ...live, content: `${live.content} A new line.` };
    fireEvent.click(screen.getAllByRole('button', { name: 'workshop.apply' })[0]);
    expect(screen.getByRole('alert').textContent).toBe('workshop.error.changed');
    expect(screen.getByText('More immediate')).toBeTruthy();
    expect(live.content).toContain('A new line.');
  });

  it('aborts generation and ignores a late result without changing the manuscript', async () => {
    let finish: ((value: WorkshopResponse) => void) | undefined;
    discuss.mockImplementation(
      () =>
        new Promise<WorkshopResponse>((resolve: (value: WorkshopResponse) => void) => {
          finish = resolve;
        })
    );
    render(
      <WorkshopPanel
        projectId="fixture"
        editorRef={editorRef}
        model={model}
        language="en"
      />
    );
    send();
    await waitFor(() => expect(discuss).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'workshop.stop' }));
    expect((discuss.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    await act(async () => {
      finish?.(response(discuss.mock.calls[0][0] as WorkshopRequest));
    });
    expect(screen.queryByText('More immediate')).toBeNull();
    expect(screen.getByText('workshop.cancelled')).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
  });

  it('restores the pinned target and alternatives when the panel reopens', async () => {
    const first = render(
      <WorkshopPanel
        projectId="fixture"
        editorRef={editorRef}
        model={model}
        language="en"
      />
    );
    send();
    await screen.findByText('Here are two ways to sharpen the line.');
    first.unmount();
    live = { ...live, documentId: '2' };
    render(
      <WorkshopPanel
        projectId="fixture"
        editorRef={editorRef}
        model={model}
        language="en"
      />
    );
    expect(screen.getByText('More immediate')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'workshop.apply' })[0]);
    expect(screen.getByRole('alert').textContent).toBe('workshop.error.document');
  });
});
