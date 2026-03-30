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
  syncCompanionConversationWorkspaceLayout,
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

interface MockStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function createStorage(): MockStorage {
  const map = new Map<string, string>();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) ?? null : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

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

describe('syncCompanionConversationWorkspaceLayout', () => {
  const dispatchEvent = vi.fn();
  const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));

  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('fetch', fetchMock);

    if (typeof CustomEvent === 'undefined') {
      vi.stubGlobal('CustomEvent', class CustomEvent<T = unknown> {
        type: string;
        detail: T | null;

        constructor(type: string, init?: CustomEventInit<T>) {
          this.type = type;
          this.detail = init?.detail ?? null;
        }
      });
    }
  });

  afterEach(() => {
    dispatchEvent.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => Promise.resolve({ ok: true }));
    vi.unstubAllGlobals();
  });

  it('opens the companion conversation in the shared workspace layout snapshot', async () => {
    // First call (GET): server returns empty layout; second call (PATCH): { ok: true } from default mock.
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sessionIds: [], pinnedSessionIds: [], archivedSessionIds: [] }),
      });

    await expect(syncCompanionConversationWorkspaceLayout(' conv-123 ')).resolves.toEqual({
      sessionIds: ['conv-123'],
      pinnedSessionIds: [],
      archivedSessionIds: [],
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/web-ui/open-conversations', expect.objectContaining({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionIds: ['conv-123'],
        pinnedSessionIds: [],
        archivedSessionIds: [],
      }),
    }));
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

  it('renders mirrored companion mode with takeover and a compact header action menu', () => {
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
    expect(html).toContain('Back to conversations');
    expect(html).toContain('Open conversation actions');
    expect(html).not.toContain('Open todo panel');
    expect(html).not.toContain('Open artifact panel');
    expect(html).not.toContain('Agent reminders');
    expect(html).not.toContain('artifacts:');
    expect(html).not.toContain('todos:');
    expect(html).toContain('artifact-action:');
    expect(html).toContain('enabled');
    expect(html).toContain('active-artifact:');
    expect(html).toContain('artifact-7');
    expect(html).toContain('messages:');
  });

  it('opens the conversation action shelf when requested in the URL', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/app/conversations/conv-123?panel=actions']}>
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

    expect(html).toContain('Actions');
    expect(html).not.toContain('Resume conversation');
    expect(html).toContain('Open conversation');
    expect(html).toContain('Agent reminders');
    expect(html).toContain('Artifacts');
    expect(html).toContain('Scheduled tasks');
    expect(html).not.toContain('todos:');
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

  it('shows deferred resume and scheduled task indicators and lets the user load older transcript blocks', () => {
    vi.mocked(useSessionStream).mockReturnValue({
      blocks: [],
      blockOffset: 0,
      totalBlocks: 0,
      hasSnapshot: false,
      isStreaming: false,
      error: null,
      title: null,
      tokens: null,
      cost: null,
      contextUsage: null,
      pendingQueue: { steering: [], followUp: [] },
      presence: createPresence({
        surfaces: [],
        controllerSurfaceId: null,
        controllerSurfaceType: null,
        controllerAcquiredAt: null,
      }),
      surfaceId: 'surface-1',
      takeover: vi.fn(),
      send: vi.fn(),
      abort: vi.fn(),
      reconnect: vi.fn(),
    });
    vi.mocked(useSessionDetail).mockReturnValue({
      detail: createSessionDetail({
        meta: createSession({ id: 'conv-123', title: 'Saved transcript' }),
        blocks: [{ id: 'block-1', type: 'text', ts: '2026-03-25T00:00:00.000Z', text: 'saved output' }],
        blockOffset: 250,
        totalBlocks: 650,
      }),
      loading: false,
      error: null,
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/app/conversations/conv-123']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <LiveTitlesContext.Provider value={{ titles: new Map(), setTitle: vi.fn() }}>
            <AppDataContext.Provider value={{
              activity: null,
              projects: null,
              sessions: [createSession({
                id: 'conv-123',
                title: 'Saved transcript',
                deferredResumes: [{
                  id: 'resume-1',
                  sessionFile: '/tmp/conv-123.jsonl',
                  prompt: 'Continue the work later.',
                  dueAt: '2026-03-25T01:00:00.000Z',
                  createdAt: '2026-03-25T00:30:00.000Z',
                  attempts: 0,
                  status: 'ready',
                }],
              })],
              tasks: [{
                id: 'morning-brief',
                filePath: '/tmp/morning-brief.task.md',
                scheduleType: 'cron',
                running: true,
                enabled: true,
                cron: '0 8 * * *',
                prompt: 'Summarize the day ahead.',
              }],
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

    expect(html).toContain('Wakeups');
    expect(html).toContain('1 ready now');
    expect(html).toContain('Resume conversation');
    expect(html).toContain('Tasks');
    expect(html).toContain('1 running');
    expect(html).toContain('Showing the latest');
    expect(html).toContain('Load 250 older');
  });
});
