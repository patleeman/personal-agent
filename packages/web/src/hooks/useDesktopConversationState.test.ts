import { describe, expect, it } from 'vitest';
import type { DesktopConversationState } from '../types';
import { mergeDesktopConversationState } from './useDesktopConversationState';

function createDesktopConversationState(input: {
  conversationId?: string;
  cwdChange?: DesktopConversationState['stream']['cwdChange'];
} = {}): DesktopConversationState {
  return {
    conversationId: input.conversationId ?? 'conv-source',
    sessionDetail: null,
    liveSession: {
      live: true,
      id: input.conversationId ?? 'conv-source',
      cwd: '/tmp/source',
      sessionFile: '/tmp/source.jsonl',
      isStreaming: false,
      hasPendingHiddenTurn: false,
    },
    stream: {
      blocks: [],
      blockOffset: 0,
      totalBlocks: 0,
      hasSnapshot: true,
      isStreaming: false,
      isCompacting: false,
      error: null,
      title: null,
      tokens: null,
      cost: null,
      contextUsage: null,
      pendingQueue: { steering: [], followUp: [] },
      presence: {
        surfaces: [],
        controllerSurfaceId: null,
        controllerSurfaceType: null,
        controllerAcquiredAt: null,
      },
      autoModeState: null,
      cwdChange: input.cwdChange ?? null,
    },
  };
}

describe('mergeDesktopConversationState', () => {
  it('preserves a pending cwd redirect when a follow-up state update clears it for the same conversation', () => {
    const pendingRedirect = createDesktopConversationState({
      cwdChange: {
        newConversationId: 'conv-next',
        cwd: '/tmp/next',
        autoContinued: true,
      },
    });
    const refreshedSourceState = createDesktopConversationState();

    expect(mergeDesktopConversationState(pendingRedirect, refreshedSourceState).stream.cwdChange).toEqual({
      newConversationId: 'conv-next',
      cwd: '/tmp/next',
      autoContinued: true,
    });
  });

  it('does not leak cwd redirects across different conversations', () => {
    const pendingRedirect = createDesktopConversationState({
      cwdChange: {
        newConversationId: 'conv-next',
        cwd: '/tmp/next',
        autoContinued: true,
      },
    });
    const otherConversation = createDesktopConversationState({ conversationId: 'conv-other' });

    expect(mergeDesktopConversationState(pendingRedirect, otherConversation).stream.cwdChange).toBeNull();
  });

  it('prefers the newest cwd redirect when the next state already has one', () => {
    const previousState = createDesktopConversationState({
      cwdChange: {
        newConversationId: 'conv-next',
        cwd: '/tmp/next',
        autoContinued: true,
      },
    });
    const nextState = createDesktopConversationState({
      cwdChange: {
        newConversationId: 'conv-newer',
        cwd: '/tmp/newer',
        autoContinued: false,
      },
    });

    expect(mergeDesktopConversationState(previousState, nextState).stream.cwdChange).toEqual({
      newConversationId: 'conv-newer',
      cwd: '/tmp/newer',
      autoContinued: false,
    });
  });
});
