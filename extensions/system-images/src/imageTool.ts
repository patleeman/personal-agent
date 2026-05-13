import { arch, platform } from 'node:os';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, ImageContent, Model } from '@earendil-works/pi-ai';
import { buildSessionContext, type ExtensionAPI, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';

const IMAGE_QUALITY_VALUES = ['auto', 'low', 'medium', 'high'] as const;
const IMAGE_BACKGROUND_VALUES = ['auto', 'opaque', 'transparent'] as const;
const IMAGE_ACTION_VALUES = ['auto', 'generate', 'edit'] as const;
const IMAGE_SOURCE_VALUES = ['none', 'latest', 'latest-user', 'latest-generated', 'recent'] as const;
const MAX_SOURCE_IMAGE_COUNT = 4;

type ImageQuality = (typeof IMAGE_QUALITY_VALUES)[number];
type ImageBackground = (typeof IMAGE_BACKGROUND_VALUES)[number];
type ImageAction = (typeof IMAGE_ACTION_VALUES)[number];
type ImageSource = (typeof IMAGE_SOURCE_VALUES)[number];

type ImageGenerationTarget = {
  model: Model<Api>;
  endpoint: string;
  headers: Record<string, string>;
};

type ImageReferenceGroup = {
  kind: 'user' | 'generated';
  images: ImageContent[];
};

type ResolvedSourceImages = {
  images: ImageContent[];
  label: string;
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
  action: Type.Optional(Type.Union(IMAGE_ACTION_VALUES.map((value) => Type.Literal(value)))),
  source: Type.Optional(Type.Union(IMAGE_SOURCE_VALUES.map((value) => Type.Literal(value)))),
  sourceCount: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: MAX_SOURCE_IMAGE_COUNT,
      description: 'How many recent source images to include when source=recent. Max 4.',
    }),
  ),
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

  return (
    (model.api === 'openai-codex-responses' || model.api === 'openai-responses') &&
    /^(?:gpt-4o(?:$|[.-])|gpt-4\.1(?:$|[.-])|o3(?:$|[.-])|gpt-5(?:$|[.-]))/.test(model.id)
  );
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

function buildHeaders(input: { model: Model<Api>; apiKey: string; headers?: Record<string, string> }): Record<string, string> {
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
    getApiKeyAndHeaders(
      model: Model<Api>,
    ): Promise<{ ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string }>;
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

  pushCandidate(ctx.modelRegistry.find('openai-codex', 'gpt-5.5'));
  pushCandidate(ctx.modelRegistry.find('openai-codex', 'gpt-5.4'));
  pushCandidate(ctx.modelRegistry.find('openai-codex', 'gpt-5.4-mini'));
  pushCandidate(ctx.modelRegistry.find('openai-codex', 'gpt-5.4-nano'));
  pushCandidate(ctx.modelRegistry.find('openai-codex', 'gpt-5.2'));
  pushCandidate(ctx.modelRegistry.find('openai-codex', 'gpt-5'));
  pushCandidate(ctx.modelRegistry.find('openai', 'gpt-5.5'));
  pushCandidate(ctx.modelRegistry.find('openai', 'gpt-5.4'));
  pushCandidate(ctx.modelRegistry.find('openai', 'gpt-5.4-mini'));
  pushCandidate(ctx.modelRegistry.find('openai', 'gpt-5.4-nano'));
  pushCandidate(ctx.modelRegistry.find('openai', 'gpt-5.2'));
  pushCandidate(ctx.modelRegistry.find('openai', 'gpt-5'));
  pushCandidate(ctx.modelRegistry.find('openai', 'gpt-4.1'));
  pushCandidate(ctx.modelRegistry.find('openai', 'gpt-4o'));
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
      endpoint:
        candidate.api === 'openai-codex-responses'
          ? resolveCodexResponsesEndpoint(candidate.baseUrl)
          : resolveOpenAIResponsesEndpoint(candidate.baseUrl),
      headers: buildHeaders({
        model: candidate,
        apiKey: auth.apiKey,
        headers: auth.headers,
      }),
    };
  }

  throw new Error('Image generation requires configured openai-codex or openai auth with an image-generation-capable Responses model.');
}

function readImageBlocks(content: unknown): ImageContent[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((block) => {
    if (!block || typeof block !== 'object') {
      return [];
    }

    const candidate = block as Partial<ImageContent> & { type?: unknown };
    if (candidate.type !== 'image' || typeof candidate.data !== 'string' || typeof candidate.mimeType !== 'string') {
      return [];
    }

    const data = candidate.data.trim();
    const mimeType = candidate.mimeType.trim().toLowerCase();
    if (!data || !mimeType.startsWith('image/') || !isValidImageSourceBase64(data)) {
      return [];
    }

    return [
      {
        type: 'image' as const,
        data,
        mimeType,
      } satisfies ImageContent,
    ];
  });
}

function isValidImageSourceBase64(value: string): boolean {
  if (value.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }
  return Buffer.from(value, 'base64').length > 0;
}

function collectImageReferenceGroups(messages: AgentMessage[]): ImageReferenceGroup[] {
  const groups: ImageReferenceGroup[] = [];

  for (const message of messages) {
    if (!message || typeof message !== 'object' || !('role' in message)) {
      continue;
    }

    const role = (message as { role?: unknown }).role;
    if (role === 'user') {
      const images = readImageBlocks((message as { content?: unknown }).content);
      if (images.length > 0) {
        groups.push({ kind: 'user', images });
      }
      continue;
    }

    if (role === 'toolResult') {
      const toolName =
        typeof (message as { toolName?: unknown }).toolName === 'string' ? (message as { toolName: string }).toolName.trim() : '';
      if (toolName !== 'image') {
        continue;
      }

      const images = readImageBlocks((message as { content?: unknown }).content);
      if (images.length > 0) {
        groups.push({ kind: 'generated', images });
      }
    }
  }

  return groups;
}

function readSessionContextMessages(sessionManager?: {
  getEntries?: () => SessionEntry[];
  getLeafId?: () => string | null;
}): AgentMessage[] {
  if (!sessionManager?.getEntries) {
    return [];
  }

  return buildSessionContext(sessionManager.getEntries(), sessionManager.getLeafId?.() ?? null).messages;
}

function findLastGroup(groups: ImageReferenceGroup[], kind?: ImageReferenceGroup['kind']): ImageReferenceGroup | undefined {
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (!group) {
      continue;
    }

    if (!kind || group.kind === kind) {
      return group;
    }
  }

  return undefined;
}

function inferSourceFromPrompt(prompt: string, groups: ImageReferenceGroup[]): ImageSource {
  const normalized = prompt.toLowerCase();
  const hasGenerated = Boolean(findLastGroup(groups, 'generated'));
  const hasUser = Boolean(findLastGroup(groups, 'user'));

  if (
    hasGenerated &&
    /(last generated|previously generated|variant of the last|last image you made|last icon you made|previous icon|previous image)/.test(
      normalized,
    )
  ) {
    return 'latest-generated';
  }

  if (
    hasUser &&
    /(attached image|attached photo|uploaded image|uploaded photo|this attached|this image|this photo|this screenshot)/.test(normalized)
  ) {
    return 'latest-user';
  }

  if (
    /(variant|variation|edit|modify|darker|lighter|same composition|same icon|same image|based on the image|based on the photo)/.test(
      normalized,
    )
  ) {
    if (hasGenerated && !hasUser) {
      return 'latest-generated';
    }
    if (hasUser && !hasGenerated) {
      return 'latest-user';
    }
  }

  return 'none';
}

function inferActionFromPrompt(prompt: string, hasSourceImages: boolean): ImageAction | undefined {
  if (!hasSourceImages) {
    return undefined;
  }

  const normalized = prompt.toLowerCase();
  return /(variant|variation|edit|modify|darker|lighter|change|adjust|same composition|same icon|same image|turn this)/.test(normalized)
    ? 'edit'
    : undefined;
}

function resolveSourceImages(input: {
  prompt: string;
  messages: AgentMessage[];
  source?: ImageSource;
  sourceCount?: number;
}): ResolvedSourceImages {
  const groups = collectImageReferenceGroups(input.messages);
  const source = input.source ?? inferSourceFromPrompt(input.prompt, groups);

  switch (source) {
    case 'none':
      return { images: [], label: 'none' };

    case 'latest': {
      const group = findLastGroup(groups);
      if (!group) {
        throw new Error('No prior or attached images are available in the current conversation context.');
      }

      return {
        images: group.images,
        label: group.kind === 'generated' ? 'latest-generated' : 'latest-user',
      };
    }

    case 'latest-user': {
      const group = findLastGroup(groups, 'user');
      if (!group) {
        throw new Error('No attached user images are available in the current conversation context.');
      }

      return {
        images: group.images,
        label: 'latest-user',
      };
    }

    case 'latest-generated': {
      const group = findLastGroup(groups, 'generated');
      if (!group) {
        throw new Error('No previously generated images are available in the current conversation context.');
      }

      return {
        images: group.images,
        label: 'latest-generated',
      };
    }

    case 'recent': {
      const images = groups.flatMap((group) => group.images);
      if (images.length === 0) {
        throw new Error('No prior or attached images are available in the current conversation context.');
      }

      const sourceCount =
        typeof input.sourceCount === 'number' && Number.isSafeInteger(input.sourceCount) && input.sourceCount > 0
          ? Math.min(MAX_SOURCE_IMAGE_COUNT, input.sourceCount)
          : 1;
      return {
        images: images.slice(-sourceCount),
        label: `recent:${sourceCount}`,
      };
    }

    default:
      return { images: [], label: 'none' };
  }
}

function buildImageGenerationPayload(input: {
  model: Model<Api>;
  prompt: string;
  sourceImages: ImageContent[];
  size?: string;
  quality?: ImageQuality;
  background?: ImageBackground;
  action?: ImageAction;
}) {
  const content: Array<{ type: 'input_image'; detail: 'auto'; image_url: string } | { type: 'input_text'; text: string }> =
    input.sourceImages.map((image) => ({
      type: 'input_image' as const,
      detail: 'auto' as const,
      image_url: `data:${image.mimeType};base64,${image.data}`,
    }));
  content.push({
    type: 'input_text' as const,
    text: input.prompt,
  });

  return {
    model: input.model.id,
    store: false,
    stream: true,
    instructions:
      'Use the image generation tool to create exactly one image that satisfies the user request. Keep any text response very short and only use it for refusals or notable limitations.',
    input: [
      {
        role: 'user',
        content,
      },
    ],
    text: {
      verbosity: 'low',
    },
    tool_choice: 'auto',
    parallel_tool_calls: false,
    tools: [
      {
        type: 'image_generation',
        ...(input.size ? { size: input.size } : {}),
        ...(input.quality ? { quality: input.quality } : {}),
        ...(input.background ? { background: input.background } : {}),
        ...(input.action ? { action: input.action } : {}),
      },
    ],
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
      response?: { id?: string; error?: { message?: string } };
      message?: string;
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

    if (
      event.event === 'response.output_item.done' &&
      record.item?.type === 'image_generation_call' &&
      typeof record.item.result === 'string' &&
      record.item.result.trim()
    ) {
      imageBase64 = record.item.result.trim();
      outputFormat =
        typeof record.item.output_format === 'string' && record.item.output_format.trim() ? record.item.output_format.trim() : outputFormat;
      quality = typeof record.item.quality === 'string' && record.item.quality.trim() ? record.item.quality.trim() : quality;
      background = typeof record.item.background === 'string' && record.item.background.trim() ? record.item.background.trim() : background;
    }
  }

  if (!imageBase64) {
    throw new Error('Image generation completed without returning an image.');
  }
  if (!isValidImageSourceBase64(imageBase64)) {
    throw new Error('Image generation returned malformed image data.');
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
  action?: ImageAction;
  source?: ImageSource;
  sourceCount?: number;
  signal?: AbortSignal;
  ctx: {
    model?: Model<Api>;
    modelRegistry: {
      find(provider: string, modelId: string): Model<Api> | undefined;
      getApiKeyAndHeaders(
        model: Model<Api>,
      ): Promise<{ ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string }>;
    };
    sessionManager?: {
      getEntries?: () => SessionEntry[];
      getLeafId?: () => string | null;
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
  sourceLabel: string;
  sourceImageCount: number;
  action?: ImageAction;
}> {
  const sessionMessages = readSessionContextMessages(input.ctx.sessionManager);
  const sourceSelection = resolveSourceImages({
    prompt: input.prompt,
    messages: sessionMessages,
    source: input.source,
    sourceCount: input.sourceCount,
  });
  const action = input.action ?? inferActionFromPrompt(input.prompt, sourceSelection.images.length > 0);
  const target = await resolveImageGenerationTarget(input.ctx);
  const payload = buildImageGenerationPayload({
    model: target.model,
    prompt: input.prompt,
    sourceImages: sourceSelection.images,
    ...(input.size ? { size: input.size } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    ...(input.background ? { background: input.background } : {}),
    ...(action ? { action } : {}),
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
    sourceLabel: sourceSelection.label,
    sourceImageCount: sourceSelection.images.length,
    ...(action ? { action } : {}),
  };
}

export function createImageAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'image',
      label: 'Image',
      description:
        'Generate or edit a single image from a prompt, optionally using recent attached or previously generated conversation images as references.',
      promptSnippet:
        'Generate or edit a single image from a prompt, optionally using recent attached or previously generated conversation images as references.',
      promptGuidelines: [
        'Use this tool when the user explicitly asks for an image, icon, illustration, mockup, variation, or other visual output.',
        'Keep prompts concrete and self-contained: subject, framing, style, palette, and any required text should be spelled out.',
        'For edits or variations of attached images, set source=latest-user. For edits or variations of a previously generated image, set source=latest-generated. Use source=latest when “the last image” is enough, and source=recent when multiple recent images should be considered together.',
        'Use action=edit for direct edits/variations and action=generate when a reference image should only guide a fresh output. Leave action unset or auto when the choice is obvious from the prompt.',
        'This tool currently returns one image per call. If the user wants several options, call it multiple times with distinct prompts.',
        'Prefer artifact/diagram tools for structured documents, diagrams, or UI reports; use image when the user wants pixels.',
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
          ...(params.action ? { action: params.action as ImageAction } : {}),
          ...(params.source ? { source: params.source as ImageSource } : {}),
          ...(typeof params.sourceCount === 'number' ? { sourceCount: params.sourceCount } : {}),
          signal,
          ctx,
        });

        const summary =
          result.assistantText ||
          (result.sourceImageCount > 0
            ? `Generated image with ${result.model.provider}/${result.model.id} using ${result.sourceImageCount} reference image${
                result.sourceImageCount === 1 ? '' : 's'
              }.`
            : `Generated image with ${result.model.provider}/${result.model.id}.`);

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
            action: result.action ?? params.action ?? 'auto',
            source: result.sourceLabel,
            sourceImageCount: result.sourceImageCount,
          },
        };
      },
    });
  };
}
