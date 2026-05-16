// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopAppEvent } from '../shared/types';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const subscribeDesktopAppEventsMock = vi.fn();
const apiRunsMock = vi.fn();
const apiExecutionsMock = vi.fn();
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
    executions: apiExecutionsMock,
    tasks: apiTasksMock,
    daemon: apiDaemonMock,
    sessionMeta: apiSessionMetaMock,
  },
}));

vi.mock('../session/sessionSnapshot', () => ({
  fetchSessionsSnapshot: fetchSessionsSnapshotMock,
}));

vi.mock('../components/Layout', async () => {
  const { useAppData, useAppEvents } = await import('./contexts');
  return {
    Layout: () => {
      const { sessions, executions } = useAppData();
      const { versions } = useAppEvents();
      const session = sessions?.find((candidate) => candidate.id === 'conv-1');
      return (
        <main>
          <span>{session?.isRunning ? 'conversation running' : 'conversation idle'}</span>
          <span>executions version {versions.executions}</span>
          <span>runs version {versions.runs}</span>
          {(executions?.executions ?? []).map((execution) => (
            <span key={execution.id}>{execution.title}</span>
          ))}
        </main>
      );
    },
  };
});

vi.mock('../navigation/lazyRouteRecovery', () => ({
  lazyRouteWithRecovery: () => () => null,
}));

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderApp() {
  window.history.pushState({}, '', '/conversations/conv-1');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const { App } = await import('./App');

  await act(async () => {
    root.render(<App />);
  });
  await act(async () => {
    vi.advanceTimersByTime(5_000);
    await Promise.resolve();
    await Promise.resolve();
  });

  await flushReact();
  return { container, root };
}

async function emitDesktopEvent(event: DesktopAppEvent) {
  await act(async () => {
    desktopListener?.onevent?.(event);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('App execution state integration', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    desktopListener = null;
    subscribeDesktopAppEventsMock.mockImplementation(async (listener) => {
      desktopListener = listener;
      listener.onopen?.();
      return () => {};
    });
    apiRunsMock.mockResolvedValue({
      scannedAt: 'now',
      runsRoot: '/runs',
      summary: { total: 0, recoveryActions: {}, statuses: {} },
      runs: [],
    });
    apiExecutionsMock.mockResolvedValue({ executions: [] });
    apiTasksMock.mockResolvedValue([]);
    apiDaemonMock.mockResolvedValue(null);
    apiSessionMetaMock.mockResolvedValue(null);
    fetchSessionsSnapshotMock.mockResolvedValue([
      { id: 'conv-1', title: 'Conversation', cwd: '/repo', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    container?.remove();
    container = null;
    vi.useRealTimers();
  });

  it('bootstraps executions and renders product execution state', async () => {
    apiExecutionsMock.mockResolvedValueOnce({
      executions: [
        {
          id: 'run-1',
          kind: 'background-command',
          visibility: 'primary',
          conversationId: 'conv-1',
          title: 'npm test',
          status: 'running',
          capabilities: { canCancel: true, canRerun: false, canFollowUp: false, hasLog: true, hasResult: false },
        },
      ],
    });

    ({ container, root } = await renderApp());

    expect(apiExecutionsMock).toHaveBeenCalled();
    expect(container.textContent).toContain('npm test');
  });

  it('refreshes executions when an executions invalidation arrives', async () => {
    ({ container, root } = await renderApp());
    apiExecutionsMock.mockClear();
    apiExecutionsMock.mockResolvedValueOnce({
      executions: [
        {
          id: 'run-2',
          kind: 'subagent',
          visibility: 'primary',
          conversationId: 'conv-1',
          title: 'review diff',
          status: 'running',
          capabilities: { canCancel: true, canRerun: false, canFollowUp: false, hasLog: true, hasResult: false },
        },
      ],
    });

    await emitDesktopEvent({ type: 'invalidate', topics: ['executions'] });

    expect(apiExecutionsMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('executions version 1');
    expect(container.textContent).toContain('review diff');
  });

  it('refreshes execution projections when a runs snapshot arrives', async () => {
    apiExecutionsMock.mockResolvedValueOnce({
      executions: [
        {
          id: 'run-1',
          kind: 'subagent',
          visibility: 'primary',
          conversationId: 'conv-1',
          title: 'stale active run',
          status: 'running',
          capabilities: { canCancel: true, canRerun: false, canFollowUp: false, hasLog: true, hasResult: false },
        },
      ],
    });
    ({ container, root } = await renderApp());
    expect(container.textContent).toContain('stale active run');

    apiExecutionsMock.mockClear();
    apiExecutionsMock.mockResolvedValueOnce({ executions: [] });

    await emitDesktopEvent({
      type: 'runs',
      result: { scannedAt: 'later', runsRoot: '/runs', summary: { total: 0, recoveryActions: {}, statuses: {} }, runs: [] },
    });

    expect(apiExecutionsMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('executions version 1');
    expect(container.textContent).toContain('runs version 1');
    expect(container.textContent).not.toContain('stale active run');
  });

  it('updates conversation running state immediately from session meta change events', async () => {
    apiSessionMetaMock.mockResolvedValue({ id: 'conv-1', title: 'Conversation', cwd: '/repo', timestamp: '2026-01-01T00:00:00.000Z' });
    ({ container, root } = await renderApp());

    await emitDesktopEvent({
      type: 'sessions',
      sessions: [{ id: 'conv-1', title: 'Conversation', cwd: '/repo', timestamp: '2026-01-01T00:00:00.000Z' }],
    });
    await emitDesktopEvent({ type: 'session_meta_changed', sessionId: 'conv-1', running: true });

    expect(apiSessionMetaMock).toHaveBeenCalledWith('conv-1');
    expect(container.textContent).toContain('conversation running');
  });
});
