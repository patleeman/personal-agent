import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext } from '../contexts.js';
import type { DurableRunRecord, SessionMeta } from '../types.js';
import { ConversationsPage } from './ConversationsPage.js';
import { useConversations } from '../hooks/useConversations.js';

vi.mock('../hooks/useConversations', () => ({
  useConversations: vi.fn(),
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
    isRunning: false,
    ...overrides,
  };
}

function createConversationRun(overrides: Partial<DurableRunRecord> = {}): DurableRunRecord {
  return {
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
      spec: { conversationId: 'conv-123' },
      source: { type: 'web-live-session', id: 'conv-123', filePath: '/tmp/conv-123.jsonl' },
    },
    status: {
      version: 1,
      runId: 'conversation-live-conv-123',
      status: 'recovering',
      createdAt: '2026-03-18T00:00:00.000Z',
      updatedAt: '2026-03-18T00:01:00.000Z',
      activeAttempt: 1,
      startedAt: '2026-03-18T00:00:30.000Z',
    },
    checkpoint: {
      version: 1,
      runId: 'conversation-live-conv-123',
      updatedAt: '2026-03-18T00:01:00.000Z',
      step: 'web-live-session.waiting',
      payload: { conversationId: 'conv-123', title: 'Fix runs navigation' },
    },
    problems: [],
    recoveryAction: 'resume',
    ...overrides,
  };
}

describe('ConversationsPage', () => {
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
    vi.clearAllMocks();
  });

  it('surfaces active/review conversation work, including archived conversations still running, in the all view', () => {
    const openSession = vi.fn();
    vi.mocked(useConversations).mockReturnValue({
      pinnedIds: [],
      openIds: ['open-1'],
      pinnedSessions: [],
      tabs: [createSession({ id: 'open-1', title: 'Open conversation' })],
      archivedSessions: [
        createSession({ id: 'conv-123', title: 'Needs review conversation' }),
        createSession({ id: 'archived-running', title: 'Archived but still running', isRunning: true }),
      ],
      openSession,
      closeSession: vi.fn(),
      pinSession: vi.fn(),
      unpinSession: vi.fn(),
      refetch: vi.fn(),
      loading: false,
    } as never);

    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations?filter=all']}>
        <AppDataContext.Provider value={{
          activity: null,
          projects: null,
          sessions: [
            createSession({ id: 'open-1', title: 'Open conversation' }),
            createSession({ id: 'conv-123', title: 'Needs review conversation' }),
            createSession({ id: 'archived-running', title: 'Archived but still running', isRunning: true }),
          ],
          tasks: null,
          runs: {
            scannedAt: '2026-03-18T00:02:00.000Z',
            runsRoot: '/tmp/runs',
            summary: { total: 1, recoveryActions: { resume: 1 }, statuses: { recovering: 1 } },
            runs: [
              createConversationRun({
                runId: 'conversation-live-conv-123',
                manifest: {
                  version: 1,
                  id: 'conversation-live-conv-123',
                  kind: 'conversation',
                  resumePolicy: 'continue',
                  createdAt: '2026-03-18T00:00:00.000Z',
                  spec: { conversationId: 'conv-123' },
                  source: { type: 'web-live-session', id: 'conv-123', filePath: '/tmp/conv-123.jsonl' },
                },
                checkpoint: {
                  version: 1,
                  runId: 'conversation-live-conv-123',
                  updatedAt: '2026-03-18T00:01:00.000Z',
                  step: 'web-live-session.waiting',
                  payload: { conversationId: 'conv-123', title: 'Needs review conversation' },
                },
              }),
            ],
          },
          setActivity: vi.fn(),
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <ConversationsPage />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Conversation runs');
    expect(html).toContain('Needs review conversation');
    expect(html).toContain('Needs review');
    expect(html).toContain('archived');
    expect(html).toContain('Archived but still running');
    expect(html).toContain('Still running after you archived it.');
  });

  it('keeps archived conversation work out of the default open view', () => {
    vi.mocked(useConversations).mockReturnValue({
      pinnedIds: [],
      openIds: ['open-1'],
      pinnedSessions: [],
      tabs: [createSession({ id: 'open-1', title: 'Open conversation' })],
      archivedSessions: [
        createSession({ id: 'conv-123', title: 'Needs review conversation' }),
        createSession({ id: 'archived-running', title: 'Archived but still running', isRunning: true }),
      ],
      openSession: vi.fn(),
      closeSession: vi.fn(),
      pinSession: vi.fn(),
      unpinSession: vi.fn(),
      refetch: vi.fn(),
      loading: false,
    } as never);

    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations']}>
        <AppDataContext.Provider value={{
          activity: null,
          projects: null,
          sessions: [
            createSession({ id: 'open-1', title: 'Open conversation' }),
            createSession({ id: 'conv-123', title: 'Needs review conversation' }),
            createSession({ id: 'archived-running', title: 'Archived but still running', isRunning: true }),
          ],
          tasks: null,
          runs: {
            scannedAt: '2026-03-18T00:02:00.000Z',
            runsRoot: '/tmp/runs',
            summary: { total: 1, recoveryActions: { resume: 1 }, statuses: { recovering: 1 } },
            runs: [
              createConversationRun({
                runId: 'conversation-live-conv-123',
                manifest: {
                  version: 1,
                  id: 'conversation-live-conv-123',
                  kind: 'conversation',
                  resumePolicy: 'continue',
                  createdAt: '2026-03-18T00:00:00.000Z',
                  spec: { conversationId: 'conv-123' },
                  source: { type: 'web-live-session', id: 'conv-123', filePath: '/tmp/conv-123.jsonl' },
                },
                checkpoint: {
                  version: 1,
                  runId: 'conversation-live-conv-123',
                  updatedAt: '2026-03-18T00:01:00.000Z',
                  step: 'web-live-session.waiting',
                  payload: { conversationId: 'conv-123', title: 'Needs review conversation' },
                },
              }),
            ],
          },
          setActivity: vi.fn(),
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <ConversationsPage />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Switch views from the sidebar.');
    expect(html).not.toContain('Conversation runs');
    expect(html).not.toContain('Needs review conversation');
    expect(html).not.toContain('Archived but still running');
  });
});
