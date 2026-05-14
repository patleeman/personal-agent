import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unmock('../hooks/useDesktopConversationState.js');
});

describe('ConversationPage desktop local state', () => {
  it('renders the active conversation from the dedicated desktop state subscription', async () => {
    vi.doMock('../hooks/useDesktopConversationState.js', () => ({
      useDesktopConversationState: () => ({
        mode: 'local',
        active: true,
        loading: false,
        error: null,
        surfaceId: 'surface-local',
        reconnect: vi.fn(),
        send: vi.fn(),
        abort: vi.fn(),
        takeover: vi.fn(),
        state: {
          conversationId: 'local-conv',
          sessionDetail: {
            meta: {
              id: 'local-conv',
              file: '/tmp/local-conv.jsonl',
              timestamp: '2026-04-11T12:00:00.000Z',
              cwd: '/tmp/project',
              cwdSlug: 'project',
              model: 'openai/gpt-5.4',
              title: 'Local desktop state',
              messageCount: 2,
              isLive: true,
            },
            blocks: [],
            blockOffset: 0,
            totalBlocks: 2,
            contextUsage: { tokens: 12 },
          },
          liveSession: {
            live: true,
            id: 'local-conv',
            cwd: '/tmp/project',
            sessionFile: '/tmp/local-conv.jsonl',
            title: 'Local desktop state',
            isStreaming: false,
            hasStaleTurnState: false,
          },
          stream: {
            blocks: [
              {
                type: 'user',
                id: 'user-1',
                ts: '2026-04-11T12:00:00.000Z',
                text: 'hello from desktop state',
              },
              {
                type: 'text',
                id: 'assistant-1',
                ts: '2026-04-11T12:00:01.000Z',
                text: 'desktop state reply',
              },
            ],
            blockOffset: 0,
            totalBlocks: 2,
            hasSnapshot: true,
            isStreaming: false,
            isCompacting: false,
            error: null,
            title: 'Local desktop state',
            tokens: null,
            cost: null,
            contextUsage: { tokens: 12 },
            pendingQueue: { steering: [], followUp: [] },
            parallelJobs: [],
            presence: {
              surfaces: [],
              controllerSurfaceId: null,
              controllerSurfaceType: null,
              controllerAcquiredAt: null,
            },
            autoModeState: null,
            systemPrompt: 'You are a local desktop agent.',
            cwdChange: null,
          },
        },
      }),
    }));

    const { ConversationPage } = await import('./ConversationPage.js');
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/local-conv']}>
        <Routes>
          <Route path="/conversations/:id" element={<ConversationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('System prompt');
    expect(html).toContain('Runtime instructions available for inspection.');
    expect(html).toContain('hello from desktop state');
    expect(html).toContain('desktop state reply');
    expect(html).toContain('Local desktop state');
  });
});
