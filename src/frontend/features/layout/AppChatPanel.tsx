// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Right-side chat panel wrapper that conditionally renders the Chat component in a slide-in aside.
 * Extracted from AppMainLayout to isolate the chat panel layout concern.
 */

import React, { lazy, Suspense, useMemo, useState, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';

import { Chat } from '../chat/Chat';
import { ChatProvider } from '../chat/ChatContext';
import { MainChatControls } from './layoutControlTypes';
import { useChatStore, ChatStoreState } from '../../stores/chatStore';
import type { AppTheme, ChatSession } from '../../types';
import type { EditorHandle } from '../editor/Editor';
import { useStoryStore, type StoryStoreState } from '../../stores/storyStore';
import { WorkshopPanel } from '../workshop/WorkshopPanel';
const LorePanel = lazy(() =>
  import('../lore/LorePanel').then((module: typeof import('../lore/LorePanel')) => ({
    default: module.LorePanel,
  }))
);

export interface AppChatPanelProps {
  chatControls: MainChatControls;
  currentTheme: AppTheme;
  storyLanguage: string;
  editorRef: RefObject<EditorHandle | null>;
}

export const AppChatPanel: React.FC<AppChatPanelProps> = React.memo(
  ({ chatControls, currentTheme, storyLanguage, editorRef }: AppChatPanelProps) => {
    const { t } = useTranslation();
    const [panel, setPanel] = useState<'workshop' | 'lore' | 'chat'>('workshop');
    const projectId = useStoryStore((state: StoryStoreState): string => state.story.id);
    const linkedMarkdown = useStoryStore(
      (state: StoryStoreState): boolean =>
        state.story.storage_mode === 'linked-markdown'
    );
    const {
      isChatOpen,
      isChatAvailable,
      activeChatConfig,
      handleSendMessage,
      handleStopChat,
      handleRegenerate,
      handleEditMessage,
      handleDeleteMessage,
      handleLoadProject,
      handleSelectChat,
      handleNewChat,
      handleDeleteChat,
      handleDeleteAllChats,
      onUpdateScratchpad,
      onDeleteScratchpad,
      onMutationClick,
    } = chatControls;

    // Read all frequently-changing chat state directly from the store so that
    // AppMainLayout (and its Editor + Sidebar siblings) are never re-rendered
    // by chat message updates.
    const {
      chatMessages,
      isChatLoading,
      sessionMutations,
      systemPrompt,
      setSystemPrompt,
      isIncognito,
      setIsIncognito,
      allowWebSearch,
      setAllowWebSearch,
      scratchpad,
      incognitoSessions,
      chatHistoryList,
      currentChatId,
    } = useChatStore(
      useShallow((s: ChatStoreState) => ({
        chatMessages: s.chatMessages,
        isChatLoading: s.isChatLoading,
        sessionMutations: s.sessionMutations,
        systemPrompt: s.systemPrompt,
        setSystemPrompt: s.setSystemPrompt,
        isIncognito: s.isIncognito,
        setIsIncognito: s.setIsIncognito,
        allowWebSearch: s.allowWebSearch,
        setAllowWebSearch: s.setAllowWebSearch,
        scratchpad: s.scratchpad,
        incognitoSessions: s.incognitoSessions,
        chatHistoryList: s.chatHistoryList,
        currentChatId: s.currentChatId,
      }))
    );

    // Memoize merged session list so Chat's React.memo isn't defeated by a
    // new array reference on every parent render.
    const chatSessions = useMemo(
      (): ChatSession[] => [...incognitoSessions, ...(chatHistoryList ?? [])],
      [incognitoSessions, chatHistoryList]
    );

    const isLight = currentTheme === 'light';

    return (
      <aside
        id="aq-chat"
        aria-label={t('AI Chat Assistant')}
        className={`fixed inset-y-0 right-0 top-14 w-[var(--sidebar-width)] flex-col border-l flex-shrink-0 z-40 transition-transform duration-300 ease-in-out flex h-full ${
          isChatOpen ? 'translate-x-0' : 'translate-x-full'
        } lg:relative lg:top-auto lg:w-[clamp(22rem,28vw,30rem)] ${!isChatOpen ? 'lg:hidden' : ''} ${
          isLight
            ? 'bg-brand-gray-50 border-brand-gray-200'
            : 'bg-brand-gray-900 border-brand-gray-800'
        }`}
      >
        {isChatOpen && (
          <button
            className="fixed inset-0 bg-brand-gray-950/60 z-30 cursor-default lg:hidden"
            onClick={(): void => chatControls.setIsChatOpen(false)}
            aria-label={t('Close chat')}
          ></button>
        )}
        <div className="relative z-40 flex flex-col h-full overflow-hidden flex-1 bg-inherit">
          <div className="flex shrink-0 border-b border-brand-gray-500/20 px-3 pt-2">
            <button
              type="button"
              aria-pressed={panel === 'workshop'}
              onClick={() => setPanel('workshop')}
              className={`flex-1 rounded-t-lg px-3 py-2 text-xs font-semibold ${panel === 'workshop' ? 'border-b-2 border-indigo-500 text-indigo-400' : 'text-brand-gray-500'}`}
            >
              {t('workshop.tab')}
            </button>
            <button
              type="button"
              aria-pressed={panel === 'lore'}
              onClick={() => setPanel('lore')}
              className={`flex-1 rounded-t-lg px-3 py-2 text-xs font-semibold ${panel === 'lore' ? 'border-b-2 border-indigo-500 text-indigo-400' : 'text-brand-gray-500'}`}
            >
              {t('workshop.loreTab')}
            </button>
            <button
              type="button"
              aria-pressed={panel === 'chat'}
              onClick={() => setPanel('chat')}
              className={`flex-1 rounded-t-lg px-3 py-2 text-xs font-semibold ${panel === 'chat' ? 'border-b-2 border-indigo-500 text-indigo-400' : 'text-brand-gray-500'}`}
            >
              {t('workshop.chatTab')}
            </button>
          </div>
          <div
            className={panel === 'workshop' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
          >
            <WorkshopPanel
              key={projectId}
              projectId={projectId}
              editorRef={editorRef}
              model={activeChatConfig}
              language={storyLanguage}
            />
          </div>
          {panel === 'lore' && (
            <Suspense
              fallback={
                <p role="status" className="p-4">
                  {t('Loading…')}
                </p>
              }
            >
              <LorePanel key={projectId} projectId={projectId} />
            </Suspense>
          )}
          <div className={panel === 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <p className="border-b border-brand-gray-500/20 px-4 py-2 text-[10px] text-brand-gray-500">
              {t(
                linkedMarkdown ? 'workshop.linked.workshopOnly' : 'workshop.chatNotice'
              )}
            </p>
            <ChatProvider
              value={{
                isChatOpen,
                messages: chatMessages,
                isLoading: isChatLoading,
                isModelAvailable: isChatAvailable && !linkedMarkdown,
                activeChatConfig,
                systemPrompt,
                onSendMessage: handleSendMessage,
                onStop: handleStopChat,
                onRegenerate: handleRegenerate,
                onEditMessage: handleEditMessage,
                onDeleteMessage: handleDeleteMessage,
                onUpdateSystemPrompt: setSystemPrompt,
                onSwitchProject: handleLoadProject,
                sessions: chatSessions,
                currentSessionId: currentChatId,
                isIncognito,
                onSelectSession: handleSelectChat,
                onNewSession: handleNewChat,
                onDeleteSession: handleDeleteChat,
                onDeleteAllSessions: handleDeleteAllChats,
                onToggleIncognito: setIsIncognito,
                allowWebSearch,
                onToggleWebSearch: setAllowWebSearch,
                scratchpad,
                onUpdateScratchpad,
                onDeleteScratchpad,
                sessionMutations,
                onMutationClick,
                storyLanguage,
                currentTheme,
              }}
            >
              <Chat />
            </ChatProvider>
          </div>
        </div>
      </aside>
    );
  }
);
