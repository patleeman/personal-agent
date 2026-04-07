import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMeta } from '../types.js';
import {
  ConversationPage,
  mergeConversationSessionMeta,
  replaceConversationTitleInSessionList,
  isConversationSessionNotLiveError,
  resolveConversationLiveSession,
  resolveConversationPageTitle,
  resolveConversationPendingStatusLabel,
  resolveDisplayedConversationPendingStatusLabel,
  shouldEnableConversationLiveStream,
  shouldShowConversationTakeoverBanner,
  shouldShowMissingConversationState,
  truncateConversationShelfText,
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

  it('recognizes the stale live-session prompt failure from the server', () => {
    expect(isConversationSessionNotLiveError(new Error('Session conv-123 is not live'))).toBe(true);
    expect(isConversationSessionNotLiveError(new Error('Session not live'))).toBe(true);
    expect(isConversationSessionNotLiveError(new Error('Not a live session'))).toBe(true);
    expect(isConversationSessionNotLiveError(new Error('provider unavailable'))).toBe(false);
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
    })).toBe(true);
  });

  it('chooses an immediate pending status label for outbound prompts', () => {
    expect(resolveConversationPendingStatusLabel({
      isLiveSession: true,
      hasVisibleSessionDetail: true,
    })).toBe('Working…');

    expect(resolveConversationPendingStatusLabel({
      isLiveSession: false,
      hasVisibleSessionDetail: true,
    })).toBe('Resuming…');
  });

  it('keeps showing a pending status while a draft or initial prompt is still staging', () => {
    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: null,
      draft: true,
      hasDraftPendingPrompt: true,
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
      isStreaming: false,
      hasPendingInitialPrompt: true,
      hasPendingInitialPromptInFlight: false,
      isLiveSession: true,
      hasVisibleSessionDetail: false,
    })).toBe('Working…');

    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: null,
      draft: false,
      hasDraftPendingPrompt: false,
      isStreaming: false,
      hasPendingInitialPrompt: false,
      hasPendingInitialPromptInFlight: true,
      isLiveSession: true,
      hasVisibleSessionDetail: false,
    })).toBe('Working…');

    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: 'Resuming…',
      draft: false,
      hasDraftPendingPrompt: false,
      isStreaming: false,
      hasPendingInitialPrompt: false,
      hasPendingInitialPromptInFlight: false,
      isLiveSession: false,
      hasVisibleSessionDetail: true,
    })).toBe('Resuming…');

    expect(resolveDisplayedConversationPendingStatusLabel({
      explicitLabel: null,
      draft: false,
      hasDraftPendingPrompt: false,
      isStreaming: true,
      hasPendingInitialPrompt: true,
      hasPendingInitialPromptInFlight: true,
      isLiveSession: true,
      hasVisibleSessionDetail: false,
    })).toBeNull();
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

  it('preserves deferred resumes from the session snapshot when detail meta omits them', () => {
    const snapshot: SessionMeta = {
      id: 'conv-123',
      file: '/tmp/conv-123.jsonl',
      timestamp: '2026-03-29T00:00:00.000Z',
      cwd: '/tmp',
      cwdSlug: 'tmp',
      model: 'gpt-test',
      title: 'Snapshot title',
      messageCount: 12,
      deferredResumes: [{
        id: 'resume-1',
        sessionFile: '/tmp/conv-123.jsonl',
        prompt: 'continue later',
        dueAt: '2026-03-29T00:05:00.000Z',
        createdAt: '2026-03-29T00:00:00.000Z',
        attempts: 0,
        status: 'scheduled',
      }],
    };

    const detailMeta: SessionMeta = {
      ...snapshot,
      title: 'Detail title',
      deferredResumes: undefined,
    };

    const merged = mergeConversationSessionMeta(detailMeta, snapshot);

    expect(merged?.deferredResumes).toEqual(snapshot.deferredResumes);
    expect(merged?.title).toBe('Detail title');
    expect(merged?.file).toBe(snapshot.file);
  });

  it('truncates oversized queued prompt previews by line count', () => {
    expect(truncateConversationShelfText('1\n2\n3\n4', { maxLines: 3, maxChars: 100 })).toBe('1\n2\n3…');
  });

  it('truncates oversized queued prompt previews by character count', () => {
    expect(truncateConversationShelfText('abcdefghijklmnopqrstuvwxyz', { maxLines: 10, maxChars: 8 })).toBe('abcdefgh…');
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

  it('keeps the new conversation page full-width and shows inline cwd controls', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/new']}>
        <ConversationPage draft />
      </MemoryRouter>,
    );

    expect(html).not.toContain('aria-label="Conversation context"');
    expect(html).not.toContain('Show right sidebar');
    expect(html).toContain('Working directory');
    expect(html).toContain('Choose…');
    expect(html).toContain('Use the working-directory controls in the composer below');
    expect(html).toContain('mt-1.5 flex min-h-4 items-center justify-between gap-3 px-3 text-[10px] text-dim');
    expect(html).not.toContain('right rail');
  });
});
