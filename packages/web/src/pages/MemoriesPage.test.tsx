import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoriesPage } from './MemoriesPage.js';
import { useApi } from '../hooks';

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

  it('renders notes with clearer overview copy and selected note context', () => {
    vi.mocked(useApi).mockReturnValue({
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
          {
            id: 'writing-style',
            title: 'Writing style',
            summary: 'Keep responses concise and direct.',
            tags: ['communication'],
            path: '/tmp/writing-style/INDEX.md',
            area: 'communication',
            parent: 'memory-index',
            referenceCount: 1,
            updated: '2026-03-15T08:00:00.000Z',
          },
        ],
        memoryQueue: [],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
      replaceData: vi.fn(),
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/notes?note=memory-index']}>
        <Routes>
          <Route path="/notes" element={<MemoriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('Search notes');
    expect(html).toContain('New note');
    expect(html).toContain('Selected @memory-index');
    expect(html).toContain('Memory index');
    expect(html).toContain('Writing style');
    expect(html).toContain('Structure note');
    expect(html).toContain('parent @memory-index');
    expect(html).toContain('2 references');
    expect(html).toContain('1 related node');
    expect(html).toContain('href="/notes?note=memory-index"');
    expect(html).toContain('ui-list-row-selected');
    expect(html).not.toContain('What notes are');
    expect(html).not.toContain('About this note');
    expect(html).not.toContain('Browse memories');
  });

  it('shows active distillation work in the memory queue', () => {
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

    const html = renderToString(
      <MemoryRouter initialEntries={['/notes']}>
        <Routes>
          <Route path="/notes" element={<MemoriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('Note work queue');
    expect(html).toContain('Refactor memory pipeline');
    expect(html).toContain('run-123');
    expect(html).toContain('/conversations/conv-123?run=run-123');
    expect(html).not.toContain('Retry');
    expect(html).not.toContain('Recover');
  });

  it('shows retry actions per failed distillation and a single batch recovery action', () => {
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

    const html = renderToString(
      <MemoryRouter initialEntries={['/notes']}>
        <Routes>
          <Route path="/notes" element={<MemoriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('Retry');
    expect(html).toContain('Retry this node distillation');
    expect(html).toContain('Recover failed extractions');
    expect(html).toContain('Start one background recovery run for every failed or interrupted note extraction');
    expect(html).not.toContain('Open a recovery conversation for this node distillation');
  });

  it('keeps state-only queue items linked to the conversation when no durable run exists', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        memories: [],
        memoryQueue: [{
          conversationId: 'conv-123',
          conversationTitle: 'Refactor memory pipeline',
          runId: 'state:conv-123',
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

    const html = renderToString(
      <MemoryRouter initialEntries={['/notes']}>
        <Routes>
          <Route path="/notes" element={<MemoriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('/conversations/conv-123');
    expect(html).not.toContain('/conversations/conv-123?run=state%3Aconv-123');
    expect(html).not.toContain('Retry');
    expect(html).not.toContain('Recover');
  });

  it('shows the empty state when there are no note nodes', () => {
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

    const html = renderToString(
      <MemoryRouter initialEntries={['/notes']}>
        <Routes>
          <Route path="/notes" element={<MemoriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('No notes yet.');
    expect(html).toContain('Create one yourself or distill a conversation into a durable note.');
    expect(html).toContain('Create note');
  });
});
