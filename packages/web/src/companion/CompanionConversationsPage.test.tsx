import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, LiveTitlesContext, SseConnectionContext } from '../contexts.js';
import type { SessionMeta } from '../types.js';
import { CompanionConversationsPage, sortCompanionSessions } from './CompanionConversationsPage.js';
import { CompanionLayout } from './CompanionLayout.js';

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

describe('CompanionConversationsPage', () => {
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

  it('renders live conversations before recent stored conversations', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/app/conversations']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <LiveTitlesContext.Provider value={{ titles: new Map([['live-1', 'Live title from stream']]), setTitle: vi.fn() }}>
            <AppDataContext.Provider value={{
              activity: null,
              projects: null,
              sessions: [
                createSession({ id: 'recent-1', title: 'Stored transcript', timestamp: '2026-03-24T12:00:00.000Z' }),
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

    expect(html).toContain('Continue conversations');
    expect(html).toContain('Live now');
    expect(html).toContain('Recent');
    expect(html).toContain('Live title from stream');
    expect(html.indexOf('Live title from stream')).toBeLessThan(html.indexOf('Stored transcript'));
  });
});
