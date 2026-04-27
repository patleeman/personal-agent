// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, LiveTitlesContext, SseConnectionContext } from '../app/contexts.js';
import { OPEN_SESSION_IDS_STORAGE_KEY, PINNED_SESSION_IDS_STORAGE_KEY, ARCHIVED_SESSION_IDS_STORAGE_KEY } from '../local/localSettings.js';
import type { ScheduledTaskSummary, SessionMeta } from '../shared/types.js';
import { applyRunningIndicatorGrace, useConversations } from './useConversations.js';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const apiMocks = vi.hoisted(() => ({
  openConversationTabs: vi.fn(),
  setOpenConversationTabs: vi.fn(),
}));

vi.mock('../client/api', () => ({
  api: apiMocks,
}));

const mountedRoots: Root[] = [];
let latestHookResult: ReturnType<typeof useConversations> | null = null;

function createStorage() {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key) ?? null : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
  };
}

function createSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'conv-auto',
    file: '/tmp/conv-auto.jsonl',
    timestamp: '2026-03-16T09:30:00.000Z',
    cwd: '/Users/patrickc.lee/personal/personal-agent',
    cwdSlug: 'personal-agent',
    model: 'openai/gpt-5.4',
    title: 'Automation: Morning Briefing',
    messageCount: 4,
    isRunning: false,
    ...overrides,
  };
}

function createTask(overrides: Partial<ScheduledTaskSummary> = {}): ScheduledTaskSummary {
  return {
    id: 'morning-briefing',
    title: 'Morning Briefing',
    scheduleType: 'cron',
    running: true,
    enabled: true,
    prompt: 'Assemble the morning briefing.',
    threadConversationId: 'conv-auto',
    ...overrides,
  };
}

function HookProbe() {
  latestHookResult = useConversations();
  return null;
}

function renderProbe(input: { sessions: SessionMeta[]; tasks: ScheduledTaskSummary[] | null }) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  renderProbeIntoRoot(root, input);

  mountedRoots.push(root);
}

function renderProbeIntoRoot(root: Root, input: { sessions: SessionMeta[]; tasks: ScheduledTaskSummary[] | null }) {
  act(() => {
    root.render(
      <SseConnectionContext.Provider value={{ status: 'offline' }}>
        <AppDataContext.Provider value={{
          projects: null,
          sessions: input.sessions,
          tasks: input.tasks,
          runs: null,
          setProjects: () => {},
          setSessions: () => {},
          setTasks: () => {},
          setRuns: () => {},
        }}>
          <LiveTitlesContext.Provider value={{ titles: new Map(), setTitle: () => {} }}>
            <HookProbe />
          </LiveTitlesContext.Provider>
        </AppDataContext.Provider>
      </SseConnectionContext.Provider>,
    );
  });
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe('useConversations', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    apiMocks.openConversationTabs.mockReset();
    apiMocks.setOpenConversationTabs.mockReset();
    apiMocks.openConversationTabs.mockResolvedValue({ sessionIds: [], pinnedSessionIds: [], archivedSessionIds: [], workspacePaths: [] });
    apiMocks.setOpenConversationTabs.mockResolvedValue({ ok: true, sessionIds: ['conv-auto'], pinnedSessionIds: [], archivedSessionIds: [], workspacePaths: [] });
    localStorage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify([]));
    localStorage.setItem(PINNED_SESSION_IDS_STORAGE_KEY, JSON.stringify([]));
    localStorage.setItem(ARCHIVED_SESSION_IDS_STORAGE_KEY, JSON.stringify([]));
    latestHookResult = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    while (mountedRoots.length > 0) {
      const root = mountedRoots.pop();
      act(() => {
        root?.unmount();
      });
    }
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens a running automation thread in the workspace tab list when execution starts', async () => {
    renderProbe({
      sessions: [createSession()],
      tasks: [createTask()],
    });

    await flushAsyncWork();

    expect(JSON.parse(localStorage.getItem(OPEN_SESSION_IDS_STORAGE_KEY) ?? '[]')).toEqual(['conv-auto']);
    expect(apiMocks.setOpenConversationTabs).toHaveBeenCalled();
  });

  it('sorts archived conversations by latest activity', async () => {
    renderProbe({
      sessions: [
        createSession({ id: 'older', timestamp: '2026-03-16T09:30:00.000Z', lastActivityAt: '2026-03-16T09:55:00.000Z' }),
        createSession({ id: 'newest', timestamp: '2026-03-15T09:30:00.000Z', lastActivityAt: '2026-03-16T10:05:00.000Z' }),
        createSession({ id: 'middle', timestamp: '2026-03-16T10:00:00.000Z' }),
      ],
      tasks: null,
    });

    await flushAsyncWork();

    expect(latestHookResult?.archivedSessions.map((session) => session.id)).toEqual(['newest', 'middle', 'older']);
  });

  it('keeps the running indicator sticky across brief stale snapshots', () => {
    const runningUntilBySessionId = new Map<string, number>();
    const runningSnapshot = [createSession({ id: 'conv-running', isRunning: true, needsAttention: true })];
    const staleSnapshot = [createSession({ id: 'conv-running', isRunning: false, needsAttention: true })];

    expect(applyRunningIndicatorGrace(runningSnapshot, runningUntilBySessionId, 1_000, 5_000)[0]?.isRunning).toBe(true);

    const sticky = applyRunningIndicatorGrace(staleSnapshot, runningUntilBySessionId, 3_000, 5_000);
    expect(sticky[0]).toMatchObject({ isRunning: true, needsAttention: true });

    const expired = applyRunningIndicatorGrace(staleSnapshot, runningUntilBySessionId, 7_000, 5_000);
    expect(expired[0]).toMatchObject({ isRunning: false, needsAttention: true });
  });

  it('clears the sticky running indicator after the grace window without waiting for another snapshot', () => {
    vi.useFakeTimers();
    localStorage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-running']));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    renderProbeIntoRoot(root, {
      sessions: [createSession({ id: 'conv-running', isRunning: true })],
      tasks: null,
    });
    expect(latestHookResult?.tabs[0]?.isRunning).toBe(true);

    renderProbeIntoRoot(root, {
      sessions: [createSession({ id: 'conv-running', isRunning: false })],
      tasks: null,
    });
    expect(latestHookResult?.tabs[0]?.isRunning).toBe(true);

    act(() => {
      vi.advanceTimersByTime(751);
    });
    expect(latestHookResult?.tabs[0]?.isRunning).toBe(false);
    vi.useRealTimers();
  });
});
