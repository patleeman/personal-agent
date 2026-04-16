import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppEventsContext, INITIAL_APP_EVENT_VERSIONS } from '../contexts.js';
import { INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS } from '../conversation/conversationEventVersions.js';
import { useApi } from '../hooks';
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
    if (!key) {
      throw new Error(`Unexpected useApi key: ${String(key)}`);
    }

    if (key in results) {
      return createUseApiResult(results[key]);
    }

    if (String(key).includes(':checkpoint-review:')) {
      return createUseApiResult({
        data: {
          conversationId: 'conv-123',
          checkpointId: 'abc1234def567890abc1234def567890abc12345',
          github: null,
          structuralDiff: { available: false },
        },
      });
    }

    throw new Error(`Unexpected useApi key: ${String(key)}`);
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

  it('renders a checkpoint review modal with continuous diff sections', () => {
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
            fileCount: 2,
            linesAdded: 12,
            linesDeleted: 3,
            commentCount: 1,
            comments: [
              {
                id: 'comment-1',
                authorName: 'You',
                body: 'Looks good.',
                createdAt: '2026-04-14T12:05:00.000Z',
                updatedAt: '2026-04-14T12:05:00.000Z',
              },
            ],
            files: [
              {
                path: 'packages/web/src/pages/ConversationPage.tsx',
                status: 'modified',
                additions: 12,
                deletions: 3,
                patch: 'diff --git a/packages/web/src/pages/ConversationPage.tsx b/packages/web/src/pages/ConversationPage.tsx\n@@ -10,2 +10,3 @@\n old line\n-old value\n+new value\n+added value\n',
              },
              {
                path: 'packages/web/src/components/ConversationCheckpointModal.tsx',
                status: 'modified',
                additions: 4,
                deletions: 1,
                patch: 'diff --git a/packages/web/src/components/ConversationCheckpointModal.tsx b/packages/web/src/components/ConversationCheckpointModal.tsx\n@@ -1 +1 @@\n-old\n+new\n',
              },
            ],
          },
        },
      },
      'conv-123:checkpoint-review:abc1234def567890abc1234def567890abc12345': {
        data: {
          conversationId: 'conv-123',
          checkpointId: 'abc1234def567890abc1234def567890abc12345',
          github: {
            provider: 'github',
            repoUrl: 'https://github.com/patleeman/personal-agent',
            commitUrl: 'https://github.com/patleeman/personal-agent/commit/abc1234def567890abc1234def567890abc12345',
            pullRequestUrl: 'https://github.com/patleeman/personal-agent/pull/42',
            pullRequestTitle: 'feat: add checkpoint review',
            pullRequestNumber: 42,
          },
          structuralDiff: {
            available: true,
            command: 'difft',
          },
        },
      },
    });

    const html = renderModal();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('feat: add checkpoint review');
    expect(html).toContain('Copy SHA');
    expect(html).toContain('GitHub');
    expect(html).toContain('pull/42');
    expect(html).toContain('All diffs');
    expect(html).toContain('Files');
    expect(html).toContain('packages/web/src/pages/ConversationPage.tsx');
    expect(html).toContain('ConversationCheckpointModal.tsx');
    expect(html).toContain('Comments');
    expect(html).toContain('Looks good.');
  });

  it('renders local git commits as read-only reviews', () => {
    mockUseApiResults({
      'conv-123:checkpoint:abc1234def567890abc1234def567890abc12345': {
        data: {
          conversationId: 'conv-123',
          checkpoint: {
            id: 'abc1234def567890abc1234def567890abc12345',
            conversationId: 'conv-123',
            title: 'feat: local commit',
            cwd: '/tmp/workspace',
            commitSha: 'abc1234def567890abc1234def567890abc12345',
            shortSha: 'abc1234',
            subject: 'feat: local commit',
            authorName: 'Patrick Lee',
            committedAt: '2026-04-14T12:00:00.000Z',
            createdAt: '2026-04-14T12:00:00.000Z',
            updatedAt: '2026-04-14T12:00:00.000Z',
            fileCount: 1,
            linesAdded: 2,
            linesDeleted: 0,
            commentCount: 0,
            sourceKind: 'git',
            commentable: false,
            comments: [],
            files: [
              {
                path: 'README.md',
                status: 'modified',
                additions: 2,
                deletions: 0,
                patch: 'diff --git a/README.md b/README.md\n@@ -1 +1,2 @@\n hello\n+world\n',
              },
            ],
          },
        },
      },
    });

    const html = renderModal();

    expect(html).toContain('Local git commit review is read-only.');
    expect(html).toContain('Review');
    expect(html).not.toContain('Add comment');
    expect(html).not.toContain('Checkpoint comment');
  });

  it('renders an error state when the checkpoint cannot be loaded', () => {
    mockUseApiResults({
      'conv-123:checkpoint:abc1234def567890abc1234def567890abc12345': {
        error: 'Checkpoint not found.',
      },
    });

    const html = renderModal();

    expect(html).toContain('Checkpoint not found.');
    expect(html).toContain('Close');
  });
});
