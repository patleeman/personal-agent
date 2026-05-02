import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../client/api';
import { useApi } from '../hooks/useApi';
import { KnowledgePage } from './KnowledgePage.js';

vi.mock('../hooks/useApi', () => ({
  useApi: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function buildUseApiResult<T>(data: T) {
  return {
    data,
    loading: false,
    refreshing: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(data),
    replaceData: vi.fn(),
  };
}

function renderPage(pathname: string): string {
  return renderToString(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/knowledge" element={<KnowledgePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('KnowledgePage', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('useLayoutEffect does nothing on the server')) {
        return;
      }

      originalConsoleError(message, ...args);
    });

    vi.mocked(useApi).mockImplementation((fetcher) => {
      if (fetcher === api.knowledgeBase) {
        return buildUseApiResult({
          repoUrl: 'https://github.com/user/knowledge-base.git',
          branch: 'main',
          configured: true,
          effectiveRoot: '/vault',
          managedRoot: '/runtime/knowledge-base/repo',
          usesManagedRoot: true,
          syncStatus: 'idle',
          lastSyncAt: '2026-04-23T02:00:00.000Z',
          gitStatus: {
            localChangeCount: 0,
            aheadCount: 0,
            behindCount: 0,
          },
          recoveredEntryCount: 0,
          recoveryDir: '/runtime/knowledge-base/recovered',
        });
      }

      throw new Error('Unexpected useApi call');
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('shows setup guidance when managed sync is off', () => {
    vi.mocked(useApi).mockImplementationOnce((fetcher) => {
      if (fetcher === api.knowledgeBase) {
        return buildUseApiResult({
          repoUrl: '',
          branch: 'main',
          configured: false,
          effectiveRoot: '/vault',
          managedRoot: '/runtime/knowledge-base/repo',
          usesManagedRoot: false,
          syncStatus: 'disabled',
          recoveredEntryCount: 0,
          recoveryDir: '/runtime/knowledge-base/recovered',
        });
      }

      throw new Error('Unexpected useApi call');
    });

    const html = renderPage('/knowledge');

    expect(html).toContain('Sync a repo to enable Knowledge');
    expect(html).toContain('The Knowledge UI stays empty until a managed repo is configured.');
    expect(html).toContain('href="/settings#settings-general"');
    expect(html).not.toContain('Browse and edit files from the managed knowledge repo.');
    expect(html).not.toContain('Select a file to start editing');
  });

  it('shows the normal empty state when managed sync is configured', () => {
    const html = renderPage('/knowledge');

    expect(html).toContain('Select a file to start editing');
    expect(html).toContain('Pick a note from the sidebar');
    expect(html).not.toContain('Browse and edit files from the managed knowledge repo.');
  });
});
