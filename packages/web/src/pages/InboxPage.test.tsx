import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, SseConnectionContext } from '../contexts.js';
import { useConversations } from '../hooks/useConversations.js';
import type { ActivitySnapshot, SessionMeta } from '../types.js';
import { InboxPage } from './InboxPage.js';

vi.mock('../hooks/useConversations', () => ({
  useConversations: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function createSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'conv-123',
    file: '/tmp/conv-123.jsonl',
    timestamp: '2026-03-18T12:00:00.000Z',
    cwd: '/repo',
    cwdSlug: 'repo',
    model: 'openai/gpt-5.4',
    title: 'Follow up on failed verification',
    messageCount: 4,
    ...overrides,
  };
}

describe('InboxPage', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('useLayoutEffect does nothing on the server')) {
        return;
      }

      originalConsoleError(message, ...args);
    });

    vi.mocked(useConversations).mockReturnValue({
      tabs: [],
      archivedSessions: [
        createSession({
          needsAttention: true,
          attentionUpdatedAt: '2026-03-18T12:05:00.000Z',
          attentionUnreadActivityCount: 1,
        }),
        createSession({
          id: 'conv-456',
          file: '/tmp/conv-456.jsonl',
          title: 'Open the runbook review',
          needsAttention: true,
          attentionUpdatedAt: '2026-03-18T12:06:00.000Z',
          attentionUnreadMessageCount: 2,
        }),
      ],
      openSession: vi.fn(),
      loading: false,
      refetch: vi.fn(),
    } as never);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('renders activity and conversation attention without surfacing alerts', () => {
    const activity: ActivitySnapshot = {
      entries: [
        {
          id: 'verification-failed-1',
          createdAt: '2026-03-18T12:01:00.000Z',
          profile: 'datadog',
          kind: 'verification',
          summary: 'Verification failed for web UI deploy',
          details: '3 tests failed in the deployment smoke suite.',
          read: false,
        },
      ],
      unreadCount: 1,
    };

    const html = renderToString(
      <MemoryRouter initialEntries={['/inbox']}>
        <Routes>
          <Route
            path="/inbox"
            element={(
              <SseConnectionContext.Provider value={{ status: 'open' }}>
                <AppDataContext.Provider value={{
                  activity,
                  alerts: {
                    activeCount: 1,
                    entries: [{
                      id: 'alert-1',
                      kind: 'reminder',
                      severity: 'disruptive',
                      status: 'active',
                      title: 'Follow up now',
                      body: 'Reminder fired for the deployment check-in.',
                      createdAt: '2026-03-18T12:02:00.000Z',
                      updatedAt: '2026-03-18T12:02:00.000Z',
                      conversationId: 'conv-123',
                      wakeupId: 'wakeup-1',
                    }],
                  },
                  projects: null,
                  sessions: [],
                  tasks: null,
                  runs: null,
                  setActivity: vi.fn(),
                  setAlerts: vi.fn(),
                  setProjects: vi.fn(),
                  setSessions: vi.fn(),
                  setTasks: vi.fn(),
                  setRuns: vi.fn(),
                }}>
                  <InboxPage />
                </AppDataContext.Provider>
              </SseConnectionContext.Provider>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('Verification failed for web UI deploy');
    expect(html).not.toContain('Follow up now');
    expect(html).not.toContain('Active alerts');
    expect(html).toContain('Clear notifications');
    expect(html).toContain('Notifications');
    expect(html).toContain('title="Start a new conversation from this inbox item"');
    expect(html).not.toContain('title="Mark this notification read"');
    expect(html).toContain('Open the runbook review');
    expect(html).toContain('title="Open the conversation that needs attention"');
  });
});
