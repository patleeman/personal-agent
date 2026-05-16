import { afterEach, describe, expect, it, vi } from 'vitest';

const { compactMock } = vi.hoisted(() => ({
  compactMock: vi.fn(),
}));

vi.mock('@personal-agent/extensions/backend/compaction', () => ({
  compactConversation: compactMock,
}));

import openaiNativeCompactionExtension, {
  buildCompactHeaders,
  compactEndpointUrl,
  extractCodexAccountId,
  modelKey,
  reconstructNativeState,
} from './backend';

const OPENAI_MODEL = {
  provider: 'openai',
  api: 'openai-responses',
  id: 'gpt-5.4-mini',
} as const;

const CODEX_MODEL = {
  provider: 'openai-codex',
  api: 'openai-codex-responses',
  id: 'gpt-5.4',
} as const;

const OTHER_MODEL = {
  provider: 'anthropic',
  api: 'anthropic',
  id: 'claude-sonnet-4-5',
} as const;

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

function userMessageEntry(id: string, text: string) {
  return {
    id,
    type: 'message',
    message: {
      role: 'user',
      content: text,
    },
  };
}

function assistantMessageEntry(id: string, text: string, model = OPENAI_MODEL) {
  return {
    id,
    type: 'message',
    message: {
      role: 'assistant',
      provider: model.provider,
      model: model.id,
      content: [{ type: 'text', text }],
    },
  };
}

function assistantToolCallEntry(id: string, callId: string, toolName: string, model = OPENAI_MODEL) {
  return {
    id,
    type: 'message',
    message: {
      role: 'assistant',
      provider: model.provider,
      model: model.id,
      content: [{ type: 'toolCall', id: callId, name: toolName, arguments: {} }],
    },
  };
}

function toolResultEntry(id: string, callId: string, toolName: string, text: string) {
  return {
    id,
    type: 'message',
    message: {
      role: 'toolResult',
      toolCallId: callId,
      toolName,
      content: [{ type: 'text', text }],
    },
  };
}

function createPiHarness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    pi: {
      on: (eventName: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(eventName, handler);
      },
    },
    getHandler<T extends (...args: unknown[]) => unknown>(eventName: string): T {
      const handler = handlers.get(eventName);
      if (!handler) {
        throw new Error(`Missing handler for ${eventName}`);
      }
      return handler as T;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  compactMock.mockReset();
});

describe('openai native compaction extension', () => {
  it('builds native compact URLs and headers for OpenAI and Codex models', () => {
    expect(compactEndpointUrl(OPENAI_MODEL)).toBe('https://api.openai.com/v1/responses/compact');
    expect(compactEndpointUrl(CODEX_MODEL)).toBe('https://chatgpt.com/backend-api/codex/responses/compact');

    const openaiHeaders = buildCompactHeaders({
      model: OPENAI_MODEL,
      apiKey: 'sk-openai',
      headers: { 'x-extra': '1' },
      sessionId: 'session-openai',
    });
    expect(openaiHeaders).toEqual({
      authorization: 'Bearer sk-openai',
      session_id: 'session-openai',
      'x-extra': '1',
    });

    const token = createJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_123',
      },
    });

    expect(extractCodexAccountId(token)).toBe('acct_123');

    const codexHeaders = buildCompactHeaders({
      model: CODEX_MODEL,
      apiKey: token,
      sessionId: 'session-codex',
    });
    expect(codexHeaders.authorization).toBe(`Bearer ${token}`);
    expect(codexHeaders.session_id).toBe('session-codex');
    expect(codexHeaders['chatgpt-account-id']).toBe('acct_123');
    expect(codexHeaders.originator).toBe('pi');
    expect(codexHeaders['OpenAI-Beta']).toBe('responses=experimental');
    expect(codexHeaders['user-agent']).toContain('pi-native-compaction');
  });

  it('reconstructs the native replay history from the latest matching compaction', () => {
    const state = reconstructNativeState(
      [
        {
          id: 'compaction-1',
          type: 'compaction',
          summary: 'Portable summary',
          details: {
            nativeCompaction: {
              version: 1,
              provider: 'openai-responses-compact',
              modelKey: modelKey(OPENAI_MODEL),
              replacementHistory: [
                {
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: 'Native compacted context' }],
                },
              ],
            },
          },
        },
        userMessageEntry('user-1', 'Question after compaction'),
        assistantMessageEntry('assistant-1', 'Answer after compaction'),
        userMessageEntry('user-2', 'Current prompt'),
      ] as never[],
      OPENAI_MODEL,
    );

    expect(state?.details.modelKey).toBe(modelKey(OPENAI_MODEL));
    expect(state?.explicitHistory).toEqual([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Native compacted context' }],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Question after compaction' }],
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Answer after compaction' }],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Current prompt' }],
      },
    ]);
  });

  it('notifies by default when reusing native compacted history', () => {
    const harness = createPiHarness();
    openaiNativeCompactionExtension(harness.pi as never);

    const beforeProviderRequest =
      harness.getHandler<
        (event: { payload: Record<string, unknown> }, ctx: Record<string, unknown>) => Record<string, unknown> | undefined
      >('before_provider_request');
    const notify = vi.fn();

    const result = beforeProviderRequest(
      {
        payload: {
          model: OPENAI_MODEL.id,
          input: [
            { role: 'system', content: 'system prompt' },
            { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Current prompt' }] },
          ],
        },
      },
      {
        model: OPENAI_MODEL,
        hasUI: true,
        ui: { notify },
        sessionManager: {
          getSessionId: () => 'session-native-notice',
          getBranch: () => [
            {
              id: 'compaction-1',
              type: 'compaction',
              summary: 'Portable summary',
              details: {
                nativeCompaction: {
                  version: 1,
                  provider: 'openai-responses-compact',
                  modelKey: modelKey(OPENAI_MODEL),
                  replacementHistory: [
                    {
                      type: 'message',
                      role: 'assistant',
                      content: [{ type: 'output_text', text: 'Native compacted context' }],
                    },
                  ],
                },
              },
            },
            userMessageEntry('user-1', 'Current prompt'),
          ],
        },
      },
    );

    expect(result).toBeDefined();
    expect(notify).toHaveBeenCalledWith(`Using OpenAI compaction for ${OPENAI_MODEL.provider}/${OPENAI_MODEL.id}`, 'info');
  });

  it('does not crash if UI notifications are unavailable while reusing native history', () => {
    const harness = createPiHarness();
    openaiNativeCompactionExtension(harness.pi as never);

    const beforeProviderRequest =
      harness.getHandler<
        (event: { payload: Record<string, unknown> }, ctx: Record<string, unknown>) => Record<string, unknown> | undefined
      >('before_provider_request');

    const result = beforeProviderRequest(
      {
        payload: {
          model: OPENAI_MODEL.id,
          input: [
            { role: 'system', content: 'system prompt' },
            { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Current prompt' }] },
          ],
        },
      },
      {
        model: OPENAI_MODEL,
        hasUI: true,
        sessionManager: {
          getSessionId: () => 'session-native-no-ui',
          getBranch: () => [
            {
              id: 'compaction-1',
              type: 'compaction',
              summary: 'Portable summary',
              details: {
                nativeCompaction: {
                  version: 1,
                  provider: 'openai-responses-compact',
                  modelKey: modelKey(OPENAI_MODEL),
                  replacementHistory: [
                    {
                      type: 'message',
                      role: 'assistant',
                      content: [{ type: 'output_text', text: 'Native compacted context' }],
                    },
                  ],
                },
              },
            },
            userMessageEntry('user-1', 'Current prompt'),
          ],
        },
      },
    );

    expect(result).toBeDefined();
  });

  it('removes invalid image URLs from native replay history', () => {
    const state = reconstructNativeState(
      [
        {
          id: 'compaction-1',
          type: 'compaction',
          summary: 'Portable summary',
          details: {
            nativeCompaction: {
              version: 1,
              provider: 'openai-responses-compact',
              modelKey: modelKey(OPENAI_MODEL),
              replacementHistory: [
                {
                  type: 'message',
                  role: 'user',
                  content: [
                    { type: 'input_text', text: 'Here is the screenshot' },
                    { type: 'input_image', image_url: 'data:image/png;base64,' },
                    { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=' },
                  ],
                },
                { type: 'function_call', name: 'bash', call_id: 'call-1', arguments: '{}' },
                {
                  type: 'function_call_output',
                  call_id: 'call-1',
                  output: [
                    { type: 'input_text', text: 'cleanup ok' },
                    { type: 'input_image', image_url: 'data:image/png;base64,' },
                  ],
                },
              ],
            },
          },
        },
      ] as never[],
      OPENAI_MODEL,
    );

    expect(state?.explicitHistory).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'Here is the screenshot' },
          { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=' },
        ],
      },
      { type: 'function_call', name: 'bash', call_id: 'call-1', arguments: '{}' },
      {
        type: 'function_call_output',
        call_id: 'call-1',
        output: [{ type: 'input_text', text: 'cleanup ok' }],
      },
    ]);
  });

  it('drops orphan tool outputs when reconstructing replay history across model changes', () => {
    const state = reconstructNativeState(
      [
        {
          id: 'compaction-1',
          type: 'compaction',
          summary: 'Portable summary',
          details: {
            nativeCompaction: {
              version: 1,
              provider: 'openai-responses-compact',
              modelKey: modelKey(OPENAI_MODEL),
              replacementHistory: [
                {
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: 'Native compacted context' }],
                },
              ],
            },
          },
        },
        userMessageEntry('user-1', 'Try another model'),
        assistantToolCallEntry('assistant-1', 'call-1', 'read', OTHER_MODEL),
        toolResultEntry('tool-1', 'call-1', 'read', 'README contents'),
        userMessageEntry('user-2', 'Back on OpenAI now'),
      ] as never[],
      OPENAI_MODEL,
    );

    expect(state?.explicitHistory).toEqual([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Native compacted context' }],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Back on OpenAI now' }],
      },
    ]);
  });

  it('rewrites supported provider requests to use native replay history', () => {
    const harness = createPiHarness();
    openaiNativeCompactionExtension(harness.pi as never);

    const beforeProviderRequest =
      harness.getHandler<
        (event: { payload: Record<string, unknown> }, ctx: Record<string, unknown>) => Record<string, unknown> | undefined
      >('before_provider_request');

    const result = beforeProviderRequest(
      {
        payload: {
          model: OPENAI_MODEL.id,
          input: [
            { role: 'system', content: 'system prompt' },
            { role: 'user', content: [{ type: 'input_text', text: 'placeholder' }] },
            { role: 'developer', content: 'developer tail' },
          ],
          previous_response_id: 'resp_123',
          parallel_tool_calls: true,
        },
      },
      {
        model: OPENAI_MODEL,
        hasUI: false,
        sessionManager: {
          getSessionId: () => 'session-rewrite',
          getBranch: () => [
            {
              id: 'compaction-1',
              type: 'compaction',
              summary: 'Portable summary',
              details: {
                nativeCompaction: {
                  version: 1,
                  provider: 'openai-responses-compact',
                  modelKey: modelKey(OPENAI_MODEL),
                  replacementHistory: [
                    {
                      type: 'message',
                      role: 'assistant',
                      content: [{ type: 'output_text', text: 'Native compacted context' }],
                    },
                  ],
                },
              },
            },
            userMessageEntry('user-1', 'Prompt after compaction'),
          ],
        },
      },
    );

    expect(result).toEqual({
      model: OPENAI_MODEL.id,
      input: [
        { role: 'system', content: 'system prompt' },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Native compacted context' }],
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Prompt after compaction' }],
        },
        { role: 'developer', content: 'developer tail' },
      ],
      parallel_tool_calls: true,
    });
  });

  it('stores native compaction output alongside the normal portable summary', async () => {
    const harness = createPiHarness();
    openaiNativeCompactionExtension(harness.pi as never);

    const beforeProviderRequest =
      harness.getHandler<
        (event: { payload: Record<string, unknown> }, ctx: Record<string, unknown>) => Record<string, unknown> | undefined
      >('before_provider_request');
    const beforeCompact =
      harness.getHandler<(event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>>('session_before_compact');

    beforeProviderRequest(
      {
        payload: {
          model: OPENAI_MODEL.id,
          input: [
            { role: 'system', content: 'system prompt' },
            {
              role: 'user',
              content: [{ type: 'input_text', text: 'placeholder' }],
            },
          ],
          tools: [{ type: 'function', name: 'bash' }],
          parallel_tool_calls: true,
          reasoning: { effort: 'medium' },
          text: { format: { type: 'text' } },
        },
      },
      {
        model: OPENAI_MODEL,
        hasUI: false,
        sessionManager: {
          getSessionId: () => 'session-compact-success',
          getBranch: () => [userMessageEntry('user-1', 'Prompt after compaction')],
        },
      },
    );

    compactMock.mockResolvedValue({
      summary: 'Portable summary',
      firstKeptEntryId: 'user-1',
      tokensBefore: 321,
      details: { local: true },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Native replacement history' }],
          },
        ],
        usage: { total_tokens: 12 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const abortController = new AbortController();
    const result = (await beforeCompact(
      {
        branchEntries: [userMessageEntry('user-1', 'Prompt after compaction')],
        preparation: {
          firstKeptEntryId: 'user-1',
          tokensBefore: 321,
        },
        customInstructions: 'keep open questions',
        signal: abortController.signal,
      },
      {
        model: OPENAI_MODEL,
        hasUI: false,
        ui: { notify: vi.fn() },
        getSystemPrompt: () => 'System instructions',
        sessionManager: {
          getSessionId: () => 'session-compact-success',
        },
        modelRegistry: {
          getApiKeyAndHeaders: vi.fn().mockResolvedValue({
            ok: true,
            apiKey: 'sk-openai',
            headers: { 'x-extra': '1' },
          }),
        },
      },
    )) as {
      compaction: {
        summary: string;
        firstKeptEntryId: string;
        tokensBefore: number;
        details: Record<string, unknown>;
      };
    };

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses/compact',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer sk-openai',
          session_id: 'session-compact-success',
          'x-extra': '1',
        }),
      }),
    );

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody).toEqual({
      model: OPENAI_MODEL.id,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Prompt after compaction' }],
        },
      ],
      instructions: 'System instructions',
      tools: [{ type: 'function', name: 'bash' }],
      parallel_tool_calls: true,
      reasoning: { effort: 'medium' },
      text: { format: { type: 'text' } },
    });

    expect(result).toEqual({
      compaction: {
        summary: 'Portable summary',
        firstKeptEntryId: 'user-1',
        tokensBefore: 321,
        details: {
          localCompaction: { local: true },
          nativeCompaction: {
            version: 1,
            provider: 'openai-responses-compact',
            modelKey: modelKey(OPENAI_MODEL),
            replacementHistory: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Native replacement history' }],
              },
            ],
            usage: { total_tokens: 12 },
          },
        },
      },
    });
  });

  it('omits empty image attachments from native compaction input', async () => {
    const harness = createPiHarness();
    openaiNativeCompactionExtension(harness.pi as never);

    const beforeCompact =
      harness.getHandler<(event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>>('session_before_compact');

    compactMock.mockResolvedValue({
      summary: 'Portable summary',
      firstKeptEntryId: 'user-1',
      tokensBefore: 321,
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Native replacement history' }],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await beforeCompact(
      {
        branchEntries: [
          {
            id: 'assistant-1',
            type: 'message',
            message: {
              role: 'assistant',
              provider: OPENAI_MODEL.provider,
              model: OPENAI_MODEL.id,
              content: [{ type: 'toolCall', id: 'call-1', name: 'bash', arguments: {} }],
            },
          },
          {
            id: 'tool-1',
            type: 'message',
            message: {
              role: 'toolResult',
              toolCallId: 'call-1',
              toolName: 'bash',
              content: [
                { type: 'text', text: 'cleanup ok' },
                { type: 'image', mimeType: 'image/png', data: '' },
                { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' },
              ],
            },
          },
        ],
        preparation: {
          firstKeptEntryId: 'user-1',
          tokensBefore: 321,
        },
        signal: new AbortController().signal,
      },
      {
        model: OPENAI_MODEL,
        hasUI: false,
        ui: { notify: vi.fn() },
        getSystemPrompt: () => 'System instructions',
        sessionManager: {
          getSessionId: () => 'session-compact-images',
        },
        modelRegistry: {
          getApiKeyAndHeaders: vi.fn().mockResolvedValue({
            ok: true,
            apiKey: 'sk-openai',
          }),
        },
      },
    );

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.input).toEqual([
      { type: 'function_call', name: 'bash', call_id: 'call-1', arguments: '{}' },
      {
        type: 'function_call_output',
        call_id: 'call-1',
        output: [
          { type: 'input_text', text: 'cleanup ok' },
          { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=' },
        ],
      },
    ]);
  });

  it('falls back to the normal Pi compaction when the native request fails', async () => {
    const harness = createPiHarness();
    openaiNativeCompactionExtension(harness.pi as never);

    const beforeCompact =
      harness.getHandler<(event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>>('session_before_compact');

    compactMock.mockResolvedValue({
      summary: 'Portable summary',
      firstKeptEntryId: 'user-1',
      tokensBefore: 321,
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'boom',
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await beforeCompact(
      {
        branchEntries: [userMessageEntry('user-1', 'Prompt after compaction')],
        preparation: {
          firstKeptEntryId: 'user-1',
          tokensBefore: 321,
        },
        signal: new AbortController().signal,
      },
      {
        model: OPENAI_MODEL,
        hasUI: false,
        ui: { notify: vi.fn() },
        getSystemPrompt: () => 'System instructions',
        sessionManager: {
          getSessionId: () => 'session-compact-fallback',
        },
        modelRegistry: {
          getApiKeyAndHeaders: vi.fn().mockResolvedValue({
            ok: true,
            apiKey: 'sk-openai',
          }),
        },
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      compaction: {
        summary: 'Portable summary',
        firstKeptEntryId: 'user-1',
        tokensBefore: 321,
      },
    });
  });
});
