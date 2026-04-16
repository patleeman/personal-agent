import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppEventsContext, INITIAL_APP_EVENT_VERSIONS } from '../app/contexts.js';
import { INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS } from '../conversation/conversationEventVersions.js';
import { useApi } from '../hooks/useApi';
import { ConversationArtifactModal } from './ConversationArtifactModal.js';

vi.mock('../hooks/useApi', () => ({
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

function renderModal(entry = '/conversations/conv-123?artifact=artifact-html') {
  return renderToString(
    <MemoryRouter initialEntries={[entry]}>
      <AppEventsContext.Provider value={{ versions: INITIAL_APP_EVENT_VERSIONS, conversationVersions: INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS }}>
        <ConversationArtifactModal conversationId="conv-123" artifactId="artifact-html" />
      </AppEventsContext.Provider>
    </MemoryRouter>,
  );
}

describe('ConversationArtifactModal', () => {
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

  it('renders a modal artifact viewer with navigation for sibling artifacts', () => {
    mockUseApiResults({
      'conv-123:artifact-html': {
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
            content: '<section><h1>Draft</h1><p>Hello from desktop.</p></section>',
          },
        },
      },
      'conv-123:artifacts': {
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
    });

    const html = renderModal();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('Product draft');
    expect(html).toContain('Architecture diagram');
    expect(html).toContain('copy source');
    expect(html).toContain('show source');
    expect(html).toContain('iframe');
  });

  it('renders an error state when the artifact cannot be loaded', () => {
    mockUseApiResults({
      'conv-123:artifact-html': {
        error: 'Artifact not found.',
      },
      'conv-123:artifacts': {
        data: {
          conversationId: 'conv-123',
          artifacts: [],
        },
      },
    });

    const html = renderModal();

    expect(html).toContain('Artifact not found.');
    expect(html).toContain('close');
  });
});
