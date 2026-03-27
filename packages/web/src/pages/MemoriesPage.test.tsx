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

  it('renders the selected note in the main workspace instead of the browse list', () => {
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
            references: [{
              title: 'Web UI preferences',
              summary: 'Durable UI notes.',
              tags: ['personal-agent'],
              path: '/tmp/memory-index/references/prefs.md',
              relativePath: 'references/prefs.md',
            }],
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
    expect(html).toContain('Main');
    expect(html).toContain('References (1)');
    expect(html).toContain('Links');
    expect(html).toContain('Chat about note');
    expect(html).toContain('memory-index');
    expect(html).not.toContain('Search notes');
  });

  it('keeps queue details out of the main notes workspace', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        memories: [],
        memoryQueue: [{
          conversationId: 'conv-123',
          conversationTitle: 'Refactor memory pipeline',
          runId: 'run-123',
          status: 'running',
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

    expect(html).toContain('1');
    expect(html).toContain('in queue');
    expect(html).not.toContain('Note work queue');
    expect(html).not.toContain('Refactor memory pipeline');
    expect(html).not.toContain('run-123');
    expect(html).not.toContain('Retry');
    expect(html).not.toContain('Recover');
  });

  it('does not render queue actions in the main notes workspace', () => {
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

    expect(html).toContain('1');
    expect(html).toContain('in queue');
    expect(html).not.toContain('Retry');
    expect(html).not.toContain('Retry this node distillation');
    expect(html).not.toContain('Recover');
  });

  it('shows the empty workspace state when there are no notes', () => {
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
    expect(html).toContain('The right rail is for browsing notes and note resources.');
    expect(html).toContain('Create note');
  });
});
