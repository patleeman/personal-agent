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

  it('renders memory packages with the shared list layout and selected row styling', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        memories: [
          {
            id: 'memory-index',
            title: 'Memory index',
            summary: 'Top-level knowledge hub.',
            tags: ['memory', 'index'],
            path: '/tmp/memory-index/MEMORY.md',
            type: 'index',
            status: 'active',
            role: 'hub',
            area: 'memory',
            related: ['personal-agent'],
            referenceCount: 2,
            updated: '2026-03-17T12:00:00.000Z',
          },
          {
            id: 'writing-style',
            title: 'Writing style',
            summary: 'Keep responses concise and direct.',
            tags: ['communication'],
            path: '/tmp/writing-style/MEMORY.md',
            role: 'hub',
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
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/memories?memory=memory-index']}>
        <Routes>
          <Route path="/memories" element={<MemoriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('Memory packages');
    expect(html).toContain('Search packages');
    expect(html).toContain('Selected package');
    expect(html).toContain('Memory index');
    expect(html).toContain('Writing style');
    expect(html).toContain('2 references');
    expect(html).toContain('1 related package');
    expect(html).toContain('parent');
    expect(html).toContain('href="/memories?memory=memory-index"');
    expect(html).toContain('ui-list-row-selected');
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
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/memories']}>
        <Routes>
          <Route path="/memories" element={<MemoriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('Memory work queue');
    expect(html).toContain('Refactor memory pipeline');
    expect(html).toContain('run-123');
    expect(html).toContain('/conversations/conv-123?run=run-123');
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
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/memories']}>
        <Routes>
          <Route path="/memories" element={<MemoriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('/conversations/conv-123');
    expect(html).not.toContain('/conversations/conv-123?run=state%3Aconv-123');
  });

  it('shows the empty state when there are no memory packages', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        memories: [],
        memoryQueue: [],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/memories']}>
        <Routes>
          <Route path="/memories" element={<MemoriesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('No memories yet.');
    expect(html).toContain('Distill a conversation message to create or update a durable memory package.');
  });
});
