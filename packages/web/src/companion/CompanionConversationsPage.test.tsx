import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, LiveTitlesContext, SseConnectionContext } from '../contexts.js';
import { useApi } from '../hooks.js';
import type { SessionMeta } from '../types.js';
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

      return {
        data: {
          sessionIds: ['active-1'],
          pinnedSessionIds: [],
        },
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

  it('renders live, review, active workspace, and archived companion sections', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/app/conversations']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <LiveTitlesContext.Provider value={{ titles: new Map([['live-1', 'Live title from stream']]), setTitle: vi.fn() }}>
            <AppDataContext.Provider value={{
              activity: null,
              projects: null,
              sessions: [
                createSession({ id: 'review-1', title: 'Review me', needsAttention: true, timestamp: '2026-03-24T14:00:00.000Z' }),
                createSession({ id: 'active-1', title: 'Stored transcript', timestamp: '2026-03-24T12:00:00.000Z' }),
                createSession({ id: 'archived-1', title: 'Archived transcript', timestamp: '2026-03-22T12:00:00.000Z' }),
                createSession({ id: 'live-1', title: 'Old live title', isLive: true, timestamp: '2026-03-23T12:00:00.000Z' }),
              ],
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
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Chats');
    expect(html).toContain('Open chats');
    expect(html).toContain('Open projects');
    expect(html).toContain('Open memories');
    expect(html).toContain('Open skills');
    expect(html).toContain('Live now');
    expect(html).toContain('Needs review');
    expect(html).toContain('Active workspace');
    expect(html).toContain('Archived');
    expect(html).toContain('Live title from stream');
    expect(html).toContain('Review me');
    expect(html).toContain('Stored transcript');
    expect(html).toContain('Archived transcript');
    expect(html).toContain('aria-label="Archive conversation"');
    expect(html).toContain('aria-label="Open conversation"');
    expect(html).toContain('aria-label="Show actions for Stored transcript"');
    expect(html).not.toContain('--Users-patrick-workingdir-personal-agent--');
    expect(html.indexOf('Live title from stream')).toBeLessThan(html.indexOf('Review me'));
    expect(html.indexOf('Review me')).toBeLessThan(html.indexOf('Stored transcript'));
    expect(html.indexOf('Stored transcript')).toBeLessThan(html.indexOf('Archived transcript'));
  });
});
