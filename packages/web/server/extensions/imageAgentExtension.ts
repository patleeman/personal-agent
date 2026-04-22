import { arch, platform } from 'node:os';
import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import type { Api, Model } from '@mariozechner/pi-ai';

const IMAGE_QUALITY_VALUES = ['auto', 'low', 'medium', 'high'] as const;
const IMAGE_BACKGROUND_VALUES = ['auto', 'opaque', 'transparent'] as const;

type ImageQuality = (typeof IMAGE_QUALITY_VALUES)[number];
type ImageBackground = (typeof IMAGE_BACKGROUND_VALUES)[number];

type ImageGenerationTarget = {
  model: Model<Api>;
  endpoint: string;
  headers: Record<string, string>;
};

export interface ParsedImageGenerationSse {
  assistantText: string;
  imageBase64: string;
  outputFormat: string;
  quality?: string;
  background?: string;
  responseId?: string;
}

const ImageToolParams = Type.Object({
  prompt: Type.String({ description: 'Image prompt. Be concrete about subject, composition, style, and any required text.' }),
  size: Type.Optional(Type.String({ description: 'Optional size hint such as auto, 1024x1024, 1024x1536, or 1536x1024.' })),
  quality: Type.Optional(Type.Union(IMAGE_QUALITY_VALUES.map((value) => Type.Literal(value)))),
  background: Type.Optional(Type.Union(IMAGE_BACKGROUND_VALUES.map((value) => Type.Literal(value)))),
});

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function readOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function supportsImageGeneration(model: Model<Api> | undefined): model is Model<Api> {
  if (!model) {
    return false;
  }

  return (model.api === 'openai-codex-responses' || model.api === 'openai-responses')
    && /^gpt-5(?:$|[.-])/.test(model.id);
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveCodexResponsesEndpoint(baseUrl: string | undefined): string {
  const normalized = trimTrailingSlashes(baseUrl?.trim() || 'https://chatgpt.com/backend-api');
  if (normalized.endsWith('/codex/responses')) return normalized;
  if (normalized.endsWith('/codex')) return `${normalized}/responses`;
  return `${normalized}/codex/responses`;
}

function resolveOpenAIResponsesEndpoint(baseUrl: string | undefined): string {
  const normalized = trimTrailingSlashes(baseUrl?.trim() || 'https://api.openai.com/v1');
  if (normalized.endsWith('/responses')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/responses`;
  return `${normalized}/v1/responses`;
}

function extractCodexAccountId(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      ['https://api.openai.com/auth']?: { chatgpt_account_id?: string };
    };
    const accountId = payload['https://api.openai.com/auth']?.chatgpt_account_id;
    return typeof accountId === 'string' && accountId.trim().length > 0 ? accountId.trim() : undefined;
  } catch {
    return undefined;
  }
}

function buildHeaders(input: {
  model: Model<Api>;
  apiKey: string;
  headers?: Record<string, string>;
}): Record<string, string> {
  const headers = new Headers(input.headers ?? {});
  headers.set('Authorization', `Bearer ${input.apiKey}`);
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'text/event-stream');

  if (input.model.api === 'openai-codex-responses') {
    const accountId = extractCodexAccountId(input.apiKey);
    if (accountId) {
      headers.set('chatgpt-account-id', accountId);
    }
    headers.set('originator', 'pi');
    headers.set('user-agent', `personal-agent/image-tool (${platform()}; ${arch()})`);
    headers.set('OpenAI-Beta', 'responses=experimental');
  }

  return Object.fromEntries(headers.entries());
}

async function resolveImageGenerationTarget(ctx: {
  model?: Model<Api>;
  modelRegistry: {
    find(provider: string, modelId: string): Model<Api> | undefined;
    getApiKeyAndHeaders(model: Model<Api>): Promise<{ ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string }>;
  };
}): Promise<ImageGenerationTarget> {
  const candidates: Model<Api>[] = [];
  const seen = new Set<string>();

  const pushCandidate = (candidate: Model<Api> | undefined) => {
    if (!candidate) {
      return;
    }

    const key = `${candidate.provider}:${candidate.id}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push(candidate);
  };

  if (supportsImageGeneration(ctx.model)) {
    pushCandidate(ctx.model);
  }

  pushCandidate(ctx.modelRegistry.find('openai-codex', 'gpt-5.4'));
  pushCandidate(ctx.modelRegistry.find('openai-codex', 'gpt-5.4-mini'));
  pushCandidate(ctx.modelRegistry.find('openai-codex', 'gpt-5.2'));
  pushCandidate(ctx.modelRegistry.find('openai', 'gpt-5.4'));
  pushCandidate(ctx.modelRegistry.find('openai', 'gpt-5.2'));
  pushCandidate(ctx.modelRegistry.find('openai', 'gpt-5.1-codex-mini'));

  for (const candidate of candidates) {
    if (!supportsImageGeneration(candidate)) {
      continue;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(candidate);
    if (!auth.ok || !auth.apiKey) {
      continue;
    }

    return {
      model: candidate,
      endpoint: candidate.api === 'openai-codex-responses'
        ? resolveCodexResponsesEndpoint(candidate.baseUrl)
        : resolveOpenAIResponsesEndpoint(candidate.baseUrl),
      headers: buildHeaders({
        model: candidate,
        apiKey: auth.apiKey,
        headers: auth.headers,
      }),
    };
  }

  throw new Error('Image generation requires configured openai-codex or openai auth with a GPT-5 model.');
}

function buildImageGenerationPayload(input: {
  model: Model<Api>;
  prompt: string;
  size?: string;
  quality?: ImageQuality;
  background?: ImageBackground;
}) {
  return {
    model: input.model.id,
    store: false,
    stream: true,
    instructions: 'Use the image generation tool to create exactly one image that satisfies the user request. Keep any text response very short and only use it for refusals or notable limitations.',
    input: [{
      role: 'user',
      content: [{
        type: 'input_text',
        text: input.prompt,
      }],
    }],
    text: {
      verbosity: 'low',
    },
    tool_choice: 'auto',
    parallel_tool_calls: false,
    tools: [{
      type: 'image_generation',
      ...(input.size ? { size: input.size } : {}),
      ...(input.quality ? { quality: input.quality } : {}),
      ...(input.background ? { background: input.background } : {}),
    }],
  };
}

function parseErrorResponse(status: number, body: string): Error {
  const trimmed = body.trim();
  if (!trimmed) {
    return new Error(`Image generation failed with status ${status}.`);
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      detail?: string;
      error?: { message?: string };
      message?: string;
    };
    const message = parsed.error?.message ?? parsed.detail ?? parsed.message;
    if (typeof message === 'string' && message.trim()) {
      return new Error(message.trim());
    }
  } catch {
    // Ignore parse failures and fall back to raw body.
  }

  return new Error(trimmed);
}

function flushSseEvent(events: Array<{ event: string; data: string }>, event: string, dataLines: string[]): void {
  if (!event || dataLines.length === 0) {
    return;
  }

  events.push({
    event,
    data: dataLines.join('\n'),
  });
}

export function parseImageGenerationSse(raw: string): ParsedImageGenerationSse {
  const events: Array<{ event: string; data: string }> = [];
  let currentEvent = '';
  let dataLines: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      flushSseEvent(events, currentEvent, dataLines);
      currentEvent = '';
      dataLines = [];
      continue;
    }

    if (line.startsWith('event:')) {
      currentEvent = line.slice('event:'.length).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  flushSseEvent(events, currentEvent, dataLines);

  const assistantTextParts: string[] = [];
  let imageBase64 = '';
  let outputFormat = 'png';
  let quality: string | undefined;
  let background: string | undefined;
  let responseId: string | undefined;

  for (const event of events) {
    if (event.data === '[DONE]') {
      break;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(event.data) as unknown;
    } catch {
      continue;
    }

    if (!payload || typeof payload !== 'object') {
      continue;
    }

    const record = payload as {
      error?: { message?: string };
      message?: string;
      response?: { id?: string; error?: { message?: string } };
      text?: string;
      item?: {
        type?: string;
        result?: string;
        output_format?: string;
        quality?: string;
        background?: string;
      };
    };

    responseId = responseId ?? record.response?.id;

    if (event.event === 'error') {
      throw new Error(record.message?.trim() || 'Image generation failed.');
    }

    if (event.event === 'response.failed') {
      throw new Error(record.response?.error?.message?.trim() || 'Image generation failed.');
    }

    if (event.event === 'response.output_text.done' && typeof record.text === 'string' && record.text.trim()) {
      assistantTextParts.push(record.text.trim());
      continue;
    }

    if (event.event === 'response.output_item.done' && record.item?.type === 'image_generation_call' && typeof record.item.result === 'string' && record.item.result.trim()) {
      imageBase64 = record.item.result.trim();
      outputFormat = typeof record.item.output_format === 'string' && record.item.output_format.trim()
        ? record.item.output_format.trim()
        : outputFormat;
      quality = typeof record.item.quality === 'string' && record.item.quality.trim()
        ? record.item.quality.trim()
        : quality;
      background = typeof record.item.background === 'string' && record.item.background.trim()
        ? record.item.background.trim()
        : background;
    }
  }

  if (!imageBase64) {
    throw new Error('Image generation completed without returning an image.');
  }

  return {
    assistantText: assistantTextParts.join('\n\n').trim(),
    imageBase64,
    outputFormat,
    ...(quality ? { quality } : {}),
    ...(background ? { background } : {}),
    ...(responseId ? { responseId } : {}),
  };
}

function mimeTypeFromOutputFormat(outputFormat: string): string {
  switch (outputFormat.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}

async function generateImage(input: {
  prompt: string;
  size?: string;
  quality?: ImageQuality;
  background?: ImageBackground;
  signal?: AbortSignal;
  ctx: {
    model?: Model<Api>;
    modelRegistry: {
      find(provider: string, modelId: string): Model<Api> | undefined;
      getApiKeyAndHeaders(model: Model<Api>): Promise<{ ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string }>;
    };
  };
}): Promise<{
  assistantText: string;
  imageBase64: string;
  mimeType: string;
  model: Model<Api>;
  responseId?: string;
  outputFormat: string;
  quality?: string;
  background?: string;
}> {
  const target = await resolveImageGenerationTarget(input.ctx);
  const payload = buildImageGenerationPayload({
    model: target.model,
    prompt: input.prompt,
    ...(input.size ? { size: input.size } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    ...(input.background ? { background: input.background } : {}),
  });

  const response = await fetch(target.endpoint, {
    method: 'POST',
    headers: target.headers,
    body: JSON.stringify(payload),
    signal: input.signal,
  });
  const body = await response.text();

  if (!response.ok) {
    throw parseErrorResponse(response.status, body);
  }

  const parsed = parseImageGenerationSse(body);
  return {
    assistantText: parsed.assistantText,
    imageBase64: parsed.imageBase64,
    mimeType: mimeTypeFromOutputFormat(parsed.outputFormat),
    model: target.model,
    ...(parsed.responseId ? { responseId: parsed.responseId } : {}),
    outputFormat: parsed.outputFormat,
    ...(parsed.quality ? { quality: parsed.quality } : {}),
    ...(parsed.background ? { background: parsed.background } : {}),
  };
}

export function createImageAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'image',
      label: 'Image',
      description: 'Generate a single image from a prompt and return it inline in the conversation.',
      promptSnippet: 'Generate a single image from a prompt and return it inline in the conversation.',
      promptGuidelines: [
        'Use this tool when the user explicitly asks for an image, icon, illustration, mockup, or other visual output.',
        'Keep prompts concrete and self-contained: subject, framing, style, palette, and any required text should be spelled out.',
        'Prefer artifact/diagram tools for structured documents, diagrams, or UI reports; use image when the user wants pixels.',
        'This tool currently generates one image per call. If the user wants several options, call it multiple times with distinct prompts.',
        'This tool is generation-first. Do not assume it can faithfully edit an attached image unless the user only needs a fresh variant described in text.',
      ],
      parameters: ImageToolParams,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const prompt = readRequiredString(params.prompt, 'prompt');
        const size = readOptionalString(params.size);
        const result = await generateImage({
          prompt,
          ...(size ? { size } : {}),
          ...(params.quality ? { quality: params.quality as ImageQuality } : {}),
          ...(params.background ? { background: params.background as ImageBackground } : {}),
          signal,
          ctx,
        });

        const summary = result.assistantText
          || `Generated image with ${result.model.provider}/${result.model.id}.`;

        return {
          content: [
            { type: 'text' as const, text: summary },
            { type: 'image' as const, data: result.imageBase64, mimeType: result.mimeType },
          ],
          details: {
            provider: result.model.provider,
            model: result.model.id,
            responseId: result.responseId,
            outputFormat: result.outputFormat,
            quality: result.quality ?? params.quality ?? 'auto',
            background: result.background ?? params.background ?? 'auto',
            size: size ?? 'auto',
          },
        };
      },
    });
  };
}
