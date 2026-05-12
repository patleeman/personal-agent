import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stream: vi.fn(() => ({ kind: 'stream' })),
  streamSimple: vi.fn(() => ({ kind: 'streamSimple' })),
}));

vi.mock('@earendil-works/pi-ai', () => ({
  stream: mocks.stream,
  streamSimple: mocks.streamSimple,
}));

import { applyLiveSessionServiceTier } from './liveSessionModels.js';

type TestStreamFn = (model: unknown, context: unknown, options?: unknown) => Promise<unknown>;

interface TestSession {
  agent: { streamFn?: TestStreamFn };
  modelRegistry: { getApiKeyAndHeaders: ReturnType<typeof vi.fn> };
}

function createSession(authResult = { ok: true as const, apiKey: 'token', headers: { 'x-auth': 'yes' } }): TestSession {
  return {
    agent: {},
    modelRegistry: {
      getApiKeyAndHeaders: vi.fn(async () => authResult),
    },
  };
}

async function callStreamFn(session: TestSession, model: unknown, context: unknown, options?: unknown): Promise<unknown> {
  const streamFn = session.agent.streamFn;
  if (!streamFn) throw new Error('Expected streamFn to be installed.');
  return streamFn(model, context, options);
}

describe('liveSessionModels', () => {
  beforeEach(() => {
    mocks.stream.mockClear();
    mocks.streamSimple.mockClear();
  });

  it('pins Codex Responses conversations to SSE to avoid unstable WebSocket closes', async () => {
    const session = createSession();
    applyLiveSessionServiceTier(session as unknown as AgentSession, '');

    await callStreamFn(
      session,
      { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-codex-responses' },
      { messages: [] },
      { headers: { 'x-request': '1' } },
    );

    expect(mocks.streamSimple).toHaveBeenCalledWith(
      expect.objectContaining({ api: 'openai-codex-responses' }),
      { messages: [] },
      expect.objectContaining({
        apiKey: 'token',
        headers: { 'x-auth': 'yes', 'x-request': '1' },
        transport: 'sse',
      }),
    );
  });

  it('leaves non-Codex transports alone', async () => {
    const session = createSession();
    applyLiveSessionServiceTier(session as unknown as AgentSession, '');

    await callStreamFn(session, { id: 'gpt-4o', provider: 'openai', api: 'openai-responses' }, { messages: [] }, {});

    expect(mocks.streamSimple).toHaveBeenCalledWith(
      expect.objectContaining({ api: 'openai-responses' }),
      { messages: [] },
      expect.not.objectContaining({ transport: 'sse' }),
    );
  });
});
