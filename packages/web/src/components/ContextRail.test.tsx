import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext } from '../app/contexts.js';
import { useApi } from '../hooks';
import { useConversations } from '../hooks/useConversations.js';
import { useDurableRunStream } from '../hooks/useDurableRunStream.js';
import type { DurableRunDetailResult, SessionMeta } from '../shared/types';
import { ContextRail, formatConversationRailRunSummary, groupConversationRailRunCards } from './ContextRail.js';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

vi.mock('../hooks/useConversations', () => ({
  useConversations: vi.fn(),
}));

vi.mock('../hooks/useDurableRunStream', () => ({
  useDurableRunStream: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function createSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'conv-123',
    file: '/tmp/conv-123.jsonl',
    timestamp: '2026-03-18T00:00:00.000Z',
    cwd: '/repo',
    cwdSlug: 'repo',
    model: 'openai/gpt-5.4',
    title: 'Fix runs navigation',
    messageCount: 6,
    ...overrides,
  };
}

function createDetail(overrides: Partial<DurableRunDetailResult['run']> = {}): DurableRunDetailResult {
  return {
    scannedAt: '2026-03-18T00:02:00.000Z',
    runsRoot: '/tmp/runs',
    run: {
      runId: 'conversation-live-conv-123',
      paths: {
        root: '/tmp/runs/conversation-live-conv-123',
        manifestPath: '/tmp/runs/conversation-live-conv-123/manifest.json',
        statusPath: '/tmp/runs/conversation-live-conv-123/status.json',
        checkpointPath: '/tmp/runs/conversation-live-conv-123/checkpoint.json',
        eventsPath: '/tmp/runs/conversation-live-conv-123/events.jsonl',
        outputLogPath: '/tmp/runs/conversation-live-conv-123/output.log',
        resultPath: '/tmp/runs/conversation-live-conv-123/result.json',
      },
      manifest: {
        version: 1,
        id: 'conversation-live-conv-123',
        kind: 'conversation',
        resumePolicy: 'continue',
        createdAt: '2026-03-18T00:00:00.000Z',
        spec: {
          conversationId: 'conv-123',
        },
        source: {
          type: 'web-live-session',
          id: 'conv-123',
          filePath: '/tmp/conv-123.jsonl',
        },
      },
      status: {
        version: 1,
        runId: 'conversation-live-conv-123',
        status: 'waiting',
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:01:00.000Z',
        activeAttempt: 1,
      },
      checkpoint: {
        version: 1,
        runId: 'conversation-live-conv-123',
        updatedAt: '2026-03-18T00:01:00.000Z',
        step: 'web-live-session.waiting',
        payload: {
          conversationId: 'conv-123',
          title: 'Fix runs navigation',
        },
      },
      problems: [],
      recoveryAction: 'resume',
      ...overrides,
    },
  };
}

describe('ContextRail run grouping helpers', () => {
  it('groups related work into user-facing buckets', () => {
    const groups = groupConversationRailRunCards([
      { mention: { source: 'mentioned' } },
      { mention: { source: 'conversation' } },
      { mention: { source: 'background' } },
      { mention: { source: 'background' } },
    ] as Array<{ mention: { source: 'conversation' | 'background' | 'mentioned' | 'other' } }>);

    expect(groups.map((group) => [group.key, group.title, group.items.length])).toEqual([
      ['conversation', 'This conversation', 1],
      ['background', 'Background work', 2],
      ['mentioned', 'Mentioned in the thread', 1],
    ]);
  });

  it('uses user-facing summary text for related work', () => {
    expect(formatConversationRailRunSummary({
      loading: false,
      totalCount: 0,
      activeCount: 0,
      reviewCount: 0,
      hasOnlyUnresolvedCards: false,
    })).toBe('No runs');

    expect(formatConversationRailRunSummary({
      loading: false,
      totalCount: 5,
      activeCount: 2,
      reviewCount: 1,
      hasOnlyUnresolvedCards: false,
    })).toBe('5 runs · 2 active · 1 need review');
  });
});

describe('ContextRail run detail', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('useLayoutEffect does nothing on the server')) {
        return;
      }

      originalConsoleError(message, ...args);
    });

    vi.mocked(useApi).mockReturnValue({
      data: null,
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(useConversations).mockReturnValue({
      openSession: vi.fn(),
    } as never);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('shows a return-to-conversation action instead of linking to the already-open conversation', () => {
    vi.mocked(useDurableRunStream).mockReturnValue({
      detail: createDetail(),
      log: { path: '/tmp/runs/conversation-live-conv-123/output.log', log: '' },
      loading: false,
      error: null,
      reconnect: vi.fn(),
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/conv-123?run=conversation-live-conv-123']}>
        <AppDataContext.Provider value={{
          projects: null,
          sessions: [createSession()],
          tasks: null,
          runs: null,
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <ContextRail />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('ui-toolbar-button">← <!-- -->Conversation');
    expect(html).toContain('Current view');
    expect(html).not.toContain('href="/conversations/conv-123"');
  });

  it('keeps conversation links for runs that point at a different conversation', () => {
    vi.mocked(useDurableRunStream).mockReturnValue({
      detail: createDetail({
        runId: 'conversation-deferred-resume-resume-1',
        manifest: {
          version: 1,
          id: 'conversation-deferred-resume-resume-1',
          kind: 'conversation',
          resumePolicy: 'continue',
          createdAt: '2026-03-18T00:00:00.000Z',
          spec: {
            conversationId: 'target-1',
            prompt: 'Resume this later.',
          },
          source: {
            type: 'deferred-resume',
            id: 'resume-1',
            filePath: '/tmp/target-1.jsonl',
          },
        },
        status: {
          version: 1,
          runId: 'conversation-deferred-resume-resume-1',
          status: 'waiting',
          createdAt: '2026-03-18T00:00:00.000Z',
          updatedAt: '2026-03-18T00:01:00.000Z',
          activeAttempt: 1,
        },
        checkpoint: {
          version: 1,
          runId: 'conversation-deferred-resume-resume-1',
          updatedAt: '2026-03-18T00:01:00.000Z',
          step: 'deferred-resume.ready',
          payload: {
            conversationId: 'target-1',
            prompt: 'Resume this later.',
          },
        },
      }),
      log: { path: '/tmp/runs/conversation-deferred-resume-resume-1/output.log', log: '' },
      loading: false,
      error: null,
      reconnect: vi.fn(),
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/source-1?run=conversation-deferred-resume-resume-1']}>
        <AppDataContext.Provider value={{
          projects: null,
          sessions: [
            createSession({ id: 'source-1', title: 'Source conversation', file: '/tmp/source-1.jsonl' }),
            createSession({ id: 'target-1', title: 'Target conversation', file: '/tmp/target-1.jsonl' }),
          ],
          tasks: null,
          runs: null,
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <ContextRail />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('href="/conversations/target-1"');
    expect(html).toContain('Target conversation');
  });

  it('shows task, command, and working directory for unified raw shell runs', () => {
    vi.mocked(useDurableRunStream).mockReturnValue({
      detail: createDetail({
        runId: 'run-ui-preview-check-1',
        manifest: {
          version: 1,
          id: 'run-ui-preview-check-1',
          kind: 'raw-shell',
          resumePolicy: 'manual',
          createdAt: '2026-03-18T00:00:00.000Z',
          spec: {
            target: {
              type: 'shell',
              command: 'printf ok',
              cwd: '/Users/patrick/workingdir/personal-agent',
            },
            metadata: {
              taskSlug: 'ui-preview-check',
              cwd: '/Users/patrick/workingdir/personal-agent',
            },
          },
          source: {
            type: 'tool',
            id: 'conv-123',
            filePath: '/tmp/conv-123.jsonl',
          },
        },
        status: {
          version: 1,
          runId: 'run-ui-preview-check-1',
          status: 'completed',
          createdAt: '2026-03-18T00:00:00.000Z',
          updatedAt: '2026-03-18T00:01:00.000Z',
          activeAttempt: 1,
          startedAt: '2026-03-18T00:00:00.000Z',
          completedAt: '2026-03-18T00:01:00.000Z',
        },
        checkpoint: {
          version: 1,
          runId: 'run-ui-preview-check-1',
          updatedAt: '2026-03-18T00:01:00.000Z',
          step: 'completed',
          payload: {
            target: {
              type: 'shell',
              command: 'printf ok',
              cwd: '/Users/patrick/workingdir/personal-agent',
            },
            metadata: {
              taskSlug: 'ui-preview-check',
              cwd: '/Users/patrick/workingdir/personal-agent',
            },
          },
        },
      }),
      log: { path: '/tmp/runs/run-ui-preview-check-1/output.log', log: 'ok' },
      loading: false,
      error: null,
      reconnect: vi.fn(),
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/conv-123?run=run-ui-preview-check-1']}>
        <AppDataContext.Provider value={{
          projects: null,
          sessions: [createSession()],
          tasks: null,
          runs: null,
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <ContextRail />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('ui-preview-check');
    expect(html).toContain('Terminal output');
    expect(html).toContain('printf ok');
    expect(html).toContain('/Users/patrick/workingdir/personal-agent');
    expect(html).toContain('Working dir');
  });

  it('shows the working directory controls on the draft conversation rail', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/new']}>
        <AppDataContext.Provider value={{
          projects: null,
          sessions: [createSession()],
          tasks: null,
          runs: null,
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <ContextRail />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html.indexOf('Working Directory')).toBeGreaterThanOrEqual(0);
    expect(html).not.toContain('Referenced projects');
    expect(html).not.toContain('No referenced projects.');
  });

  it('keeps the automations rail in browse mode while the create modal is open', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/automations?new=1']}>
        <AppDataContext.Provider value={{
          projects: null,
          sessions: [createSession()],
          tasks: null,
          runs: null,
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <ContextRail />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Select an automation or start a new one.');
    expect(html).not.toContain('Create an automation');
  });

  it('limits the saved-conversation rail to runs and details', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/conv-123']}>
        <AppDataContext.Provider value={{
          projects: null,
          sessions: [createSession()],
          tasks: null,
          runs: null,
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <ContextRail />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Runs');
    expect(html).toContain('Details');
    expect(html).not.toContain('Working directory');
    expect(html).not.toContain('Changed files');
    expect(html).not.toContain('Open workspace browser');
  });

  it('keeps the saved-conversation rail focused on conversation details even when an artifact is selected', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/conv-123?artifact=test-artifact']}>
        <AppDataContext.Provider value={{
          projects: null,
          sessions: [createSession()],
          tasks: null,
          runs: null,
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <ContextRail />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Runs');
    expect(html).toContain('Details');
    expect(html).not.toContain('Loading artifact…');
    expect(html).not.toContain('copy source');
  });

  it('renders the conversations workspace in the rail on the conversations index page', () => {
    vi.mocked(useConversations).mockReturnValue({
      pinnedSessions: [createSession({ id: 'pinned-1', title: 'Pinned session' })],
      tabs: [createSession({ id: 'open-1', title: 'Open session' })],
      archivedSessions: [createSession({ id: 'archived-1', title: 'Archived session' })],
      loading: false,
      refetch: vi.fn(),
      openSession: vi.fn(),
      closeSession: vi.fn(),
      pinSession: vi.fn(),
      unpinSession: vi.fn(),
    } as never);

    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations']}>
        <AppDataContext.Provider value={{
          projects: null,
          sessions: [createSession()],
          tasks: null,
          runs: null,
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <ContextRail />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Overview');
    expect(html).toContain('Pinned');
    expect(html).toContain('Archived');
    expect(html).toContain('Pinned session');
  });

});
