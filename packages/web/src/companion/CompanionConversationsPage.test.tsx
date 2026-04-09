import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, AppEventsContext, INITIAL_APP_EVENT_VERSIONS, LiveTitlesContext, SseConnectionContext } from '../contexts.js';
import { useApi } from '../hooks.js';
import type { CompanionConversationListResult, SessionMeta } from '../types.js';
import {
  CompanionConversationsPage,
  getCompanionConversationRowSwipeIntent,
  partitionCompanionSessions,
  sortCompanionSessions,
} from './CompanionConversationsPage.js';
import { CompanionLayout } from './CompanionLayout.js';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

const LOCAL_STORAGE: Record<string, string> = {};
vi.mock('../sessionTabs', () => ({
  readOpenSessionIds: () => JSON.parse(LOCAL_STORAGE['pa:open-session-ids'] ?? '[]'),
  readPinnedSessionIds: () => JSON.parse(LOCAL_STORAGE['pa:pinned-session-ids'] ?? '[]'),
  readArchivedSessionIds: () => JSON.parse(LOCAL_STORAGE['pa:archived-session-ids'] ?? '[]'),
  commitConversationLayoutMerge: vi.fn(),
  CONVERSATION_LAYOUT_CHANGED_EVENT: 'pa:conversation-layout-changed',
}));
vi.stubGlobal('localStorage', {
  getItem: (key: string) => LOCAL_STORAGE[key] ?? null,
  setItem: (key: string, value: string) => { LOCAL_STORAGE[key] = value; },
  removeItem: (key: string) => { delete LOCAL_STORAGE[key]; },
  clear: () => { Object.keys(LOCAL_STORAGE).forEach((k) => delete LOCAL_STORAGE[k]); },
});

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function createSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'conv-123',
    file: '/tmp/conv-123.jsonl',
    timestamp: '2026-03-25T00:00:00.000Z',
    cwd: '/repo',
    cwdSlug: 'repo',
    model: 'openai/gpt-5.4',
    title: 'Conversation',
    messageCount: 6,
    isRunning: false,
    ...overrides,
  };
}

describe('sortCompanionSessions', () => {
  it('keeps live sessions ahead of older stored transcripts', () => {
    const sorted = sortCompanionSessions([
      createSession({ id: 'stored', title: 'Stored transcript', timestamp: '2026-03-24T00:00:00.000Z' }),
      createSession({ id: 'live', title: 'Live conversation', isLive: true, timestamp: '2026-03-23T00:00:00.000Z' }),
    ]);

    expect(sorted.map((session) => session.id)).toEqual(['live', 'stored']);
  });
});

describe('partitionCompanionSessions', () => {
  it('splits stored conversations into review, active workspace, and archived buckets when open-tab state is known', () => {
    const sections = partitionCompanionSessions([
      createSession({ id: 'live-1', isLive: true }),
      createSession({ id: 'review-1', title: 'Needs review', needsAttention: true }),
      createSession({ id: 'active-1', title: 'Active workspace conversation' }),
      createSession({ id: 'archived-1', title: 'Archived conversation' }),
    ], new Set(['active-1']));

    expect(sections.live.map((session) => session.id)).toEqual(['live-1']);
    expect(sections.needsReview.map((session) => session.id)).toEqual(['review-1']);
    expect(sections.active.map((session) => session.id)).toEqual(['active-1']);
    expect(sections.archived.map((session) => session.id)).toEqual(['archived-1']);
    expect(sections.recent).toEqual([]);
  });

  it('lets explicit archived state win over live and review buckets', () => {
    const sections = partitionCompanionSessions([
      createSession({ id: 'live-1', title: 'Live conversation', isLive: true }),
      createSession({ id: 'review-1', title: 'Needs review', needsAttention: true }),
    ], new Set(['live-1', 'review-1']), new Set(['live-1', 'review-1']));

    expect(sections.live).toEqual([]);
    expect(sections.needsReview).toEqual([]);
    expect(sections.archived.map((session) => session.id)).toEqual(['live-1', 'review-1']);
  });
});

describe('getCompanionConversationRowSwipeIntent', () => {
  it('reveals actions after a strong left swipe', () => {
    expect(getCompanionConversationRowSwipeIntent({ deltaX: -64, deltaY: 8, actionsRevealed: false })).toBe('reveal');
  });

  it('hides actions after a right swipe when the row is already open', () => {
    expect(getCompanionConversationRowSwipeIntent({ deltaX: 36, deltaY: 6, actionsRevealed: true })).toBe('hide');
  });

  it('ignores mostly vertical gestures', () => {
    expect(getCompanionConversationRowSwipeIntent({ deltaX: -70, deltaY: 88, actionsRevealed: false })).toBe('none');
  });
});

describe('CompanionConversationsPage', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    // Set up companion workspace: active-1 is open in the companion.
    LOCAL_STORAGE['pa:open-session-ids'] = JSON.stringify(['active-1']);
    LOCAL_STORAGE['pa:pinned-session-ids'] = JSON.stringify([]);
    LOCAL_STORAGE['pa:archived-session-ids'] = JSON.stringify([]);

    vi.mocked(useApi).mockImplementation((_, cacheKey) => {
      if (cacheKey === 'companion-auth-session') {
        return {
          data: {
            session: {
              id: 'session-1',
              deviceLabel: 'Test companion',
              surface: 'companion',
              createdAt: '2026-03-25T00:00:00.000Z',
              lastUsedAt: '2026-03-25T00:00:00.000Z',
              expiresAt: '2026-04-25T00:00:00.000Z',
            },
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
          replaceData: vi.fn(),
        };
      }

      if (typeof cacheKey === 'string' && cacheKey.startsWith('companion-conversation-list:')) {
        const data: CompanionConversationListResult = {
          live: [createSession({ id: 'live-1', title: 'Old live title', isLive: true, timestamp: '2026-03-23T12:00:00.000Z' })],
          needsReview: [createSession({ id: 'review-1', title: 'Review me', needsAttention: true, timestamp: '2026-03-24T14:00:00.000Z' })],
          active: [createSession({
            id: 'active-1',
            title: 'Stored transcript',
            timestamp: '2026-03-24T12:00:00.000Z',
            deferredResumes: [{
              id: 'resume-1',
              sessionFile: '/tmp/active-1.jsonl',
              prompt: 'Continue later.',
              dueAt: '2026-03-24T12:30:00.000Z',
              createdAt: '2026-03-24T12:00:00.000Z',
              attempts: 0,
              status: 'ready',
            }],
          })],
          archived: [createSession({ id: 'archived-1', title: 'Archived transcript', timestamp: '2026-03-22T12:00:00.000Z' })],
          archivedTotal: 3,
          archivedOffset: 0,
          archivedLimit: 1,
          hasMoreArchived: true,
          workspaceSessionIds: ['active-1'],
        };

        return {
          data,
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
          replaceData: vi.fn(),
        };
      }

      return {
        data: null,
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
        replaceData: vi.fn(),
      };
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

  it('keeps the companion chats page focused on live conversations and workspace chats', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/app/conversations']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppEventsContext.Provider value={{ versions: INITIAL_APP_EVENT_VERSIONS }}>
            <LiveTitlesContext.Provider value={{ titles: new Map([['live-1', 'Live title from stream']]), setTitle: vi.fn() }}>
              <AppDataContext.Provider value={{
                activity: null,
                projects: null,
                sessions: null,
                tasks: null,
                runs: null,
                setActivity: vi.fn(),
                setProjects: vi.fn(),
                setSessions: vi.fn(),
                setTasks: vi.fn(),
                setRuns: vi.fn(),
              }}>
                <Routes>
                  <Route path="/app" element={<CompanionLayout />}>
                    <Route path="conversations" element={<CompanionConversationsPage />} />
                  </Route>
                </Routes>
              </AppDataContext.Provider>
            </LiveTitlesContext.Provider>
          </AppEventsContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Chats');
    expect(html).toContain('Open chats');
    expect(html).toContain('Open tasks');
    expect(html).toContain('1 open · 1 live elsewhere · 1 need review · 1 archived');
    expect(html).toContain('Open in workspace');
    expect(html).toContain('Live elsewhere');
    expect(html).toContain('Needs review');
    expect(html).toContain('Live title from stream');
    expect(html).toContain('Review me');
    expect(html).toContain('Stored transcript');
    expect(html).toContain('Archive conversation');
    expect(html).not.toContain('Archived transcript');
    expect(html).toContain('Show 1 archived chat');
    expect(html).not.toContain('Load more');
    expect(html).not.toContain('Signed in on Test companion');
    expect(html).not.toContain('--Users-patrick-workingdir-personal-agent--');
  });
});
