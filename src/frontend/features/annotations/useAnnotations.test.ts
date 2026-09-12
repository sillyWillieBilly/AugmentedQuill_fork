// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnnotations } from './useAnnotations';
import { api } from '../../services/api';
import { StoryStoreState, useStoryStore } from '../../stores/storyStore';

const scopedAnnotations = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
};

vi.mock('../../services/api', () => ({
  api: {
    forProject: vi.fn(() => ({ annotations: scopedAnnotations })),
  },
}));

vi.mock('../../services/errorNotifier', () => ({
  notifyError: vi.fn(),
}));

describe('useAnnotations linked project handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scopedAnnotations.list.mockResolvedValue([]);
    useStoryStore.setState((state: StoryStoreState) => ({
      story: {
        ...state.story,
        id: '',
        storage_mode: undefined,
      },
    }));
  });

  it('loads native annotations through the explicit project client', async () => {
    const annotation = {
      id: 'annotation-1',
      scope_type: 'story' as const,
      comment: 'Keep this image',
    };
    scopedAnnotations.list.mockResolvedValue([annotation]);
    useStoryStore.setState((state: StoryStoreState) => ({
      story: { ...state.story, id: 'native-project', storage_mode: undefined },
    }));

    const { result } = renderHook(() => useAnnotations('native-project'));

    await waitFor(() => {
      expect(result.current.annotations).toEqual([annotation]);
    });
    expect(vi.mocked(api.forProject)).toHaveBeenCalledWith('native-project');
    expect(scopedAnnotations.list).toHaveBeenCalledTimes(1);
  });

  it('does not request or retain annotations for linked Markdown', async () => {
    useStoryStore.setState((state: StoryStoreState) => ({
      story: {
        ...state.story,
        id: 'linked-project',
        storage_mode: 'linked-markdown',
      },
    }));

    const { result } = renderHook(() => useAnnotations('linked-project'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.annotations).toEqual([]);
    expect(scopedAnnotations.list).not.toHaveBeenCalled();
  });

  it('drops a native response that finishes after switching to linked Markdown', async () => {
    let resolveList: ((value: unknown[]) => void) | undefined;
    scopedAnnotations.list.mockImplementationOnce(
      () =>
        new Promise((resolve: (value: unknown[]) => void) => {
          resolveList = resolve;
        })
    );
    useStoryStore.setState((state: StoryStoreState) => ({
      story: { ...state.story, id: 'switching-project', storage_mode: undefined },
    }));

    const { result } = renderHook(() => useAnnotations('switching-project'));
    await waitFor(() => {
      expect(scopedAnnotations.list).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useStoryStore.setState((state: StoryStoreState) => ({
        story: {
          ...state.story,
          id: 'switching-project',
          storage_mode: 'linked-markdown',
        },
      }));
    });
    resolveList?.([{ id: 'late', scope_type: 'story', comment: 'stale' }]);

    await waitFor(() => {
      expect(result.current.annotations).toEqual([]);
    });
  });
});
