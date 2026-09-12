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
import type {
  WorkshopMessage,
  WorkshopRequest,
  WorkshopResponse,
  WorkshopSession,
} from './types';

const { discuss } = vi.hoisted(() => ({ discuss: vi.fn() }));
vi.mock('../../services/api', () => ({
  api: { forProject: () => ({ workshop: { discuss } }) },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
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

function stored(): { sessions: WorkshopSession[]; currentId: string } {
  return JSON.parse(localStorage.getItem('aq-workshop-v1:fixture') || '{}');
}

function panel(): React.JSX.Element {
  return (
    <WorkshopPanel
      projectId="fixture"
      editorRef={editorRef}
      model={model}
      language="en"
    />
  );
}

async function completedSend(text: string, count: number): Promise<void> {
  send(text);
  await waitFor(() => {
    expect(discuss).toHaveBeenCalledTimes(count);
    expect(screen.queryByText('workshop.thinking')).toBeNull();
  });
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
  vi.restoreAllMocks();
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

  it('captures a fresh caret on every follow-up without changing the pinned target', async () => {
    render(panel());
    await completedSend('First passage', 1);
    const target = (discuss.mock.calls[0][0] as WorkshopRequest).target;
    live = {
      ...live,
      documentId: '2',
      documentKey: 'chapter:harbour-later.md',
      chapterTitle: 'Later harbour',
      content: 'First line.\nSecond line.\nThird line.',
      selection: { anchor: 13, head: 27 },
    };
    await completedSend('Where is my cursor now?', 2);
    const request = discuss.mock.calls[1][0] as WorkshopRequest;
    expect(request.editor_context).toEqual(live);
    expect(request.target).toEqual(target);
    expect(stored().sessions[0].turns[2].editorPosition).toEqual({
      line: 3,
      column: 3,
      anchorLine: 2,
      anchorColumn: 2,
      selected: true,
      chapterTitle: 'Later harbour',
      documentKey: 'chapter:harbour-later.md',
    });
    expect(screen.getAllByText(/^workshop.sentPosition /)).toHaveLength(2);
    expect(screen.getByText(/^workshop.sentSelection /).textContent).toContain(
      '"anchorLine":2'
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it('sends explicit unavailable context when no valid live caret exists', async () => {
    render(panel());
    await completedSend('First passage', 1);
    live = { ...live, selection: { anchor: -1, head: -1 } };
    await completedSend('Where is my cursor?', 2);
    expect((discuss.mock.calls[1][0] as WorkshopRequest).editor_context).toBeNull();
    expect(stored().sessions[0].turns[2].editorPosition).toBeNull();
    expect(screen.getByText('workshop.positionUnavailable')).toBeTruthy();
  });

  it('rewinds an earlier user turn, retains the full original and resends only the retained context', async () => {
    render(panel());
    await completedSend('First question', 1);
    await completedSend('Second question', 2);
    await completedSend('Third question', 3);
    const original = stored().sessions[0];
    fireEvent.click(screen.getAllByRole('button', { name: 'workshop.rewind' })[1]);

    const branch = stored().sessions[1];
    expect(branch.turns).toEqual(original.turns.slice(0, 2));
    expect(branch.rewoundFrom).toEqual({
      sessionId: original.id,
      turnId: original.turns[2].id,
      messageNumber: 2,
    });
    expect(stored().sessions[0]).toEqual(original);
    expect(screen.queryByText('Third question')).toBeNull();
    expect(screen.queryByText('Second question', { selector: 'p' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'workshop.message' })).toHaveProperty(
      'value',
      'Second question'
    );
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'workshop.message' })
    );
    expect(screen.getByText(/^workshop.rewound /).textContent).toContain('"message":2');
    const options = screen.getAllByRole('option');
    expect(options[1].textContent).toContain('workshop.branchLabel');

    await completedSend('Revised second question', 4);
    const request = discuss.mock.calls[3][0] as WorkshopRequest;
    expect(request.messages.map((message: WorkshopMessage) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(request.messages[0].content).toBe('First question');
    expect(request.messages[2].content).toBe('Revised second question');
    expect(JSON.stringify(request.messages)).not.toContain('Second question');
    expect(JSON.stringify(request.messages)).not.toContain('Third question');
    expect(stored().sessions[0]).toEqual(original);
    expect(apply).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('combobox', { name: 'workshop.history' }), {
      target: { value: original.id },
    });
    expect(screen.getByText('Third question')).toBeTruthy();
    expect(screen.queryByText('Revised second question')).toBeNull();
  });

  it('persists a rewound branch and edited draft across reopening', async () => {
    const first = render(panel());
    await completedSend('Original question', 1);
    await completedSend('Question to edit', 2);
    const original = stored().sessions[0];
    fireEvent.click(screen.getAllByRole('button', { name: 'workshop.rewind' })[1]);
    fireEvent.change(screen.getByRole('textbox', { name: 'workshop.message' }), {
      target: { value: 'Edited draft waiting to send' },
    });
    const branchId = stored().currentId;
    first.unmount();
    render(panel());
    expect(stored().currentId).toBe(branchId);
    expect(screen.getByRole('textbox', { name: 'workshop.message' })).toHaveProperty(
      'value',
      'Edited draft waiting to send'
    );
    expect(screen.queryByText('Question to edit')).toBeNull();
    expect(stored().sessions[0]).toEqual(original);
    fireEvent.change(screen.getByRole('combobox', { name: 'workshop.history' }), {
      target: { value: original.id },
    });
    expect(screen.getByText('Question to edit')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'workshop.history' }), {
      target: { value: branchId },
    });
    expect(screen.getByRole('textbox', { name: 'workshop.message' })).toHaveProperty(
      'value',
      'Edited draft waiting to send'
    );
  });

  it('retains a conflicted message draft across conversation switches and reopening', async () => {
    const first = render(panel());
    await completedSend('Earlier conversation', 1);
    const originalId = stored().currentId;
    fireEvent.click(screen.getByRole('button', { name: 'workshop.attach' }));
    await waitFor(() => expect(stored().sessions).toHaveLength(2));
    const attachedId = stored().currentId;
    live = { ...live, content: `${live.content} Another sentence.` };
    send('Keep this unsent message after the conflict.');
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('workshop.error.changed');
      expect(screen.getByRole('textbox', { name: 'workshop.message' })).toHaveProperty(
        'value',
        'Keep this unsent message after the conflict.'
      );
    });
    expect(discuss).toHaveBeenCalledTimes(1);
    expect(stored().sessions[1].draft).toBe(
      'Keep this unsent message after the conflict.'
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'workshop.history' }), {
      target: { value: originalId },
    });
    expect(screen.getByRole('textbox', { name: 'workshop.message' })).toHaveProperty(
      'value',
      ''
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'workshop.history' }), {
      target: { value: attachedId },
    });
    expect(screen.getByRole('textbox', { name: 'workshop.message' })).toHaveProperty(
      'value',
      'Keep this unsent message after the conflict.'
    );
    first.unmount();
    render(panel());
    expect(screen.getByRole('textbox', { name: 'workshop.message' })).toHaveProperty(
      'value',
      'Keep this unsent message after the conflict.'
    );
  });

  it('does not restore a failed send into a conversation selected before the result settles', async () => {
    render(panel());
    await completedSend('Earlier conversation', 1);
    const originalId = stored().currentId;
    fireEvent.click(screen.getByRole('button', { name: 'workshop.attach' }));
    await waitFor(() => expect(stored().sessions).toHaveLength(2));
    live = { ...live, content: `${live.content} Another sentence.` };
    send('This prompt belongs to the newly attached conversation.');
    fireEvent.change(screen.getByRole('combobox', { name: 'workshop.history' }), {
      target: { value: originalId },
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(stored().currentId).toBe(originalId);
    expect(screen.getByRole('textbox', { name: 'workshop.message' })).toHaveProperty(
      'value',
      ''
    );
    expect(stored().sessions[0].draft).toBe('');
    expect(stored().sessions[1].draft).toBe(
      'This prompt belongs to the newly attached conversation.'
    );
  });

  it('retains the initial prompt if the manuscript changes during first attachment', async () => {
    vi.spyOn(editorRef.current, 'getPassageSnapshot')
      .mockImplementationOnce(() => live)
      .mockImplementationOnce(() => ({
        ...live,
        content: `${live.content} A concurrent edit.`,
      }));
    const first = render(panel());
    send('Keep this first message if attaching fails.');
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('workshop.error.changed');
      expect(stored().sessions).toHaveLength(1);
    });
    expect(discuss).not.toHaveBeenCalled();
    expect(stored().sessions[0].draft).toBe(
      'Keep this first message if attaching fails.'
    );
    expect(screen.getByRole('textbox', { name: 'workshop.message' })).toHaveProperty(
      'value',
      'Keep this first message if attaching fails.'
    );
    first.unmount();
    render(panel());
    expect(screen.getByRole('textbox', { name: 'workshop.message' })).toHaveProperty(
      'value',
      'Keep this first message if attaching fails.'
    );
  });

  it('cancels generation when rewinding and ignores its late result while a new request runs', async () => {
    const pending: ((value: WorkshopResponse) => void)[] = [];
    discuss.mockImplementation(
      () =>
        new Promise<WorkshopResponse>((resolve: (value: WorkshopResponse) => void) => {
          pending.push(resolve);
        })
    );
    render(panel());
    send('Question with a slow answer');
    await waitFor(() => expect(discuss).toHaveBeenCalledOnce());
    const original = stored().sessions[0];
    fireEvent.click(screen.getByRole('button', { name: 'workshop.rewind' }));
    expect((discuss.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    expect(stored().sessions[1].turns).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'workshop.message' })).toHaveProperty(
      'value',
      'Question with a slow answer'
    );
    send('Revised question');
    await waitFor(() => expect(discuss).toHaveBeenCalledTimes(2));
    await act(async () => {
      pending[0]({
        ...response(discuss.mock.calls[0][0] as WorkshopRequest),
        discussion: 'Late obsolete answer',
      });
    });
    expect(screen.queryByText('Late obsolete answer')).toBeNull();
    expect(screen.getByText('workshop.thinking')).toBeTruthy();
    expect(stored().sessions[0]).toEqual(original);
    await act(async () => {
      pending[1]({
        ...response(discuss.mock.calls[1][0] as WorkshopRequest),
        discussion: 'Answer for revised question',
      });
    });
    expect(screen.getByText('Answer for revised question')).toBeTruthy();
    expect(screen.queryByText('Late obsolete answer')).toBeNull();
    expect((discuss.mock.calls[1][0] as WorkshopRequest).messages).toEqual([
      { role: 'user', content: 'Revised question' },
    ]);
    expect(apply).not.toHaveBeenCalled();
  });

  it('preserves manuscript edits and shares apply receipts across retained branches', async () => {
    render(panel());
    await completedSend('First question', 1);
    await completedSend('Second question', 2);
    const originalId = stored().sessions[0].id;
    fireEvent.click(screen.getAllByRole('button', { name: 'workshop.rewind' })[1]);
    fireEvent.click(screen.getAllByRole('button', { name: 'workshop.apply' })[0]);
    expect(apply).toHaveBeenCalledTimes(1);
    const wording = live.content;
    expect(stored().sessions[0].turns[1].decisions).toEqual({ a: 'applied' });
    expect(stored().sessions[1].turns[1].decisions).toEqual({ a: 'applied' });

    fireEvent.change(screen.getByRole('combobox', { name: 'workshop.history' }), {
      target: { value: originalId },
    });
    expect(screen.getByText('workshop.applied')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'workshop.rewind' })[0]);
    expect(live.content).toBe(wording);
    expect(apply).toHaveBeenCalledTimes(1);
    await completedSend('Revisit the initial discussion', 3);
    expect((discuss.mock.calls[2][0] as WorkshopRequest).editor_context?.content).toBe(
      wording
    );
    expect(live.content).toBe(wording);
    expect(apply).toHaveBeenCalledTimes(1);
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
