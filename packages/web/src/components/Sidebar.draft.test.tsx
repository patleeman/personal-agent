import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, LiveTitlesContext, SseConnectionContext } from '../contexts.js';
import {
  OPEN_SESSION_IDS_STORAGE_KEY,
  PINNED_SESSION_IDS_STORAGE_KEY,
} from '../local/localSettings.js';
import type { SessionMeta } from '../types';
import { Sidebar } from './Sidebar.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

class MemoryStorage {
  private readonly store = new Map<string, string>();

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(key) ?? null;
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
    cwdSlug: 'personal-agent',
    model: 'openai/gpt-5.4',
    title: 'Existing conversation',
    messageCount: 4,
    isRunning: false,
    ...overrides,
  };
}

describe('Sidebar draft route listing', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;
  const storage = new MemoryStorage();

  beforeEach(() => {
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
  });

  it('does not show a Draft thread for a fresh new-conversation route', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/new']}>
        <SseConnectionContext.Provider value={{ status: 'offline' }}>
          <AppDataContext.Provider value={{
            projects: [],
            sessions: [createSession()],
            tasks: null,
            runs: null,
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

    expect(html).not.toContain('Collapse Draft');
    expect(html).not.toContain('New conversation in Draft');
    expect(html).toContain('Existing conversation');
  });
});
