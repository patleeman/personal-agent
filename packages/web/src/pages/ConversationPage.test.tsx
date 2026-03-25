import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionTargetSummary } from '../types.js';
import {
  ConversationPage,
  DraftExecutionTargetSelector,
  resolveConversationLiveSession,
  shouldEnableConversationLiveStream,
  shouldShowConversationTakeoverBanner,
  shouldShowMissingConversationState,
} from './ConversationPage.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('conversation live state helpers', () => {
  it('keeps the live stream enabled until the conversation is confirmed not live', () => {
    expect(shouldEnableConversationLiveStream('conv-123', null)).toBe(true);
    expect(shouldEnableConversationLiveStream('conv-123', true)).toBe(true);
    expect(shouldEnableConversationLiveStream('conv-123', false)).toBe(false);
    expect(shouldEnableConversationLiveStream(null, null)).toBe(false);
  });

  it('treats a conversation as live when either the stream or probe confirms it', () => {
    expect(resolveConversationLiveSession({ streamBlockCount: 0, isStreaming: false, confirmedLive: null })).toBe(false);
    expect(resolveConversationLiveSession({ streamBlockCount: 1, isStreaming: false, confirmedLive: null })).toBe(true);
    expect(resolveConversationLiveSession({ streamBlockCount: 0, isStreaming: true, confirmedLive: null })).toBe(true);
    expect(resolveConversationLiveSession({ streamBlockCount: 0, isStreaming: false, confirmedLive: true })).toBe(true);
  });

  it('shows the takeover call-to-action only while this surface is mirrored read-only', () => {
    expect(shouldShowConversationTakeoverBanner({ draft: false, isLiveSession: true, conversationNeedsTakeover: true })).toBe(true);
    expect(shouldShowConversationTakeoverBanner({ draft: false, isLiveSession: true, conversationNeedsTakeover: false })).toBe(false);
    expect(shouldShowConversationTakeoverBanner({ draft: true, isLiveSession: true, conversationNeedsTakeover: true })).toBe(false);
    expect(shouldShowConversationTakeoverBanner({ draft: false, isLiveSession: false, conversationNeedsTakeover: true })).toBe(false);
  });

  it('does not show the missing state until session discovery has loaded', () => {
    expect(shouldShowMissingConversationState({
      draft: false,
      conversationId: 'conv-123',
      sessionsLoaded: false,
      confirmedLive: false,
      sessionLoading: false,
      hasVisibleSessionDetail: false,
      hasSavedConversationSessionFile: false,
      hasPendingInitialPrompt: false,
      hasExecutionTarget: false,
    })).toBe(false);

    expect(shouldShowMissingConversationState({
      draft: false,
      conversationId: 'conv-123',
      sessionsLoaded: true,
      confirmedLive: false,
      sessionLoading: false,
      hasVisibleSessionDetail: false,
      hasSavedConversationSessionFile: false,
      hasPendingInitialPrompt: false,
      hasExecutionTarget: false,
    })).toBe(true);
  });
});

describe('ConversationPage', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('useLayoutEffect does nothing on the server')) {
        return;
      }

      originalConsoleError(message, ...args);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('hides the draft execution selector when no remote targets are configured', () => {
    const html = renderToString(
      <DraftExecutionTargetSelector
        execution={{
          targetId: null,
          location: 'local',
          target: null,
        }}
        targets={[]}
        busy={false}
        onSelectTarget={() => {}}
      />,
    );

    expect(html).toBe('');
  });

  it('renders the draft execution selector when remote targets are available', () => {
    const target: ExecutionTargetSummary = {
      id: 'gpu-box',
      label: 'GPU Box',
      transport: 'ssh',
      sshDestination: 'patrick@gpu-box',
      cwdMappings: [],
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:00.000Z',
      activeRunCount: 0,
      readyImportCount: 0,
    };

    const html = renderToString(
      <DraftExecutionTargetSelector
        execution={{
          targetId: null,
          location: 'local',
          target: null,
        }}
        targets={[target]}
        busy={false}
        onSelectTarget={() => {}}
      />,
    );

    expect(html).toContain('Execution');
    expect(html).toContain('Local agent');
    expect(html).toContain('GPU Box');
  });

  it('renders without reading tree state before initialization', () => {
    expect(() => renderToString(
      <MemoryRouter initialEntries={['/conversations/test-session']}>
        <Routes>
          <Route path="/conversations/:id" element={<ConversationPage />} />
        </Routes>
      </MemoryRouter>,
    )).not.toThrow();
  });
});
