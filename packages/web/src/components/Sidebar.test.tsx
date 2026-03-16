import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, LiveTitlesContext, SseConnectionContext } from '../contexts.js';
import { OPEN_SESSION_IDS_STORAGE_KEY, PINNED_SESSION_IDS_STORAGE_KEY } from '../localSettings.js';
import type { SessionMeta } from '../types.js';
import { Sidebar } from './Sidebar.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

class MemoryStorage {
  private readonly store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

function createSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'conv-123',
    file: '/tmp/conv-123.jsonl',
    timestamp: '2026-03-16T09:30:00.000Z',
    cwd: '/Users/patrickc.lee/personal/personal-agent',
    cwdSlug: 'Users-patrickc.lee-personal-personal-agent',
    model: 'openai/gpt-5.4',
    title: 'Clarify background run link',
    messageCount: 4,
    isRunning: false,
    deferredResumes: [{
      id: 'resume-1',
      sessionFile: '/tmp/conv-123.jsonl',
      prompt: 'Continue the investigation.',
      dueAt: '2026-03-16T10:01:00.000Z',
      createdAt: '2026-03-16T10:00:00.000Z',
      attempts: 0,
      status: 'scheduled',
    }],
    ...overrides,
  };
}

describe('Sidebar', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;
  const storage = new MemoryStorage();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T10:00:02.000Z'));
    storage.clear();
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-123']));
    storage.setItem(PINNED_SESSION_IDS_STORAGE_KEY, JSON.stringify([]));
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
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
    vi.useRealTimers();
  });

  it('shows deferred resume timing for conversations with a pending resume', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/inbox']}>
        <SseConnectionContext.Provider value={{ status: 'offline' }}>
          <AppDataContext.Provider value={{
            activity: { entries: [], unreadCount: 0 },
            projects: null,
            sessions: [createSession()],
            tasks: null,
            runs: null,
            setActivity: () => {},
            setProjects: () => {},
            setSessions: () => {},
            setTasks: () => {},
            setRuns: () => {},
          }}>
            <LiveTitlesContext.Provider value={{ titles: new Map(), setTitle: () => {} }}>
              <Sidebar />
            </LiveTitlesContext.Provider>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Deferred ');
    expect(html).toContain('1 scheduled · next in 58s');
  });
});
