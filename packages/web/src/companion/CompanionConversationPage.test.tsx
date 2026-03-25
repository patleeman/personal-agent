import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveTitlesContext, AppDataContext, SseConnectionContext } from '../contexts.js';
import type { LiveSessionPresenceState, SessionDetail, SessionMeta } from '../types.js';
import {
  CompanionConversationPage,
  resolveCompanionControlState,
  resolveCompanionConversationLive,
  shouldShowCompanionConversationStatusBanner,
} from './CompanionConversationPage.js';
import { useSessionStream } from '../hooks/useSessionStream.js';
import { useSessionDetail } from '../hooks/useSessions.js';

vi.mock('../components/chat/ChatView', () => ({
  ChatView: ({
    messages,
    onOpenArtifact,
    activeArtifactId,
  }: {
    messages: unknown[];
    onOpenArtifact?: (artifactId: string) => void;
    activeArtifactId?: string | null;
  }) => (
    <div>
      messages: {messages.length} · artifact-action: {onOpenArtifact ? 'enabled' : 'disabled'} · active-artifact: {activeArtifactId ?? 'none'}
    </div>
  ),
}));

vi.mock('../hooks/useSessionStream', () => ({
  useSessionStream: vi.fn(),
}));

vi.mock('../hooks/useSessions', () => ({
  useSessionDetail: vi.fn(),
}));

vi.mock('./CompanionConversationTodos', () => ({
  CompanionConversationTodos: ({ readOnly }: { readOnly?: boolean }) => <div>todos: {readOnly ? 'read-only' : 'editable'}</div>,
}));

vi.mock('./CompanionConversationArtifacts', () => ({
  CompanionConversationArtifacts: ({ conversationId }: { conversationId: string }) => <div>artifacts: {conversationId}</div>,
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function createSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'conv-123',
    file: '/tmp/conv-123.jsonl',
    timestamp: '2026-03-25T00:00:00.000Z',
    cwd: '/repo',
    cwdSlug: 'repo',
    model: 'openai/gpt-5.4',
    title: 'Companion conversation',
    messageCount: 4,
    isRunning: false,
    ...overrides,
  };
}

function createSessionDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    meta: createSession(),
    blocks: [],
    blockOffset: 0,
    totalBlocks: 0,
    contextUsage: null,
    ...overrides,
  };
}

function createPresence(overrides: Partial<LiveSessionPresenceState> = {}): LiveSessionPresenceState {
  return {
    surfaces: [
      { surfaceId: 'surface-1', surfaceType: 'mobile_web', connectedAt: '2026-03-25T00:00:00.000Z' },
      { surfaceId: 'surface-2', surfaceType: 'desktop_web', connectedAt: '2026-03-25T00:00:00.000Z' },
    ],
    controllerSurfaceId: 'surface-2',
    controllerSurfaceType: 'desktop_web',
    controllerAcquiredAt: '2026-03-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('companion conversation helpers', () => {
  it('treats the conversation as live when either the stream or the probe says so', () => {
    expect(resolveCompanionConversationLive({ streamBlockCount: 0, isStreaming: false, confirmedLive: null })).toBe(false);
    expect(resolveCompanionConversationLive({ streamBlockCount: 1, isStreaming: false, confirmedLive: null })).toBe(true);
    expect(resolveCompanionConversationLive({ streamBlockCount: 0, isStreaming: true, confirmedLive: null })).toBe(true);
    expect(resolveCompanionConversationLive({ streamBlockCount: 0, isStreaming: false, confirmedLive: true })).toBe(true);
  });

  it('marks mirrored surfaces as needing takeover', () => {
    const state = resolveCompanionControlState({
      isLiveSession: true,
      surfaceId: 'surface-1',
      presence: createPresence(),
    });

    expect(state.controllingThisSurface).toBe(false);
    expect(state.needsTakeover).toBe(true);
  });

  it('shows the status banner only for saved transcripts', () => {
    expect(shouldShowCompanionConversationStatusBanner({ isLiveSession: false })).toBe(true);
    expect(shouldShowCompanionConversationStatusBanner({ isLiveSession: true })).toBe(false);
  });
});

describe('CompanionConversationPage', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    vi.mocked(useSessionStream).mockReturnValue({
      blocks: [{ type: 'text', ts: '2026-03-25T00:00:00.000Z', text: 'live output' }],
      blockOffset: 0,
      totalBlocks: 1,
      hasSnapshot: true,
      isStreaming: false,
      error: null,
      title: 'Live mirrored conversation',
      tokens: null,
      cost: null,
      contextUsage: null,
      pendingQueue: { steering: [], followUp: [] },
      presence: createPresence(),
      surfaceId: 'surface-1',
      takeover: vi.fn(),
      send: vi.fn(),
      abort: vi.fn(),
      reconnect: vi.fn(),
    });
    vi.mocked(useSessionDetail).mockReturnValue({
      detail: createSessionDetail(),
      loading: false,
      error: null,
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('useLayoutEffect does nothing on the server')) {
        return;
      }

      originalConsoleError(message, ...args);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('renders mirrored companion mode with takeover in the composer instead of the header', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/app/conversations/conv-123?artifact=artifact-7']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <LiveTitlesContext.Provider value={{ titles: new Map(), setTitle: vi.fn() }}>
            <AppDataContext.Provider value={{
              activity: null,
              projects: null,
              sessions: [createSession({ id: 'conv-123', title: 'Companion conversation', isLive: true })],
              tasks: null,
              runs: null,
              setActivity: vi.fn(),
              setProjects: vi.fn(),
              setSessions: vi.fn(),
              setTasks: vi.fn(),
              setRuns: vi.fn(),
            }}>
              <Routes>
                <Route path="/app/conversations/:id" element={<CompanionConversationPage />} />
              </Routes>
            </AppDataContext.Provider>
          </LiveTitlesContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Take over to reply');
    expect(html).toContain('Open todo panel');
    expect(html).toContain('Open artifact panel');
    expect(html).not.toContain('todos:');
    expect(html).not.toContain('artifacts:');
    expect(html).toContain('artifact-action:');
    expect(html).toContain('enabled');
    expect(html).toContain('active-artifact:');
    expect(html).toContain('artifact-7');
    expect(html).toContain('messages:');
  });

  it('opens the side panel for conversation todos when requested in the URL', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/app/conversations/conv-123?panel=todos']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <LiveTitlesContext.Provider value={{ titles: new Map(), setTitle: vi.fn() }}>
            <AppDataContext.Provider value={{
              activity: null,
              projects: null,
              sessions: [createSession({ id: 'conv-123', title: 'Companion conversation', isLive: true })],
              tasks: null,
              runs: null,
              setActivity: vi.fn(),
              setProjects: vi.fn(),
              setSessions: vi.fn(),
              setTasks: vi.fn(),
              setRuns: vi.fn(),
            }}>
              <Routes>
                <Route path="/app/conversations/:id" element={<CompanionConversationPage />} />
              </Routes>
            </AppDataContext.Provider>
          </LiveTitlesContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('todos:');
    expect(html).toContain('read-only');
    expect(html).not.toContain('artifacts: conv-123');
  });
});
