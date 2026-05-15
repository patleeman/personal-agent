import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { buildSessionContextForRuntimeMock } = vi.hoisted(() => ({
  buildSessionContextForRuntimeMock: vi.fn((entries: SessionEntry[]) => ({
    messages: entries.flatMap((entry) => (entry.type === 'message' && entry.message ? [entry.message] : [])),
  })),
}));

vi.mock('@personal-agent/extensions/backend/runtime', () => ({
  buildSessionContextForRuntime: buildSessionContextForRuntimeMock,
}));

import {
  createImageAgentExtension,
  parseImageGenerationSse,
} from '../../../../experimental-extensions/extensions/system-images/src/imageTool.js';

function createJwtWithAccountId(accountId: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }),
    'signature',
  ].join('.');
}

function createModel(input: Partial<Model<Api>> & Pick<Model<Api>, 'id' | 'provider' | 'api'>): Model<Api> {
  return {
    id: input.id,
    name: input.name ?? input.id,
    provider: input.provider,
    api: input.api,
    baseUrl: input.baseUrl ?? '',
    reasoning: input.reasoning ?? true,
    input: input.input ?? ['text', 'image'],
    cost: input.cost ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: input.contextWindow ?? 128_000,
    maxTokens: input.maxTokens ?? 128_000,
  } as Model<Api>;
}

function registerImageTool() {
  let registeredTool:
    | {
        name: string;
        execute: (...args: unknown[]) => Promise<{
          content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
          details?: Record<string, unknown>;
        }>;
        promptGuidelines?: string[];
      }
    | undefined;

  createImageAgentExtension()({
    registerTool: (tool: unknown) => {
      registeredTool = tool as typeof registeredTool;
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Image tool was not registered.');
  }

  return registeredTool;
}

function buildSessionEntries(messages: AgentMessage[]): SessionEntry[] {
  return messages.map((message, index) => ({
    type: 'message' as const,
    id: `msg-${index + 1}`,
    parentId: index === 0 ? null : `msg-${index}`,
    timestamp: new Date(Date.UTC(2026, 3, 22, 12, 0, index)).toISOString(),
    message,
  }));
}

function createToolContext(
  options: {
    currentModel?: Model<Api>;
    models?: Model<Api>[];
    authByProvider?: Record<string, { apiKey?: string; headers?: Record<string, string> }>;
    sessionMessages?: AgentMessage[];
  } = {},
) {
  const models = options.models ?? [];
  const authByProvider = options.authByProvider ?? {};
  const sessionEntries = buildSessionEntries(options.sessionMessages ?? []);

  return {
    cwd: '/tmp/workspace',
    hasUI: false,
    isIdle: () => true,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => '',
    model: options.currentModel,
    modelRegistry: {
      find: (provider: string, modelId: string) => models.find((model) => model.provider === provider && model.id === modelId),
      getApiKeyAndHeaders: async (model: Model<Api>) => {
        const auth = authByProvider[model.provider];
        if (!auth?.apiKey) {
          return { ok: false as const, error: `No API key for ${model.provider}` };
        }

        return {
          ok: true as const,
          apiKey: auth.apiKey,
          headers: auth.headers,
        };
      },
    },
    sessionManager: {
      getSessionId: () => 'conv-123',
      getEntries: () => sessionEntries,
      getLeafId: () => sessionEntries.at(-1)?.id ?? null,
    },
    ui: {},
  };
}

function createSuccessfulImageResponse(
  options: {
    text?: string;
    outputFormat?: string;
    quality?: string;
    background?: string;
    responseId?: string;
  } = {},
) {
  return new Response(
    [
      'event: response.output_item.done',
      `data: ${JSON.stringify({
        item: {
          type: 'image_generation_call',
          result: 'ZmFrZS1pbWFnZQ==',
          output_format: options.outputFormat ?? 'png',
          quality: options.quality ?? 'low',
          background: options.background ?? 'opaque',
        },
      })}`,
      '',
      'event: response.output_text.done',
      `data: ${JSON.stringify({ text: options.text ?? 'Generated image.' })}`,
      '',
      'event: response.completed',
      `data: ${JSON.stringify({ response: { id: options.responseId ?? 'resp_image' } })}`,
      '',
    ].join('\n'),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  buildSessionContextForRuntimeMock.mockClear();
  vi.unstubAllGlobals();
});

describe('image agent extension', () => {
  it('parses image-generation SSE output', () => {
    const parsed = parseImageGenerationSse(
      [
        'event: response.output_item.done',
        'data: {"item":{"type":"image_generation_call","result":"ZmFrZS1pbWFnZQ==","output_format":"png","quality":"medium","background":"opaque"}}',
        '',
        'event: response.output_text.done',
        'data: {"text":"Here you go."}',
        '',
        'event: response.completed',
        'data: {"response":{"id":"resp_123"}}',
        '',
      ].join('\n'),
    );

    expect(parsed).toEqual({
      assistantText: 'Here you go.',
      imageBase64: 'ZmFrZS1pbWFnZQ==',
      outputFormat: 'png',
      quality: 'medium',
      background: 'opaque',
      responseId: 'resp_123',
    });
  });

  it('rejects malformed image-generation SSE image data', () => {
    expect(() =>
      parseImageGenerationSse(
        [
          'event: response.output_item.done',
          'data: {"item":{"type":"image_generation_call","result":"not-valid-base64!","output_format":"png"}}',
          '',
          'event: response.completed',
          'data: {"response":{"id":"resp_123"}}',
          '',
        ].join('\n'),
      ),
    ).toThrow('Image generation returned malformed image data.');
  });

  it('executes without a session manager when no reference image context is available', async () => {
    const imageTool = registerImageTool();
    const codexModel = createModel({
      id: 'gpt-5.4',
      provider: 'openai-codex',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
    });
    const token = createJwtWithAccountId('acct-123');
    const fetchMock = vi.fn().mockResolvedValue(createSuccessfulImageResponse());
    vi.stubGlobal('fetch', fetchMock);

    const ctx = createToolContext({
      currentModel: codexModel,
      models: [codexModel],
      authByProvider: {
        'openai-codex': { apiKey: token },
      },
    }) as Record<string, unknown>;
    delete ctx.sessionManager;

    const result = await imageTool.execute('tool-no-session-manager', { prompt: 'A tiny orange robot waving.' }, undefined, undefined, ctx);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as { input: Array<{ content: Array<{ type: string }> }> };
    expect(JSON.stringify(body)).not.toContain('input_image');
    expect(result.details?.source).toBe('none');
    expect(result.details?.sourceImageCount).toBe(0);
  });

  it('executes against the codex responses backend and returns an inline image', async () => {
    const imageTool = registerImageTool();
    const codexModel = createModel({
      id: 'gpt-5.4',
      provider: 'openai-codex',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
    });
    const token = createJwtWithAccountId('acct-123');
    const fetchMock = vi.fn().mockResolvedValue(createSuccessfulImageResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await imageTool.execute(
      'tool-1',
      {
        prompt: 'A tiny orange robot waving.',
      },
      undefined,
      undefined,
      createToolContext({
        currentModel: codexModel,
        models: [codexModel],
        authByProvider: {
          'openai-codex': { apiKey: token },
        },
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(request.method).toBe('POST');
    const headers = new Headers(request.headers as HeadersInit);
    expect(headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(headers.get('chatgpt-account-id')).toBe('acct-123');
    expect(headers.get('openai-beta')).toBe('responses=experimental');

    const body = JSON.parse(String(request.body)) as {
      model: string;
      tools: Array<{ type: string }>;
      input: Array<{ content: Array<{ type: string; text?: string }> }>;
    };
    expect(body.model).toBe('gpt-5.4');
    expect(body.tools).toEqual([{ type: 'image_generation' }]);
    expect(body.input[0]?.content).toEqual([{ type: 'input_text', text: 'A tiny orange robot waving.' }]);

    expect(result.content).toEqual([
      { type: 'text', text: 'Generated image.' },
      { type: 'image', data: 'ZmFrZS1pbWFnZQ==', mimeType: 'image/png' },
    ]);
    expect(result.details).toMatchObject({
      provider: 'openai-codex',
      model: 'gpt-5.4',
      responseId: 'resp_image',
      outputFormat: 'png',
      quality: 'low',
      background: 'opaque',
      size: 'auto',
      action: 'auto',
      source: 'none',
      sourceImageCount: 0,
    });
  });

  it('infers latest-user edit mode from an attached-image prompt', async () => {
    const imageTool = registerImageTool();
    const codexModel = createModel({
      id: 'gpt-5.4',
      provider: 'openai-codex',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
    });
    const token = createJwtWithAccountId('acct-123');
    const fetchMock = vi.fn().mockResolvedValue(createSuccessfulImageResponse({ text: 'Edited image.' }));
    vi.stubGlobal('fetch', fetchMock);

    await imageTool.execute(
      'tool-1',
      {
        prompt: 'Turn this attached photo into a flat sticker illustration.',
      },
      undefined,
      undefined,
      createToolContext({
        currentModel: codexModel,
        models: [codexModel],
        authByProvider: {
          'openai-codex': { apiKey: token },
        },
        sessionMessages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Please edit this image.' },
              { type: 'image', data: 'dXNlci1pbWFnZQ==', mimeType: 'image/png' },
            ],
            timestamp: Date.now(),
          },
        ],
      }),
    );

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      tools: Array<{ type: string; action?: string }>;
      input: Array<{ content: Array<{ type: string; image_url?: string; text?: string }> }>;
    };

    expect(body.tools).toEqual([{ type: 'image_generation', action: 'edit' }]);
    expect(body.input[0]?.content[0]).toMatchObject({
      type: 'input_image',
      image_url: 'data:image/png;base64,dXNlci1pbWFnZQ==',
    });
    expect(body.input[0]?.content[1]).toEqual({
      type: 'input_text',
      text: 'Turn this attached photo into a flat sticker illustration.',
    });
  });

  it('skips non-image source blocks when editing from conversation context', async () => {
    const imageTool = registerImageTool();
    const codexModel = createModel({
      id: 'gpt-5.4',
      provider: 'openai-codex',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
    });
    const token = createJwtWithAccountId('acct-123');
    const fetchMock = vi.fn().mockResolvedValue(createSuccessfulImageResponse({ text: 'Edited image.' }));
    vi.stubGlobal('fetch', fetchMock);

    await imageTool.execute(
      'tool-1',
      {
        prompt: 'Turn the attached photo into a flat sticker illustration.',
        source: 'latest-user',
      },
      undefined,
      undefined,
      createToolContext({
        currentModel: codexModel,
        models: [codexModel],
        authByProvider: {
          'openai-codex': { apiKey: token },
        },
        sessionMessages: [
          {
            role: 'user',
            content: [
              { type: 'image', data: 'bm90LWltYWdl', mimeType: 'text/plain' },
              { type: 'image', data: 'dXNlci1pbWFnZQ==', mimeType: 'image/png' },
            ],
            timestamp: Date.now(),
          },
        ],
      }),
    );

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      input: Array<{ content: Array<{ type: string; image_url?: string; text?: string }> }>;
    };

    expect(body.input[0]?.content.filter((part) => part.type === 'input_image')).toEqual([
      expect.objectContaining({ image_url: 'data:image/png;base64,dXNlci1pbWFnZQ==' }),
    ]);
  });

  it('skips malformed image source data when editing from conversation context', async () => {
    const imageTool = registerImageTool();
    const codexModel = createModel({
      id: 'gpt-5.4',
      provider: 'openai-codex',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
    });
    const token = createJwtWithAccountId('acct-123');
    const fetchMock = vi.fn().mockResolvedValue(createSuccessfulImageResponse({ text: 'Edited image.' }));
    vi.stubGlobal('fetch', fetchMock);

    await imageTool.execute(
      'tool-1',
      {
        prompt: 'Turn the attached photo into a flat sticker illustration.',
        source: 'latest-user',
      },
      undefined,
      undefined,
      createToolContext({
        currentModel: codexModel,
        models: [codexModel],
        authByProvider: {
          'openai-codex': { apiKey: token },
        },
        sessionMessages: [
          {
            role: 'user',
            content: [
              { type: 'image', data: 'not-valid-base64!', mimeType: 'image/png' },
              { type: 'image', data: 'dXNlci1pbWFnZQ==', mimeType: 'image/png' },
            ],
            timestamp: Date.now(),
          },
        ],
      }),
    );

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      input: Array<{ content: Array<{ type: string; image_url?: string; text?: string }> }>;
    };

    expect(body.input[0]?.content.filter((part) => part.type === 'input_image')).toEqual([
      expect.objectContaining({ image_url: 'data:image/png;base64,dXNlci1pbWFnZQ==' }),
    ]);
  });

  it('ignores fractional recent source counts instead of flooring them', async () => {
    const imageTool = registerImageTool();
    const codexModel = createModel({
      id: 'gpt-5.4',
      provider: 'openai-codex',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
    });
    const token = createJwtWithAccountId('acct-123');
    const fetchMock = vi.fn().mockResolvedValue(createSuccessfulImageResponse({ text: 'Edited image.' }));
    vi.stubGlobal('fetch', fetchMock);

    await imageTool.execute(
      'tool-1',
      {
        prompt: 'Use recent images as reference.',
        source: 'recent',
        sourceCount: 2.5,
      },
      undefined,
      undefined,
      createToolContext({
        currentModel: codexModel,
        models: [codexModel],
        authByProvider: {
          'openai-codex': { apiKey: token },
        },
        sessionMessages: [
          { role: 'user', content: [{ type: 'image', data: 'aW1hZ2UtMQ==', mimeType: 'image/png' }], timestamp: Date.now() },
          { role: 'user', content: [{ type: 'image', data: 'aW1hZ2UtMg==', mimeType: 'image/png' }], timestamp: Date.now() },
          { role: 'user', content: [{ type: 'image', data: 'aW1hZ2UtMw==', mimeType: 'image/png' }], timestamp: Date.now() },
        ],
      }),
    );

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      input: Array<{ content: Array<{ type: string; image_url?: string; text?: string }> }>;
    };

    expect(body.input[0]?.content.filter((part) => part.type === 'input_image')).toEqual([
      expect.objectContaining({ image_url: 'data:image/png;base64,aW1hZ2UtMw==' }),
    ]);
  });

  it('ignores unsafe recent source counts instead of clamping them', async () => {
    const imageTool = registerImageTool();
    const codexModel = createModel({
      id: 'gpt-5.4',
      provider: 'openai-codex',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
    });
    const token = createJwtWithAccountId('acct-123');
    const fetchMock = vi.fn().mockResolvedValue(createSuccessfulImageResponse({ text: 'Edited image.' }));
    vi.stubGlobal('fetch', fetchMock);

    await imageTool.execute(
      'tool-1',
      {
        prompt: 'Use recent images as reference.',
        source: 'recent',
        sourceCount: Number.MAX_SAFE_INTEGER + 1,
      },
      undefined,
      undefined,
      createToolContext({
        currentModel: codexModel,
        models: [codexModel],
        authByProvider: {
          'openai-codex': { apiKey: token },
        },
        sessionMessages: [
          { role: 'user', content: [{ type: 'image', data: 'aW1hZ2UtMQ==', mimeType: 'image/png' }], timestamp: Date.now() },
          { role: 'user', content: [{ type: 'image', data: 'aW1hZ2UtMg==', mimeType: 'image/png' }], timestamp: Date.now() },
          { role: 'user', content: [{ type: 'image', data: 'aW1hZ2UtMw==', mimeType: 'image/png' }], timestamp: Date.now() },
        ],
      }),
    );

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      input: Array<{ content: Array<{ type: string; image_url?: string; text?: string }> }>;
    };

    expect(body.input[0]?.content.filter((part) => part.type === 'input_image')).toEqual([
      expect.objectContaining({ image_url: 'data:image/png;base64,aW1hZ2UtMw==' }),
    ]);
  });

  it('infers latest-generated edit mode from a last-generated variant prompt', async () => {
    const imageTool = registerImageTool();
    const codexModel = createModel({
      id: 'gpt-5.4',
      provider: 'openai-codex',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
    });
    const token = createJwtWithAccountId('acct-123');
    const fetchMock = vi.fn().mockResolvedValue(createSuccessfulImageResponse({ text: 'Generated variant.' }));
    vi.stubGlobal('fetch', fetchMock);

    await imageTool.execute(
      'tool-1',
      {
        prompt: 'Make a darker variant of the last generated icon.',
      },
      undefined,
      undefined,
      createToolContext({
        currentModel: codexModel,
        models: [codexModel],
        authByProvider: {
          'openai-codex': { apiKey: token },
        },
        sessionMessages: [
          {
            role: 'toolResult',
            toolCallId: 'call-1',
            toolName: 'image',
            content: [
              { type: 'text', text: 'Generated image.' },
              { type: 'image', data: 'Z2VuZXJhdGVkLWltYWdl', mimeType: 'image/png' },
            ],
            details: { provider: 'openai-codex' },
            isError: false,
            timestamp: Date.now(),
          },
        ],
      }),
    );

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      input: Array<{ content: Array<{ type: string; image_url?: string; text?: string }> }>;
    };

    expect(body.input[0]?.content[0]).toMatchObject({
      type: 'input_image',
      image_url: 'data:image/png;base64,Z2VuZXJhdGVkLWltYWdl',
    });
    expect(body.input[0]?.content[1]).toEqual({
      type: 'input_text',
      text: 'Make a darker variant of the last generated icon.',
    });
  });

  it('falls back to an OpenAI image-generation-capable Responses model', async () => {
    const imageTool = registerImageTool();
    const openAiModel = createModel({
      id: 'gpt-4.1',
      provider: 'openai',
      api: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
    });
    const fetchMock = vi.fn().mockResolvedValue(createSuccessfulImageResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await imageTool.execute(
      'tool-1',
      { prompt: 'Draw a compact product settings screen.' },
      undefined,
      undefined,
      createToolContext({
        models: [openAiModel],
        authByProvider: {
          openai: { apiKey: 'openai-key' },
        },
      }),
    );

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(request.body)) as { model: string; tools: Array<{ type: string }> };
    expect(body.model).toBe('gpt-4.1');
    expect(body.tools).toEqual([{ type: 'image_generation' }]);
    expect(result.details).toMatchObject({ provider: 'openai', model: 'gpt-4.1' });
  });

  it('fails clearly when no compatible auth is configured', async () => {
    const imageTool = registerImageTool();
    const anthropicModel = createModel({
      id: 'claude-sonnet-4-6',
      provider: 'anthropic',
      api: 'anthropic-messages',
      input: ['text'],
      reasoning: false,
    });

    await expect(
      imageTool.execute(
        'tool-1',
        { prompt: 'A skyline at dusk.' },
        undefined,
        undefined,
        createToolContext({
          currentModel: anthropicModel,
          models: [anthropicModel],
        }),
      ),
    ).rejects.toThrow('Image generation requires configured openai-codex or openai auth with an image-generation-capable Responses model.');
  });
});
