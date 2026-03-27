import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionTargetSummary } from '../types.js';
import {
  ConversationPage,
  DraftExecutionTargetSelector,
  replaceConversationTitleInSessionList,
  resolveConversationLiveSession,
  resolveConversationPageTitle,
  resolveConversationPendingStatusLabel,
  shouldEnableConversationLiveStream,
  shouldRefetchConversationExecutionOnRunsChange,
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

  it('only refetches conversation execution on run churn when a remote target is selected', () => {
    expect(shouldRefetchConversationExecutionOnRunsChange('gpu-box')).toBe(true);
    expect(shouldRefetchConversationExecutionOnRunsChange('  gpu-box  ')).toBe(true);
    expect(shouldRefetchConversationExecutionOnRunsChange('')).toBe(false);
    expect(shouldRefetchConversationExecutionOnRunsChange('   ')).toBe(false);
    expect(shouldRefetchConversationExecutionOnRunsChange(null)).toBe(false);
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

  it('chooses an immediate pending status label for outbound prompts', () => {
    expect(resolveConversationPendingStatusLabel({
      isLiveSession: true,
      hasExecutionTarget: false,
      hasVisibleSessionDetail: true,
    })).toBe('Working…');

    expect(resolveConversationPendingStatusLabel({
      isLiveSession: false,
      hasExecutionTarget: true,
      hasVisibleSessionDetail: true,
    })).toBe('Connecting to remote workspace…');

    expect(resolveConversationPendingStatusLabel({
      isLiveSession: false,
      hasExecutionTarget: false,
      hasVisibleSessionDetail: true,
    })).toBe('Resuming…');
  });

  it('prefers the freshest available conversation title source', () => {
    expect(resolveConversationPageTitle({
      draft: false,
      titleOverride: 'Manual override',
      streamTitle: 'Live stream title',
      liveTitle: 'Sidebar title',
      detailTitle: 'Stored detail title',
      sessionTitle: 'Session snapshot title',
    })).toBe('Manual override');

    expect(resolveConversationPageTitle({
      draft: false,
      streamTitle: null,
      liveTitle: 'Sidebar title',
      detailTitle: 'Stored detail title',
      sessionTitle: 'Session snapshot title',
    })).toBe('Sidebar title');

    expect(resolveConversationPageTitle({
      draft: false,
      streamTitle: null,
      liveTitle: null,
      detailTitle: 'Stored detail title',
      sessionTitle: 'Session snapshot title',
    })).toBe('Stored detail title');
  });

  it('syncs a refreshed conversation title back into the session list', () => {
    const sessions = [
      { id: 'conv-123', title: 'Old title' },
      { id: 'conv-456', title: 'Other title' },
    ];

    expect(replaceConversationTitleInSessionList(sessions, 'conv-123', '  Better title  ')).toEqual([
      { id: 'conv-123', title: 'Better title' },
      { id: 'conv-456', title: 'Other title' },
    ]);
    expect(replaceConversationTitleInSessionList(sessions, 'conv-123', 'Old title')).toBe(sessions);
    expect(replaceConversationTitleInSessionList(sessions, 'conv-123', '')).toBe(sessions);
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

  it('renders safely before the route param is available', () => {
    expect(() => renderToString(
      <MemoryRouter>
        <ConversationPage />
      </MemoryRouter>,
    )).not.toThrow();
  });
});
