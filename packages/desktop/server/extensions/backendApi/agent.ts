import { randomUUID } from 'node:crypto';
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
  tools?: 'none' | 'default';
  timeoutMs?: number;
}

export interface ExtensionAgentRunTaskResult {
  text: string;
  model?: string;
  provider?: string;
}

export interface ExtensionAgentConversationCreateInput {
  title?: string;
  cwd?: string;
  modelRef?: string;
  tools?: 'none' | 'default';
  visibility?: 'hidden';
  persistence?: 'ephemeral';
}

export interface ExtensionAgentConversationSendInput {
  conversationId: string;
  text: string;
  images?: ImageInput[];
  timeoutMs?: number;
}

export interface ExtensionAgentConversationSummary {
  id: string;
  ownerExtensionId: string;
  title: string;
  cwd: string;
  model?: string;
  provider?: string;
  visibility: 'hidden';
  persistence: 'ephemeral';
  tools: 'none' | 'default';
  createdAt: string;
  updatedAt: string;
  isBusy: boolean;
  disposed: boolean;
  messageCount: number;
  lastText?: string;
}

export interface ExtensionAgentConversationMessageResult extends ExtensionAgentConversationSummary {
  text: string;
}

interface ExtensionBackendContextLike {
  extensionId?: string;
  toolContext?: { cwd?: string };
  agentToolContext?: unknown;
}

type PiModule = typeof import('@earendil-works/pi-coding-agent');
type AgentSessionLike = Awaited<ReturnType<PiModule['createAgentSession']>>['session'] & {
  abort?: () => Promise<void> | void;
  messages?: unknown[];
};

interface ExtensionAgentConversationRecord {
  id: string;
  ownerExtensionId: string;
  title: string;
  cwd: string;
  model: unknown;
  modelRegistry: unknown;
  tools: 'none' | 'default';
  visibility: 'hidden';
  persistence: 'ephemeral';
  createdAt: string;
  updatedAt: string;
  session: AgentSessionLike;
  unsubscribe: () => void;
  isBusy: boolean;
  disposed: boolean;
  assistantTexts: string[];
  pendingAbort?: AbortController;
}

const conversations = new Map<string, ExtensionAgentConversationRecord>();
const defaultDynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
let dynamicImport = defaultDynamicImport;

export function setExtensionAgentDynamicImportForTests(importer: typeof dynamicImport): void {
  dynamicImport = importer;
}

export function resetExtensionAgentDynamicImportForTests(): void {
  dynamicImport = defaultDynamicImport;
  for (const conversation of conversations.values()) disposeRecord(conversation);
  conversations.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownerExtensionId(ctx: ExtensionBackendContextLike): string {
  if (!ctx.extensionId) throw new Error('Extension agent conversations require an extension id.');
  return ctx.extensionId;
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

async function assertPermission(ctx: ExtensionBackendContextLike, permission: 'agent:run' | 'agent:conversations'): Promise<void> {
  if (!ctx.extensionId) return;
  const registry = await dynamicImport<typeof import('../extensionRegistry.js')>('../extensionRegistry.js');
  const entry = registry.findExtensionEntry(ctx.extensionId);
  const permissions = entry?.manifest.permissions ?? [];
  if (!permissions.includes(permission))
    throw new Error(`Extension "${ctx.extensionId}" requires permission ${permission} to use agent conversations.`);
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

async function runWithTimeout<T>(operation: Promise<T>, timeoutMs: number | undefined, onTimeout: () => void): Promise<T> {
  if (timeoutMs === undefined) return operation;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Agent task timeoutMs must be a positive integer.');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          onTimeout();
          reject(new Error(`Agent task timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function validateConversationMode(input: ExtensionAgentConversationCreateInput): void {
  if (input.visibility && input.visibility !== 'hidden')
    throw new Error('Extension agent conversations currently support visibility="hidden" only.');
  if (input.persistence && input.persistence !== 'ephemeral')
    throw new Error('Extension agent conversations currently support persistence="ephemeral" only.');
  if (input.tools && input.tools !== 'none' && input.tools !== 'default')
    throw new Error('Extension agent conversations support tools="none" or tools="default".');
}

async function createSession(input: ExtensionAgentConversationCreateInput, ctx: ExtensionBackendContextLike) {
  validateConversationMode(input);
  const agentCtx = resolveAgentToolContext(ctx);
  const modelRegistry = agentCtx.modelRegistry as { getAvailable(): unknown[] } | undefined;
  if (!modelRegistry) throw new Error('Agent conversation requires a model registry in the active agent context.');
  const model = input.modelRef ? resolveModel(modelRegistry.getAvailable(), input.modelRef) : agentCtx.model;
  if (!model) throw new Error(`Agent conversation model is not available: ${input.modelRef ?? '(current)'}`);
  const cwd = input.cwd ?? ctx.toolContext?.cwd ?? (typeof agentCtx.cwd === 'string' ? agentCtx.cwd : process.cwd());
  const pi = await dynamicImport<PiModule>('@earendil-works/pi-coding-agent');
  const { session } = await pi.createAgentSession({
    cwd,
    model: model as never,
    authStorage: pi.AuthStorage.create(join(getPiAgentRuntimeDir(), 'auth.json')),
    modelRegistry: modelRegistry as never,
    sessionManager: pi.SessionManager.inMemory(cwd),
    ...(input.tools === 'none' ? { noTools: 'all' as const } : {}),
  });
  return { cwd, model, modelRegistry, session: session as AgentSessionLike };
}

function summarize(record: ExtensionAgentConversationRecord): ExtensionAgentConversationSummary {
  const fallbackTexts = record.assistantTexts.length > 0 ? record.assistantTexts : collectAssistantTexts(record.session);
  const lastText = fallbackTexts.at(-1)?.trim();
  return {
    id: record.id,
    ownerExtensionId: record.ownerExtensionId,
    title: record.title,
    cwd: record.cwd,
    model: (record.model as { id?: string }).id,
    provider: (record.model as { provider?: string }).provider,
    visibility: record.visibility,
    persistence: record.persistence,
    tools: record.tools,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    isBusy: record.isBusy,
    disposed: record.disposed,
    messageCount: Array.isArray(record.session.messages) ? record.session.messages.length : 0,
    ...(lastText ? { lastText } : {}),
  };
}

function getOwnedRecord(conversationId: string, ctx: ExtensionBackendContextLike): ExtensionAgentConversationRecord {
  const record = conversations.get(conversationId);
  if (!record || record.disposed) throw new Error(`Agent conversation not found: ${conversationId}`);
  if (record.ownerExtensionId !== ownerExtensionId(ctx)) throw new Error(`Agent conversation not found: ${conversationId}`);
  return record;
}

function disposeRecord(record: ExtensionAgentConversationRecord): void {
  if (record.disposed) return;
  record.disposed = true;
  record.isBusy = false;
  record.pendingAbort?.abort();
  record.unsubscribe();
  record.session.dispose();
}

export async function createAgentConversation(
  input: ExtensionAgentConversationCreateInput,
  ctx: ExtensionBackendContextLike,
): Promise<ExtensionAgentConversationSummary> {
  await assertPermission(ctx, 'agent:conversations');
  const owner = ownerExtensionId(ctx);
  const created = await createSession(input, ctx);
  const id = `agent_${randomUUID()}`;
  const now = new Date().toISOString();
  const record: ExtensionAgentConversationRecord = {
    id,
    ownerExtensionId: owner,
    title: input.title?.trim() || 'Extension agent conversation',
    cwd: created.cwd,
    model: created.model,
    modelRegistry: created.modelRegistry,
    tools: input.tools ?? 'default',
    visibility: 'hidden',
    persistence: 'ephemeral',
    createdAt: now,
    updatedAt: now,
    session: created.session,
    unsubscribe: () => undefined,
    isBusy: false,
    disposed: false,
    assistantTexts: [],
  };
  record.unsubscribe = created.session.subscribe((event) => {
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const text = extractTextContent(event.message.content).trim();
      if (text) record.assistantTexts.push(text);
    }
  });
  conversations.set(id, record);
  return summarize(record);
}

export async function sendAgentMessage(
  input: ExtensionAgentConversationSendInput,
  ctx: ExtensionBackendContextLike,
): Promise<ExtensionAgentConversationMessageResult> {
  await assertPermission(ctx, 'agent:conversations');
  const record = getOwnedRecord(input.conversationId, ctx);
  if (record.isBusy) throw new Error(`Agent conversation is already busy: ${input.conversationId}`);
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) throw new Error('Agent conversation message text is required.');
  if ((input.images?.length ?? 0) > 0 && !modelAcceptsImages(record.model))
    throw new Error(`Agent conversation model does not accept images: ${record.id}`);
  record.isBusy = true;
  const startIndex = record.assistantTexts.length;
  try {
    await runWithTimeout(record.session.prompt(text, input.images?.length ? { images: input.images } : undefined), input.timeoutMs, () => {
      record.pendingAbort?.abort();
      void record.session.abort?.();
    });
    const assistantError = getAssistantErrorMessage(record.session);
    if (assistantError) throw new Error(assistantError);
    if (record.assistantTexts.length === startIndex) record.assistantTexts.push(...collectAssistantTexts(record.session).slice(startIndex));
    record.updatedAt = new Date().toISOString();
    return { ...summarize(record), text: record.assistantTexts.at(-1)?.trim() || '' };
  } finally {
    record.isBusy = false;
  }
}

export async function getAgentConversation(input: { conversationId: string }, ctx: ExtensionBackendContextLike) {
  await assertPermission(ctx, 'agent:conversations');
  return summarize(getOwnedRecord(input.conversationId, ctx));
}

export async function listAgentConversations(_input: unknown, ctx: ExtensionBackendContextLike) {
  await assertPermission(ctx, 'agent:conversations');
  const owner = ownerExtensionId(ctx);
  return Array.from(conversations.values())
    .filter((record) => record.ownerExtensionId === owner && !record.disposed)
    .map(summarize);
}

export async function abortAgentConversation(input: { conversationId: string }, ctx: ExtensionBackendContextLike) {
  await assertPermission(ctx, 'agent:conversations');
  const record = getOwnedRecord(input.conversationId, ctx);
  await record.session.abort?.();
  record.isBusy = false;
  record.updatedAt = new Date().toISOString();
  return summarize(record);
}

export async function disposeAgentConversation(input: { conversationId: string }, ctx: ExtensionBackendContextLike) {
  await assertPermission(ctx, 'agent:conversations');
  const record = getOwnedRecord(input.conversationId, ctx);
  disposeRecord(record);
  conversations.delete(record.id);
  return { ok: true, conversationId: record.id };
}

export async function runAgentTask(
  input: ExtensionAgentRunTaskInput,
  ctx: ExtensionBackendContextLike,
): Promise<ExtensionAgentRunTaskResult> {
  await assertPermission(ctx, 'agent:run');
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) throw new Error('Agent task prompt is required.');
  if (input.tools && input.tools !== 'none' && input.tools !== 'default')
    throw new Error('Extension agent tasks support tools="none" or tools="default".');
  const created = await createSession({ ...input, title: 'Extension agent task', visibility: 'hidden', persistence: 'ephemeral' }, ctx);
  const now = new Date().toISOString();
  const record: ExtensionAgentConversationRecord = {
    id: `agent_${randomUUID()}`,
    ownerExtensionId: ctx.extensionId ?? 'extension-agent-task',
    title: 'Extension agent task',
    cwd: created.cwd,
    model: created.model,
    modelRegistry: created.modelRegistry,
    tools: input.tools ?? 'default',
    visibility: 'hidden',
    persistence: 'ephemeral',
    createdAt: now,
    updatedAt: now,
    session: created.session,
    unsubscribe: () => undefined,
    isBusy: false,
    disposed: false,
    assistantTexts: [],
  };
  record.unsubscribe = created.session.subscribe((event) => {
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const text = extractTextContent(event.message.content).trim();
      if (text) record.assistantTexts.push(text);
    }
  });
  try {
    if ((input.images?.length ?? 0) > 0 && !modelAcceptsImages(record.model)) {
      throw new Error(`Agent task model does not accept images: ${input.modelRef ?? '(current)'}`);
    }
    await runWithTimeout(
      record.session.prompt(prompt, input.images?.length ? { images: input.images } : undefined),
      input.timeoutMs,
      () => {
        void record.session.abort?.();
        record.session.dispose();
      },
    );
    const assistantError = getAssistantErrorMessage(record.session);
    if (assistantError) throw new Error(assistantError);
    if (record.assistantTexts.length === 0) record.assistantTexts.push(...collectAssistantTexts(record.session));
    return {
      text: record.assistantTexts.at(-1)?.trim() || '',
      model: (record.model as { id?: string }).id,
      provider: (record.model as { provider?: string }).provider,
    };
  } finally {
    disposeRecord(record);
  }
}
