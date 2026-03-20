import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext } from '../contexts.js';
import { useApi } from '../hooks.js';
import { useConversations } from '../hooks/useConversations.js';
import { useDurableRunStream } from '../hooks/useDurableRunStream.js';
import type { DurableRunDetailResult, SessionMeta } from '../types.js';
import { ContextRail } from './ContextRail.js';

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
          activity: null,
          projects: null,
          sessions: [createSession()],
          tasks: null,
          runs: null,
          setActivity: vi.fn(),
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <ContextRail />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('← Conversation');
    expect(html).toContain('Current conversation');
    expect(html).toContain('This run belongs to the current conversation.');
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
          activity: null,
          projects: null,
          sessions: [
            createSession({ id: 'source-1', title: 'Source conversation', file: '/tmp/source-1.jsonl' }),
            createSession({ id: 'target-1', title: 'Target conversation', file: '/tmp/target-1.jsonl' }),
          ],
          tasks: null,
          runs: null,
          setActivity: vi.fn(),
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

  it('opens run details in the runs rail without conversation-only chrome', () => {
    vi.mocked(useDurableRunStream).mockReturnValue({
      detail: createDetail(),
      log: { path: '/tmp/runs/conversation-live-conv-123/output.log', log: '' },
      loading: false,
      error: null,
      reconnect: vi.fn(),
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/runs/conversation-live-conv-123']}>
        <AppDataContext.Provider value={{
          activity: null,
          projects: null,
          sessions: [createSession()],
          tasks: null,
          runs: null,
          setActivity: vi.fn(),
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <ContextRail />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Fix runs navigation');
    expect(html).toContain('href="/conversations/conv-123"');
    expect(html).not.toContain('← Conversation');
    expect(html).not.toContain('Full page');
  });

  it('shows package-local references in the memories rail', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        memory: {
          id: 'personal-agent',
          title: 'Personal-agent knowledge hub',
          summary: 'Durable knowledge hub for personal-agent.',
          tags: ['personal-agent', 'web-ui'],
          path: '/tmp/personal-agent/MEMORY.md',
          type: 'project',
          status: 'active',
          area: 'personal-agent',
          role: 'hub',
          related: ['personal-agent-web-ui-preferences'],
          updated: '2026-03-18T12:00:00.000Z',
        },
        content: '---\nname: personal-agent\n---\n# Personal-agent knowledge hub\n',
        references: [{
          title: 'Web UI preferences',
          summary: 'Durable UI notes.',
          tags: ['personal-agent', 'web-ui'],
          path: '/tmp/personal-agent/references/personal-agent-web-ui-preferences.md',
          relativePath: 'references/personal-agent-web-ui-preferences.md',
          updated: '2026-03-18T12:00:00.000Z',
        }],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/memories?memory=personal-agent']}>
        <AppDataContext.Provider value={{
          activity: null,
          projects: null,
          sessions: [createSession()],
          tasks: null,
          runs: null,
          setActivity: vi.fn(),
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <ContextRail />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Package');
    expect(html).toContain('Role');
    expect(html).toContain('href="/memories?memory=personal-agent-web-ui-preferences"');
    expect(html).toContain('Package files');
    expect(html).toContain('MEMORY.md');
    expect(html).toContain('Web UI preferences');
    expect(html).toContain('references/personal-agent-web-ui-preferences.md');
  });

  it('shows working directory before the todo list on the draft conversation rail', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/new']}>
        <AppDataContext.Provider value={{
          activity: null,
          projects: null,
          sessions: [createSession()],
          tasks: null,
          runs: null,
          setActivity: vi.fn(),
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
    expect(html.indexOf('Todo list')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('Working Directory')).toBeLessThan(html.indexOf('Todo list'));
  });
});
