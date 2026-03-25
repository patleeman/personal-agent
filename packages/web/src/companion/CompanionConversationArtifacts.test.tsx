import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppEventsContext, INITIAL_APP_EVENT_VERSIONS } from '../contexts.js';
import { useApi } from '../hooks.js';
import { CompanionConversationArtifacts } from './CompanionConversationArtifacts.js';

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

function renderArtifacts(entry = '/app/conversations/conv-123') {
  return renderToString(
    <MemoryRouter initialEntries={[entry]}>
      <AppEventsContext.Provider value={{ versions: INITIAL_APP_EVENT_VERSIONS }}>
        <CompanionConversationArtifacts conversationId="conv-123" />
      </AppEventsContext.Provider>
    </MemoryRouter>,
  );
}

describe('CompanionConversationArtifacts', () => {
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

  it('renders an empty read-only artifact section when the conversation has no saved outputs yet', () => {
    mockUseApiResults({
      'companion-conversation-artifacts:conv-123': {
        data: {
          conversationId: 'conv-123',
          artifacts: [],
        },
      },
    });

    const html = renderArtifacts();

    expect(html).toContain('Artifacts');
    expect(html).toContain('Read only');
    expect(html).toContain('No artifacts yet.');
    expect(html).toContain('Open them read-only from your phone once they are ready.');
  });

  it('renders the artifact list and a full-screen mobile viewer when an artifact is selected', () => {
    mockUseApiResults({
      'companion-conversation-artifacts:conv-123': {
        data: {
          conversationId: 'conv-123',
          artifacts: [
            {
              id: 'artifact-html',
              conversationId: 'conv-123',
              title: 'Product draft',
              kind: 'html',
              createdAt: '2026-03-25T00:00:00.000Z',
              updatedAt: '2026-03-25T00:05:00.000Z',
              revision: 2,
            },
            {
              id: 'artifact-diagram',
              conversationId: 'conv-123',
              title: 'Architecture diagram',
              kind: 'mermaid',
              createdAt: '2026-03-25T00:01:00.000Z',
              updatedAt: '2026-03-25T00:06:00.000Z',
              revision: 1,
            },
          ],
        },
      },
      'companion-conversation-artifact:conv-123:artifact-html': {
        data: {
          conversationId: 'conv-123',
          artifact: {
            id: 'artifact-html',
            conversationId: 'conv-123',
            title: 'Product draft',
            kind: 'html',
            createdAt: '2026-03-25T00:00:00.000Z',
            updatedAt: '2026-03-25T00:05:00.000Z',
            revision: 2,
            content: '<section><h1>Draft</h1><p>Hello from mobile.</p></section>',
          },
        },
      },
    });

    const html = renderArtifacts('/app/conversations/conv-123?artifact=artifact-html');

    expect(html).toContain('Product draft');
    expect(html).toContain('Architecture diagram');
    expect(html).toContain('← Conversation');
    expect(html).toContain('View-only in the companion app.');
    expect(html).toContain('copy source');
    expect(html).toContain('show source');
    expect(html).toContain('More artifacts');
    expect(html).toContain('opened');
    expect(html).toContain('iframe');
  });

  it('shows a list-level error when artifact discovery fails', () => {
    mockUseApiResults({
      'companion-conversation-artifacts:conv-123': {
        error: 'offline',
      },
    });

    const html = renderArtifacts();

    expect(html).toContain('Unable to load artifacts:');
    expect(html).toContain('offline');
  });

  it('shows an artifact error state when a deep-linked artifact cannot be loaded', () => {
    mockUseApiResults({
      'companion-conversation-artifacts:conv-123': {
        data: {
          conversationId: 'conv-123',
          artifacts: [],
        },
      },
      'companion-conversation-artifact:conv-123:missing-artifact': {
        error: 'Artifact not found.',
      },
    });

    const html = renderArtifacts('/app/conversations/conv-123?artifact=missing-artifact');

    expect(html).toContain('Unable to load this artifact.');
    expect(html).toContain('Artifact not found.');
  });
});
