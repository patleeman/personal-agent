import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, SystemStatusContext } from '../contexts.js';
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

  it('opens run details in the system rail without conversation-only chrome', () => {
    vi.mocked(useDurableRunStream).mockReturnValue({
      detail: createDetail(),
      log: { path: '/tmp/runs/conversation-live-conv-123/output.log', log: '' },
      loading: false,
      error: null,
      reconnect: vi.fn(),
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/system?run=conversation-live-conv-123']}>
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

  it('renders system details and logs in the context rail on the system page', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/system?component=daemon']}>
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
          <SystemStatusContext.Provider value={{
            daemon: {
              warnings: [],
              service: {
                platform: 'launchd',
                identifier: 'io.test.daemon',
                manifestPath: '/tmp/io.test.daemon.plist',
                installed: true,
                running: true,
              },
              runtime: {
                running: true,
                socketPath: '/tmp/personal-agentd.sock',
                pid: 123,
                startedAt: '2026-03-18T17:00:00.000Z',
                moduleCount: 4,
                queueDepth: 0,
                maxQueueDepth: 1000,
              },
              log: {
                path: '/tmp/daemon.log',
                lines: ['daemon ready'],
              },
            },
            gateway: null,
            sync: null,
            webUi: null,
            setDaemon: vi.fn(),
            setGateway: vi.fn(),
            setSync: vi.fn(),
            setWebUi: vi.fn(),
          }}>
            <ContextRail />
          </SystemStatusContext.Provider>
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('System');
    expect(html).toContain('Daemon');
    expect(html).toContain('Restart daemon');
    expect(html).toContain('Log');
    expect(html).toContain('daemon ready');
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

    expect(html).toContain('Overview');
    expect(html).toContain('Pinned');
    expect(html).toContain('Archived');
    expect(html).toContain('Pinned session');
  });

  it('renders selected memory details in the rail', () => {
    vi.mocked(useApi).mockImplementation((_, key) => {
      if (key === 'personal-agent') {
        return {
          data: {
            memory: {
              id: 'personal-agent',
              title: 'Personal-agent knowledge hub',
              summary: 'Durable knowledge hub for personal-agent.',
              tags: ['personal-agent'],
              path: '/tmp/personal-agent/MEMORY.md',
              type: 'project',
              status: 'active',
              updated: '2026-03-18T12:00:00.000Z',
            },
            content: '# Personal-agent knowledge hub',
            references: [{
              title: 'Web UI preferences',
              summary: 'Durable UI notes.',
              tags: ['personal-agent'],
              path: '/tmp/personal-agent/references/prefs.md',
              relativePath: 'references/prefs.md',
            }],
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      return {
        data: null,
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
      };
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

    expect(html).toContain('Personal-agent knowledge hub');
    expect(html).toContain('MEMORY.md');
    expect(html).toContain('references/prefs.md');
  });

  it('renders selected skill details in the rail', () => {
    vi.mocked(useApi).mockImplementation((_, key) => {
      if (key === 'skills-rail-memory') {
        return {
          data: {
            profile: 'shared',
            agentsMd: [],
            memoryDocs: [],
            skills: [{
              name: 'workflow-tdd-feature',
              description: 'Build a feature with test-driven development.',
              source: 'shared',
              path: '/tmp/workflow-tdd-feature/SKILL.md',
              recentSessionCount: 2,
              lastUsedAt: '2026-03-18T12:00:00.000Z',
              usedInLastSession: true,
            }],
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (key === 'knowledge-skill-rail:/tmp/workflow-tdd-feature/SKILL.md') {
        return {
          data: { content: '# Workflow TDD feature' },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      return {
        data: null,
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
      };
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/skills?skill=workflow-tdd-feature']}>
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

    expect(html).toContain('TDD Feature');
    expect(html).toContain('Build a feature with test-driven development.');
    expect(html).toContain('/tmp/workflow-tdd-feature/SKILL.md');
  });

  it('renders selected instruction details in the rail', () => {
    vi.mocked(useApi).mockImplementation((_, key) => {
      if (key === 'instructions-rail-memory') {
        return {
          data: {
            profile: 'shared',
            memoryDocs: [],
            skills: [],
            agentsMd: [{
              source: 'shared/AGENTS.md',
              path: '/tmp/shared/AGENTS.md',
              exists: true,
              content: '# Shared instructions',
            }],
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      return {
        data: null,
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
      };
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/instructions?instruction=%2Ftmp%2Fshared%2FAGENTS.md']}>
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

    expect(html).toContain('shared/AGENTS.md');
    expect(html).toContain('/tmp/shared/AGENTS.md');
    expect(html).toContain('Shared instructions');
  });
});
