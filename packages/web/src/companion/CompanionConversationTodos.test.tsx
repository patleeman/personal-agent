import React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApi } from '../hooks.js';
import { CompanionConversationTodos } from './CompanionConversationTodos.js';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('CompanionConversationTodos', () => {
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

  it('renders conversation checklist items and waiting state in the companion panel', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        conversationId: 'conv-123',
        live: true,
        inheritedPresetIds: [],
        automation: {
          conversationId: 'conv-123',
          enabled: true,
          activeItemId: 'item-1',
          updatedAt: '2026-03-25T00:00:00.000Z',
          waitingForUser: {
            createdAt: '2026-03-25T00:00:00.000Z',
            updatedAt: '2026-03-25T00:05:00.000Z',
            reason: 'Need approval to continue.',
          },
          items: [
            {
              id: 'item-1',
              label: 'Use agent browser',
              skillName: 'tool-agent-browser',
              status: 'running',
              createdAt: '2026-03-25T00:00:00.000Z',
              updatedAt: '2026-03-25T00:05:00.000Z',
              resultReason: 'Navigating now.',
            },
          ],
        },
        presetLibrary: {
          presets: [],
          defaultPresetIds: [],
        },
        skills: [
          {
            name: 'tool-agent-browser',
            description: 'Automate browsers and Electron apps with agent-browser.',
            source: 'shared',
          },
        ],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
      replaceData: vi.fn(),
    });

    const html = renderToString(<CompanionConversationTodos conversationId="conv-123" />);

    expect(html).toContain('Agent reminders');
    expect(html).toContain('Waiting for you');
    expect(html).toContain('Need approval to continue.');
    expect(html).toContain('/skill:tool-agent-browser');
    expect(html).toContain('Refresh');
  });

  it('renders completed items with a clearly visible strikethrough style', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        conversationId: 'conv-123',
        live: true,
        inheritedPresetIds: [],
        automation: {
          conversationId: 'conv-123',
          enabled: true,
          activeItemId: null,
          updatedAt: '2026-03-25T00:00:00.000Z',
          items: [
            {
              id: 'item-1',
              label: 'Ship the UI fix',
              text: 'Ship the UI fix',
              kind: 'instruction',
              status: 'completed',
              createdAt: '2026-03-25T00:00:00.000Z',
              updatedAt: '2026-03-25T00:05:00.000Z',
              resultReason: 'Completed.',
            },
          ],
        },
        presetLibrary: {
          presets: [],
          defaultPresetIds: [],
        },
        skills: [],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
      replaceData: vi.fn(),
    });

    const html = renderToString(<CompanionConversationTodos conversationId="conv-123" />);

    expect(html).toContain('line-through');
    expect(html).toContain('text-decoration-thickness:2px');
    expect(html).toContain('text-decoration-color:rgb(var(--color-primary) / 0.72)');
  });

  it('shows the mirrored read-only explanation when the phone has not taken over', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        conversationId: 'conv-123',
        live: true,
        inheritedPresetIds: [],
        automation: {
          conversationId: 'conv-123',
          enabled: true,
          activeItemId: null,
          updatedAt: '2026-03-25T00:00:00.000Z',
          items: [],
        },
        presetLibrary: {
          presets: [],
          defaultPresetIds: [],
        },
        skills: [],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
      replaceData: vi.fn(),
    });

    const html = renderToString(
      <CompanionConversationTodos
        conversationId="conv-123"
        readOnly
        readOnlyReason="Take over to manage the agent reminders from this device."
      />,
    );

    expect(html).toContain('Take over to manage the agent reminders from this device.');
    expect(html).toContain('Take over to edit the agent reminders from this device.');
  });
});
