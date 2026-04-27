import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '../shared/types';
import {
  replaceConversationMetaInSessionList,
  resolveConversationPerformanceMode,
  resolveConversationStreamTitleSync,
  resolveDisplayedConversationPendingStatusLabel,
  shouldDeferConversationFileRefresh,
  shouldFetchConversationAttachments,
  shouldFetchConversationLiveSessionGitContext,
  shouldLoadConversationModels,
  shouldRenderConversationRail,
  shouldShowMissingConversationState,
  shouldUseHealthyDesktopConversationState,
} from './conversationPageState';

describe('conversation page state helpers', () => {
  it('resolves pending status labels without leaking streaming placeholders', () => {
    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: null,
      draft: true,
      hasDraftPendingPrompt: true,
      pendingPrompt: null,
      isStreaming: false,
      hasPendingInitialPrompt: false,
      hasPendingInitialPromptInFlight: false,
      isLiveSession: false,
      hasVisibleSessionDetail: false,
    })).toBe('Sending…');

    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: null,
      draft: false,
      hasDraftPendingPrompt: false,
      pendingPrompt: { text: 'hi', relatedConversationIds: ['a', 'b'] },
      isStreaming: false,
      hasPendingInitialPrompt: true,
      hasPendingInitialPromptInFlight: false,
      isLiveSession: true,
      hasVisibleSessionDetail: false,
    })).toBe('Summarizing 2 related threads…');

    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: null,
      draft: false,
      hasDraftPendingPrompt: false,
      pendingPrompt: null,
      isStreaming: true,
      hasPendingInitialPrompt: true,
      hasPendingInitialPromptInFlight: false,
      isLiveSession: true,
      hasVisibleSessionDetail: false,
    })).toBeNull();
  });

  it('gates expensive conversation reads during pending initial prompt work', () => {
    expect(shouldDeferConversationFileRefresh({
      draft: false,
      conversationId: 'conv-1',
      hasPendingInitialPrompt: false,
      pendingInitialPromptDispatching: true,
      hasPendingInitialPromptInFlight: false,
    })).toBe(true);

    expect(shouldFetchConversationLiveSessionGitContext({
      draft: false,
      conversationId: 'conv-1',
      conversationLiveDecision: true,
      conversationBootstrapLoading: false,
      sessionLoading: false,
      isStreaming: false,
      hasPendingInitialPrompt: false,
      pendingInitialPromptDispatching: false,
      hasPendingInitialPromptInFlight: false,
    })).toBe(true);

    expect(shouldLoadConversationModels({
      draft: false,
      hasPendingInitialPrompt: true,
      hasPendingInitialPromptInFlight: false,
    })).toBe(false);
  });

  it('merges active conversation metadata into the session list without rewriting stable rows', () => {
    const sessions: SessionMeta[] = [{
      id: 'conv-1',
      file: '/tmp/conv-1.jsonl',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: '/repo',
      cwdSlug: '-repo',
      model: 'model-a',
      title: 'Old title',
      messageCount: 4,
      isRunning: false,
      needsAttention: true,
    }];

    const next = replaceConversationMetaInSessionList(sessions, 'conv-1', {
      ...sessions[0]!,
      title: 'Fresh title',
      messageCount: 5,
      isRunning: true,
    });

    expect(next).not.toBe(sessions);
    expect(next?.[0]).toMatchObject({
      title: 'Fresh title',
      messageCount: 5,
      isRunning: true,
      needsAttention: true,
    });
    expect(replaceConversationMetaInSessionList(next, 'conv-1', next?.[0])).toBe(next);
  });

  it('keeps title synchronization immutable and normalized', () => {
    const sessions = [{ id: 'conv-1', title: 'Old title' }];

    const result = resolveConversationStreamTitleSync({
      draft: false,
      conversationId: 'conv-1',
      streamTitle: '  New title  ',
      liveTitle: 'Old title',
      sessions,
    });

    expect(result.normalizedTitle).toBe('New title');
    expect(result.shouldPushLiveTitle).toBe(true);
    expect(result.nextSessions).toEqual([{ id: 'conv-1', title: 'New title' }]);
    expect(result.nextSessions).not.toBe(sessions);
  });

  it('keeps desktop, attachment, missing-state, and rail decisions explicit', () => {
    expect(shouldUseHealthyDesktopConversationState({
      draft: false,
      conversationId: 'conv-1',
      desktopMode: 'local',
      desktopError: null,
    })).toBe(true);

    expect(shouldFetchConversationAttachments({
      draft: false,
      conversationId: 'conv-1',
      drawingsPickerOpen: true,
    })).toBe(true);

    expect(shouldShowMissingConversationState({
      draft: false,
      conversationId: 'conv-1',
      sessionsLoaded: true,
      confirmedLive: false,
      sessionLoading: false,
      hasVisibleSessionDetail: false,
      hasSavedConversationSessionFile: false,
      hasPendingInitialPrompt: false,
    })).toBe(true);

    expect(resolveConversationPerformanceMode({ messageCount: 96 })).toBe('aggressive');
    expect(shouldRenderConversationRail({
      hasRenderableMessages: true,
      realMessages: [{ type: 'text', ts: '2026-01-01T00:00:00.000Z', text: 'hello' }],
      performanceMode: 'default',
    })).toBe(true);
  });
});
