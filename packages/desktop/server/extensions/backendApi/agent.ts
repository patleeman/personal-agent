import { join } from 'node:path';

import { getPiAgentRuntimeDir } from '@personal-agent/core';

interface ImageInput {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface ExtensionAgentRunTaskInput {
  cwd?: string;
  modelRef?: string;
  prompt: string;
  images?: ImageInput[];
  tools?: 'none';
  timeoutMs?: number;
}

export interface ExtensionAgentRunTaskResult {
  text: string;
  model?: string;
  provider?: string;
}

interface ExtensionBackendContextLike {
  toolContext?: { cwd?: string };
  agentToolContext?: unknown;
}

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveAgentToolContext(ctx: ExtensionBackendContextLike): Record<string, unknown> {
  const raw = ctx.agentToolContext;
  const candidate = isRecord(raw) && isRecord(raw.toolContext) ? raw.toolContext : raw;
  if (!isRecord(candidate)) throw new Error('Agent task requires an active agent tool context.');
  return candidate;
}

function modelAcceptsImages(model: unknown): boolean {
  const input = (model as { input?: unknown } | undefined)?.input;
  return Array.isArray(input) && input.includes('image');
}

function resolveModel(models: unknown[], modelRef: string): unknown | null {
  const normalized = modelRef.trim();
  if (!normalized) return null;
  const slashIndex = normalized.indexOf('/');
  if (slashIndex > 0 && slashIndex < normalized.length - 1) {
    const provider = normalized.slice(0, slashIndex);
    const id = normalized.slice(slashIndex + 1);
    return models.find((model) => (model as { provider?: unknown }).provider === provider && (model as { id?: unknown }).id === id) ?? null;
  }
  return models.find((model) => (model as { id?: unknown }).id === normalized) ?? null;
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (isRecord(part) && part.type === 'text') return typeof part.text === 'string' ? part.text : '';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function collectAssistantTexts(session: { messages?: unknown[] }): string[] {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return messages
    .filter((message) => isRecord(message) && message.role === 'assistant')
    .map((message) => extractTextContent((message as { content?: unknown }).content).trim())
    .filter(Boolean);
}

function getAssistantErrorMessage(session: { messages?: unknown[] }): string | null {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== 'assistant') continue;
    if (typeof message.errorMessage === 'string' && message.errorMessage.trim()) return message.errorMessage.trim();
  }
  return null;
}

export async function runAgentTask(
  input: ExtensionAgentRunTaskInput,
  ctx: ExtensionBackendContextLike,
): Promise<ExtensionAgentRunTaskResult> {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) throw new Error('Agent task prompt is required.');
  if (input.tools && input.tools !== 'none') throw new Error('Extension agent tasks currently support tools="none" only.');

  const agentCtx = resolveAgentToolContext(ctx);
  const modelRegistry = agentCtx.modelRegistry as { getAvailable(): unknown[] } | undefined;
  if (!modelRegistry) throw new Error('Agent task requires a model registry in the active agent context.');
  const model = input.modelRef ? resolveModel(modelRegistry.getAvailable(), input.modelRef) : agentCtx.model;
  if (!model) throw new Error(`Agent task model is not available: ${input.modelRef ?? '(current)'}`);
  if ((input.images?.length ?? 0) > 0 && !modelAcceptsImages(model))
    throw new Error(`Agent task model does not accept images: ${input.modelRef ?? '(current)'}`);

  const pi = await dynamicImport<typeof import('@earendil-works/pi-coding-agent')>('@earendil-works/pi-coding-agent');
  const assistantTexts: string[] = [];
  let session: Awaited<ReturnType<typeof pi.createAgentSession>>['session'] | null = null;
  let unsubscribe: (() => void) | null = null;
  try {
    session = (
      await pi.createAgentSession({
        cwd: input.cwd ?? ctx.toolContext?.cwd ?? (typeof agentCtx.cwd === 'string' ? agentCtx.cwd : process.cwd()),
        model: model as never,
        authStorage: pi.AuthStorage.create(join(getPiAgentRuntimeDir(), 'auth.json')),
        modelRegistry: modelRegistry as never,
        sessionManager: pi.SessionManager.inMemory(input.cwd ?? ctx.toolContext?.cwd ?? process.cwd()),
        noTools: 'all',
      })
    ).session;
    unsubscribe = session.subscribe((event) => {
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const text = extractTextContent(event.message.content).trim();
        if (text) assistantTexts.push(text);
      }
    });
    await session.prompt(prompt, input.images?.length ? { images: input.images } : undefined);
    const assistantError = getAssistantErrorMessage(session);
    if (assistantError) throw new Error(assistantError);
    if (assistantTexts.length === 0) assistantTexts.push(...collectAssistantTexts(session));
  } finally {
    unsubscribe?.();
    session?.dispose();
  }

  return {
    text: assistantTexts.at(-1)?.trim() || '',
    model: (model as { id?: string }).id,
    provider: (model as { provider?: string }).provider,
  };
}
