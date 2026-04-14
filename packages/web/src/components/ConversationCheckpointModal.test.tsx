import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppEventsContext, INITIAL_APP_EVENT_VERSIONS } from '../contexts.js';
import { INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS } from '../conversationEventVersions.js';
import { useApi } from '../hooks.js';
import { ConversationCheckpointModal } from './ConversationCheckpointModal.js';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function createUseApiResult(overrides: Partial<ReturnType<typeof useApi>> = {}) {
  return {
    data: null,
    loading: false,
    refreshing: false,
    error: null,
    refetch: vi.fn(),
    replaceData: vi.fn(),
    ...overrides,
  };
}

function mockUseApiResults(results: Record<string, Partial<ReturnType<typeof useApi>>>) {
  vi.mocked(useApi).mockImplementation((_fetcher, key) => {
    if (!key || !(key in results)) {
      throw new Error(`Unexpected useApi key: ${String(key)}`);
    }

    return createUseApiResult(results[key]);
  });
}

function renderModal(entry = '/conversations/conv-123?checkpoint=abc1234def567890abc1234def567890abc12345&checkpointFile=packages/web/src/pages/ConversationPage.tsx') {
  return renderToString(
    <MemoryRouter initialEntries={[entry]}>
      <AppEventsContext.Provider value={{ versions: INITIAL_APP_EVENT_VERSIONS, conversationVersions: INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS }}>
        <ConversationCheckpointModal conversationId="conv-123" checkpointId="abc1234def567890abc1234def567890abc12345" />
      </AppEventsContext.Provider>
    </MemoryRouter>,
  );
}

describe('ConversationCheckpointModal', () => {
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

  it('renders a two-pane checkpoint review modal', () => {
    mockUseApiResults({
      'conv-123:checkpoint:abc1234def567890abc1234def567890abc12345': {
        data: {
          conversationId: 'conv-123',
          checkpoint: {
            id: 'abc1234def567890abc1234def567890abc12345',
            conversationId: 'conv-123',
            title: 'feat: add checkpoint review',
            cwd: '/tmp/workspace',
            commitSha: 'abc1234def567890abc1234def567890abc12345',
            shortSha: 'abc1234',
            subject: 'feat: add checkpoint review',
            authorName: 'Patrick Lee',
            authorEmail: 'patrick@example.com',
            committedAt: '2026-04-14T12:00:00.000Z',
            createdAt: '2026-04-14T12:00:01.000Z',
            updatedAt: '2026-04-14T12:00:01.000Z',
            fileCount: 1,
            linesAdded: 12,
            linesDeleted: 3,
            files: [
              {
                path: 'packages/web/src/pages/ConversationPage.tsx',
                status: 'modified',
                additions: 12,
                deletions: 3,
                patch: 'diff --git a/packages/web/src/pages/ConversationPage.tsx b/packages/web/src/pages/ConversationPage.tsx\n@@ -10,2 +10,3 @@\n old line\n-old value\n+new value\n+added value\n',
              },
            ],
          },
        },
      },
    });

    const html = renderModal();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('feat: add checkpoint review');
    expect(html).toContain('copy sha');
    expect(html).toContain('Files');
    expect(html).toContain('packages/web/src/pages/ConversationPage.tsx');
    expect(html).toContain('text-success');
    expect(html).toContain('text-danger');
    expect(html).toContain('12');
    expect(html).toContain('3');
  });

  it('renders an error state when the checkpoint cannot be loaded', () => {
    mockUseApiResults({
      'conv-123:checkpoint:abc1234def567890abc1234def567890abc12345': {
        error: 'Checkpoint not found.',
      },
    });

    const html = renderModal();

    expect(html).toContain('Checkpoint not found.');
    expect(html).toContain('close');
  });
});
