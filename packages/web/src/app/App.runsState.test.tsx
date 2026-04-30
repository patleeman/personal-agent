// @vitest-environment jsdom
import React, { useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopAppEvent, DurableRunListResult, DurableRunRecord, SessionMeta } from '../shared/types';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const subscribeDesktopAppEventsMock = vi.fn();
const apiRunsMock = vi.fn();
const apiTasksMock = vi.fn();
const apiDaemonMock = vi.fn();
const apiSessionMetaMock = vi.fn();
const fetchSessionsSnapshotMock = vi.fn();
let desktopListener: { onopen?: () => void; onevent?: (event: DesktopAppEvent) => void } | null = null;

vi.mock('../desktop/desktopAppEvents', () => ({
  subscribeDesktopAppEvents: subscribeDesktopAppEventsMock,
}));

vi.mock('../client/api', () => ({
  api: {
    runs: apiRunsMock,
    tasks: apiTasksMock,
    daemon: apiDaemonMock,
    sessionMeta: apiSessionMetaMock,
  },
}));

vi.mock('../session/sessionSnapshot', () => ({
  fetchSessionsSnapshot: fetchSessionsSnapshotMock,
}));

vi.mock('../components/Layout', async () => {
  const { Outlet } = await import('react-router-dom');
  return { Layout: () => <Outlet /> };
});

vi.mock('../navigation/lazyRouteRecovery', async () => {
  const { useAppData } = await import('./contexts');
  const { resolveConversationBackgroundRunState } = await import('../conversation/conversationPageState');

  function ConversationPageProbe() {
    const { id } = useParams();
    const { runs, sessions } = useAppData();
    const state = useMemo(() => resolveConversationBackgroundRunState({ conversationId: id, runs }), [id, runs]);
    const session = sessions?.find((candidate) => candidate.id === id);

    return (
      <main>
        <h1>Conversation {id}</h1>
        <span>{session?.isRunning ? 'conversation running' : 'conversation idle'}</span>
        {state.activeRuns.length > 0 ? (
          <section data-testid="background-work">
            <span>Background Work</span>
            <span>{state.indicatorText}</span>
            {state.activeRuns.map((run) => <span key={run.runId}>{run.runId}</span>)}
          </section>
        ) : (
          <section data-testid="no-background-work">No Background Work</section>
        )}
      </main>
    );
  }

  return {
    lazyRouteWithRecovery: (id: string) => {
      if (id === 'conversation-page') {
        return ConversationPageProbe;
      }
      return function RouteProbe() {
        return <div>{id}</div>;
      };
    },
  };
});

function createRun(
  runId: string,
  status: string | undefined,
  conversationId = 'conv-1',
  options: { updatedAt?: string; command?: string; includeStatus?: boolean } = {},
): DurableRunRecord {
  const includeStatus = options.includeStatus ?? true;
  return {
    runId,
    conversationId,
    paths: {
      root: `/tmp/runs/${runId}`,
      manifestPath: `/tmp/runs/${runId}/manifest.json`,
      statusPath: `/tmp/runs/${runId}/status.json`,
      checkpointPath: `/tmp/runs/${runId}/checkpoint.json`,
      eventsPath: `/tmp/runs/${runId}/events.jsonl`,
      outputLogPath: `/tmp/runs/${runId}/output.log`,
      resultPath: `/tmp/runs/${runId}/result.json`,
    },
    manifest: {
      version: 1,
      id: runId,
      kind: 'raw-shell',
      resumePolicy: 'manual',
      createdAt: '2026-04-29T01:22:23.123Z',
      source: { type: 'tool', id: conversationId },
      spec: {
        target: { type: 'shell', command: options.command ?? 'npm test', cwd: '/repo' },
        metadata: { taskSlug: 'test-run', cwd: '/repo' },
      },
    },
    ...(includeStatus ? { status: {
      version: 1,
      runId,
      status,
      createdAt: '2026-04-29T01:22:23.123Z',
      updatedAt: options.updatedAt ?? '2026-04-29T01:22:24.000Z',
      activeAttempt: 1,
      ...(status === 'completed' || status === 'failed' || status === 'cancelled'
        ? { completedAt: '2026-04-29T01:22:25.000Z' }
        : {}),
    } } : {}),
    problems: [],
    recoveryAction: 'none',
  } as DurableRunRecord;
}

function createSessionMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'conv-1',
    file: '/tmp/conv-1.jsonl',
    timestamp: '2026-04-29T01:22:23.123Z',
    cwd: '/repo',
    cwdSlug: 'repo',
    model: 'openai/gpt-test',
    title: 'Thread',
    messageCount: 1,
    ...overrides,
  };
}

function createRuns(runs: DurableRunRecord[]): DurableRunListResult {
  return {
    scannedAt: '2026-04-29T01:22:24.000Z',
    runsRoot: '/tmp/runs',
    summary: { total: runs.length, recoveryActions: {}, statuses: {} },
    runs,
  };
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderAppAtConversation() {
  window.history.pushState({}, '', '/conversations/conv-1');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const { App } = await import('./App');

  await act(async () => {
    root.render(<App />);
  });

  await flushReact();

  return { container, root };
}

async function emitDesktopEvent(event: DesktopAppEvent) {
  await act(async () => {
    desktopListener?.onevent?.(event);
    await Promise.resolve();
  });
  await flushReact();
}

describe('App background work run state integration', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    desktopListener = null;
    subscribeDesktopAppEventsMock.mockImplementation(async (listener) => {
      desktopListener = listener;
      listener.onopen?.();
      return () => {};
    });
    apiRunsMock.mockResolvedValue(createRuns([]));
    apiTasksMock.mockResolvedValue([]);
    apiDaemonMock.mockResolvedValue(null);
    apiSessionMetaMock.mockResolvedValue(null);
    fetchSessionsSnapshotMock.mockResolvedValue([]);
  });

  afterEach(() => {
    if (root) {
      act(() => { root?.unmount(); });
      root = null;
    }
    container?.remove();
    container = null;
    window.history.pushState({}, '', '/');
  });

  it('shows the shelf for a running run snapshot and removes it when the next snapshot is cancelled', async () => {
    ({ container, root } = await renderAppAtConversation());

    await emitDesktopEvent({ type: 'runs', result: createRuns([createRun('run-test-1', 'running')]) });
    expect(container.textContent).toContain('Background Work');
    expect(container.textContent).toContain('running · npm test');
    expect(container.textContent).toContain('run-test-1');

    await emitDesktopEvent({ type: 'runs', result: createRuns([createRun('run-test-1', 'cancelled')]) });
    expect(container.textContent).not.toContain('running · npm test');
    expect(container.textContent).not.toContain('run-test-1');
    expect(container.textContent).toContain('No Background Work');
  });

  it('updates conversation running state immediately from session meta change events', async () => {
    const idleSession = createSessionMeta({ isRunning: false });
    const runningSession = createSessionMeta({ isRunning: true });
    fetchSessionsSnapshotMock.mockResolvedValueOnce([idleSession]);
    apiSessionMetaMock.mockResolvedValueOnce(runningSession);
    ({ container, root } = await renderAppAtConversation());

    await emitDesktopEvent({ type: 'sessions', sessions: [idleSession] });
    expect(container.textContent).toContain('conversation idle');

    await emitDesktopEvent({ type: 'session_meta_changed', sessionId: 'conv-1' });

    expect(apiSessionMetaMock).toHaveBeenCalledWith('conv-1');
    expect(container.textContent).toContain('conversation running');
  });

  it('keeps completed, failed, interrupted, and unrelated runs out of the active shelf', async () => {
    ({ container, root } = await renderAppAtConversation());

    await emitDesktopEvent({
      type: 'runs',
      result: createRuns([
        createRun('run-completed', 'completed'),
        createRun('run-failed', 'failed'),
        createRun('run-cancelled', 'cancelled'),
        createRun('run-interrupted', 'interrupted'),
        createRun('run-other-conversation', 'running', 'conv-2'),
      ]),
    });

    expect(container.textContent).toContain('No Background Work');
    expect(container.textContent).not.toContain('run-completed');
    expect(container.textContent).not.toContain('run-failed');
    expect(container.textContent).not.toContain('run-cancelled');
    expect(container.textContent).not.toContain('run-interrupted');
    expect(container.textContent).not.toContain('run-other-conversation');
  });

  it('updates the active shelf across running, failed, and rerun snapshots', async () => {
    ({ container, root } = await renderAppAtConversation());

    await emitDesktopEvent({ type: 'runs', result: createRuns([createRun('run-first', 'running')]) });
    expect(container.textContent).toContain('run-first');

    await emitDesktopEvent({ type: 'runs', result: createRuns([createRun('run-first', 'failed')]) });
    expect(container.textContent).toContain('No Background Work');
    expect(container.textContent).not.toContain('run-first');

    await emitDesktopEvent({
      type: 'runs',
      result: createRuns([
        createRun('run-first', 'failed'),
        createRun('run-rerun', 'running'),
      ]),
    });
    expect(container.textContent).toContain('Background Work');
    expect(container.textContent).toContain('run-rerun');
    expect(container.textContent).not.toContain('run-first');
  });

  it('loads the initial shelf from the bootstrap runs snapshot', async () => {
    vi.useFakeTimers();
    subscribeDesktopAppEventsMock.mockImplementation(async (listener) => {
      desktopListener = listener;
      return () => {};
    });
    apiRunsMock.mockResolvedValue(createRuns([createRun('run-bootstrap', 'running')]));

    ({ container, root } = await renderAppAtConversation());

    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiRunsMock).toHaveBeenCalled();
    expect(container.textContent).toContain('Background Work');
    expect(container.textContent).toContain('run-bootstrap');
  });

  it('refreshes the shelf from api.runs when an invalidate event arrives without a runs snapshot', async () => {
    ({ container, root } = await renderAppAtConversation());

    await emitDesktopEvent({ type: 'runs', result: createRuns([createRun('run-invalidated', 'running')]) });
    expect(container.textContent).toContain('run-invalidated');

    apiRunsMock.mockResolvedValueOnce(createRuns([createRun('run-invalidated', 'cancelled')]));
    await emitDesktopEvent({ type: 'invalidate', topics: ['runs'] });

    expect(apiRunsMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('No Background Work');
    expect(container.textContent).not.toContain('run-invalidated');
  });

  it('treats queued, waiting, and recovering as active until they become terminal', async () => {
    ({ container, root } = await renderAppAtConversation());

    await emitDesktopEvent({
      type: 'runs',
      result: createRuns([
        createRun('run-queued', 'queued'),
        createRun('run-waiting', 'waiting'),
        createRun('run-recovering', 'recovering'),
      ]),
    });

    expect(container.textContent).toContain('Background Work');
    expect(container.textContent).toContain('3 active · latest npm test');
    expect(container.textContent).toContain('run-queued');
    expect(container.textContent).toContain('run-waiting');
    expect(container.textContent).toContain('run-recovering');

    await emitDesktopEvent({
      type: 'runs',
      result: createRuns([
        createRun('run-queued', 'cancelled'),
        createRun('run-waiting', 'completed'),
        createRun('run-recovering', 'failed'),
      ]),
    });

    expect(container.textContent).toContain('No Background Work');
    expect(container.textContent).not.toContain('run-queued');
    expect(container.textContent).not.toContain('run-waiting');
    expect(container.textContent).not.toContain('run-recovering');
  });

  it('sorts multiple active runs by latest update and keeps malformed statuses out of the active shelf', async () => {
    ({ container, root } = await renderAppAtConversation());

    await emitDesktopEvent({
      type: 'runs',
      result: createRuns([
        createRun('run-old', 'running', 'conv-1', { updatedAt: '2026-04-29T01:22:24.000Z', command: 'npm test old' }),
        createRun('run-new', 'running', 'conv-1', { updatedAt: '2026-04-29T01:23:24.000Z', command: 'npm test new' }),
        createRun('run-missing-status', undefined, 'conv-1', { includeStatus: false }),
      ]),
    });

    expect(container.textContent).toContain('2 active · latest npm test new');
    expect(container.textContent).toContain('run-old');
    expect(container.textContent).toContain('run-new');
    expect(container.textContent).not.toContain('run-missing-status');
  });
});
