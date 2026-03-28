import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoriesPage } from './MemoriesPage.js';
import { useApi } from '../hooks';
import { ThemeProvider } from '../theme';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('MemoriesPage', () => {
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

  function renderPage(path: string) {
    return renderToString(
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/notes" element={<MemoriesPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );
  }

  it('renders the selected note in the main workspace instead of the notes table', () => {
    vi.mocked(useApi).mockImplementation((_, key) => {
      if (key === 'note-workspace:memory-index') {
        return {
          data: {
            memory: {
              id: 'memory-index',
              title: 'Memory index',
              summary: 'Top-level knowledge hub.',
              tags: ['notes', 'index', 'structure'],
              path: '/tmp/memory-index/INDEX.md',
              type: 'structure',
              status: 'active',
              role: 'structure',
              area: 'notes',
              related: ['personal-agent'],
              referenceCount: 2,
              updated: '2026-03-17T12:00:00.000Z',
            },
            content: '# Memory index\n\nTop-level knowledge hub.',
            references: [],
            links: {
              outgoing: [],
              incoming: [],
              unresolved: [],
            },
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      return {
        data: {
          memories: [
            {
              id: 'memory-index',
              title: 'Memory index',
              summary: 'Top-level knowledge hub.',
              tags: ['notes', 'index', 'structure'],
              path: '/tmp/memory-index/INDEX.md',
              type: 'structure',
              status: 'active',
              role: 'structure',
              area: 'notes',
              related: ['personal-agent'],
              referenceCount: 2,
              updated: '2026-03-17T12:00:00.000Z',
            },
          ],
          memoryQueue: [],
        },
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
        replaceData: vi.fn(),
      };
    });

    const html = renderPage('/notes?note=memory-index');

    expect(html).toContain('Memory index');
    expect(html).toContain('Top-level knowledge hub.');
    expect(html).toContain('Chat about note');
    expect(html).toContain('memory-index');
    expect(html).not.toContain('Browse durable notes');
    expect(html).not.toContain('Search notes');
    expect(html).not.toContain('References');
    expect(html).not.toContain('Links');
  });

  it('renders a notes table from the top-level notes page', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        memories: [{
          id: 'memory-index',
          title: 'Memory index',
          summary: 'Top-level knowledge hub.',
          tags: ['notes', 'index', 'structure'],
          path: '/tmp/memory-index/INDEX.md',
          type: 'structure',
          status: 'active',
          role: 'structure',
          area: 'notes',
          updated: '2026-03-17T12:00:00.000Z',
        }],
        memoryQueue: [],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
      replaceData: vi.fn(),
    });

    const html = renderPage('/notes');

    expect(html).toContain('Browse durable notes');
    expect(html).toContain('Search notes');
    expect(html).toContain('Memory index');
    expect(html).toContain('Top-level knowledge hub.');
    expect(html).toContain('Structure note');
    expect(html).toContain('Context');
    expect(html).toContain('Updated');
  });

  it('renders work queue actions on the notes index page', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        memories: [],
        memoryQueue: [{
          conversationId: 'conv-123',
          conversationTitle: 'Refactor memory pipeline',
          runId: 'run-123',
          status: 'failed',
          createdAt: '2026-03-17T12:00:00.000Z',
          updatedAt: '2026-03-17T12:05:00.000Z',
        }],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
      replaceData: vi.fn(),
    });

    const html = renderPage('/notes');

    expect(html).toContain('Work queue');
    expect(html).toContain('Retry');
    expect(html).toContain('Recover');
    expect(html).toContain('Refactor memory pipeline');
  });

  it('shows the empty notes state when there are no notes', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        memories: [],
        memoryQueue: [],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
      replaceData: vi.fn(),
    });

    const html = renderPage('/notes');

    expect(html).toContain('No notes yet');
    expect(html).toContain('Create a note to start building durable context.');
    expect(html).toContain('Create note');
    expect(html).toContain('Search notes');
  });
});
