import { existsSync, readFileSync } from 'node:fs';
import { completeSimple, type Api, type Model, type ThinkingLevel } from '@mariozechner/pi-ai';
import { requirePromptCatalogEntry } from '@personal-agent/core';

const DEFAULT_PROVIDER = 'openai-codex';
const DEFAULT_MODEL = 'gpt-5.4-mini';
const DEFAULT_REASONING: ThinkingLevel = 'minimal';
const DEFAULT_MAX_MESSAGES = 8;
const DEFAULT_MAX_TITLE_LENGTH = 80;
const DEFAULT_MAX_MESSAGE_LENGTH = 1_200;

export interface ConversationAutoTitleSettings {
  enabled: boolean;
  provider: string;
  model: string;
  reasoning: ThinkingLevel;
  maxMessages: number;
  maxTitleLength: number;
}

export interface ConversationTitleSourceMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ConversationTitleMessageInput {
  role?: string;
  content?: unknown;
}

export interface ConversationTitleModelRegistry {
  getAvailable(): Model<Api>[];
  getApiKeyAndHeaders(model: Model<Api>): Promise<
    | { ok: true; apiKey?: string; headers?: Record<string, string> }
    | { ok: false; error: string }
  >;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readSettingsObject(settingsFile: string): Record<string, unknown> {
  if (!existsSync(settingsFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8')) as unknown;
    return isRecord(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function normalizeThinkingLevel(value: unknown): ThinkingLevel {
  switch (value) {
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value;
    default:
      return DEFAULT_REASONING;
  }
}

function readUiSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return isRecord(settings.ui) ? { ...settings.ui } : {};
}

function readConversationTitleSettingsObject(settings: Record<string, unknown>): Record<string, unknown> {
  const ui = readUiSettings(settings);
  return isRecord(ui.conversationTitles) ? { ...ui.conversationTitles } : {};
}

export function readConversationAutoTitleSettings(settingsFile: string): ConversationAutoTitleSettings {
  const settings = readSettingsObject(settingsFile);
  const conversationTitles = readConversationTitleSettingsObject(settings);
  const configuredModel = readNonEmptyString(conversationTitles.model);
  const slashMatches = configuredModel.match(/\//g) ?? [];
  const slashIndex = configuredModel.indexOf('/');
  const providerFromModel = slashMatches.length === 1 && slashIndex > 0 && slashIndex < configuredModel.length - 1
    ? configuredModel.slice(0, slashIndex)
    : '';
  const modelId = providerFromModel ? configuredModel.slice(slashIndex + 1) : configuredModel;
  const explicitProvider = readNonEmptyString(conversationTitles.provider) || providerFromModel;
  const hasExplicitModel = modelId.length > 0;

  return {
    enabled: readBoolean(conversationTitles.enabled, true),
    provider: hasExplicitModel ? (explicitProvider || DEFAULT_PROVIDER) : DEFAULT_PROVIDER,
    model: hasExplicitModel ? modelId : DEFAULT_MODEL,
    reasoning: normalizeThinkingLevel(conversationTitles.reasoning),
    maxMessages: readPositiveInteger(conversationTitles.maxMessages, DEFAULT_MAX_MESSAGES),
    maxTitleLength: readPositiveInteger(conversationTitles.maxTitleLength, DEFAULT_MAX_TITLE_LENGTH),
  };
}

function normalizeContent(content: unknown): Array<{ type?: string; text?: string; data?: unknown; mimeType?: unknown }> {
  if (Array.isArray(content)) {
    return content as Array<{ type?: string; text?: string; data?: unknown; mimeType?: unknown }>;
  }

  if (typeof content === 'string' && content.length > 0) {
    return [{ type: 'text', text: content }];
  }

  return [];
}

function hasValidImageContentBlock(block: { data?: unknown; mimeType?: unknown }): boolean {
  if (typeof block.mimeType !== 'string' || !block.mimeType.trim().toLowerCase().startsWith('image/')) {
    return false;
  }

  if (typeof block.data !== 'string') {
    return false;
  }

  const data = block.data.trim();
  if (!data || data.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return false;
  }

  return Buffer.from(data, 'base64').length > 0;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateText(text: string, maxLength: number): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const slice = normalized.slice(0, maxLength).trim();
  const lastSpace = slice.lastIndexOf(' ');
  return lastSpace > Math.floor(maxLength / 2) ? slice.slice(0, lastSpace).trim() : slice;
}

function summarizeUserMessage(content: unknown): string {
  const blocks = normalizeContent(content);
  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
  const imageCount = blocks.filter((block) => block.type === 'image' && hasValidImageContentBlock(block)).length;

  const attachmentLabel = imageCount === 1
    ? '(image attachment)'
    : imageCount > 1
      ? `(${imageCount} image attachments)`
      : '';

  if (text && attachmentLabel) {
    return normalizeWhitespace(`${text} ${attachmentLabel}`);
  }

  if (text) {
    return normalizeWhitespace(text);
  }

  return attachmentLabel;
}

function summarizeAssistantMessage(content: unknown): string {
  const blocks = normalizeContent(content);
  return normalizeWhitespace(blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n'));
}

export function collectConversationTitleSourceMessages(
  messages: ConversationTitleMessageInput[],
  maxMessages = DEFAULT_MAX_MESSAGES,
): ConversationTitleSourceMessage[] {
  const messageLimit = Number.isSafeInteger(maxMessages) && maxMessages > 0
    ? maxMessages
    : DEFAULT_MAX_MESSAGES;
  const collected: ConversationTitleSourceMessage[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      const text = summarizeUserMessage(message.content);
      if (text) {
        collected.push({ role: 'user', text });
      }
      continue;
    }

    if (message.role === 'assistant') {
      const text = summarizeAssistantMessage(message.content);
      if (text) {
        collected.push({ role: 'assistant', text });
      }
    }
  }

  if (messageLimit > 0 && collected.length > messageLimit) {
    return collected.slice(-messageLimit);
  }

  return collected;
}

export function hasAssistantTitleSourceMessage(messages: ConversationTitleMessageInput[]): boolean {
  return collectConversationTitleSourceMessages(messages).some((message) => message.role === 'assistant');
}

export function buildConversationTitleTranscript(
  messages: ConversationTitleMessageInput[],
  options: { maxMessages?: number; maxMessageLength?: number } = {},
): string {
  const sourceMessages = collectConversationTitleSourceMessages(messages, options.maxMessages ?? DEFAULT_MAX_MESSAGES);
  if (!sourceMessages.some((message) => message.role === 'user') || !sourceMessages.some((message) => message.role === 'assistant')) {
    return '';
  }

  const maxMessageLength = Number.isSafeInteger(options.maxMessageLength) && (options.maxMessageLength as number) > 0
    ? options.maxMessageLength as number
    : DEFAULT_MAX_MESSAGE_LENGTH;
  return sourceMessages
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${truncateText(message.text, maxMessageLength)}`)
    .join('\n');
}

function extractAssistantText(content: unknown): string {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : '';
  }

  return content
    .filter((block): block is { type: 'text'; text?: string } => Boolean(block) && typeof block === 'object' && (block as { type?: string }).type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

function readCompletionError(response: unknown): string | null {
  if (!isRecord(response) || response.stopReason !== 'error') {
    return null;
  }

  const errorMessage = readNonEmptyString(response.errorMessage);
  return errorMessage || 'Conversation title generation failed.';
}

export function normalizeGeneratedConversationTitle(title: string | null | undefined, maxLength = DEFAULT_MAX_TITLE_LENGTH): string | null {
  if (typeof title !== 'string') {
    return null;
  }

  const firstLine = title
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return null;
  }

  const normalized = normalizeWhitespace(firstLine
    .replace(/^title\s*:\s*/i, '')
    .replace(/^[-*•#]+\s*/, '')
    .replace(/^['"`]+/, '')
    .replace(/['"`]+$/, ''));

  if (!normalized) {
    return null;
  }

  return truncateText(normalized, maxLength);
}

function resolveConversationTitleModel(
  modelRegistry: ConversationTitleModelRegistry,
  settings: ConversationAutoTitleSettings,
): Model<Api> | null {
  const availableModels = modelRegistry.getAvailable();
  return availableModels.find((model) => model.provider === settings.provider && model.id === settings.model) ?? null;
}

export async function generateConversationTitle(options: {
  messages: ConversationTitleMessageInput[];
  modelRegistry: ConversationTitleModelRegistry;
  settings?: ConversationAutoTitleSettings;
  settingsFile?: string;
  now?: number;
}): Promise<string | null> {
  const settings = options.settings ?? readConversationAutoTitleSettings(options.settingsFile ?? '');
  if (!settings.enabled) {
    return null;
  }

  const transcript = buildConversationTitleTranscript(options.messages, { maxMessages: settings.maxMessages });
  if (!transcript) {
    return null;
  }

  const model = resolveConversationTitleModel(options.modelRegistry, settings);
  if (!model) {
    return null;
  }

  const authResult = await options.modelRegistry.getApiKeyAndHeaders(model);
  if (!authResult.ok) {
    return null;
  }

  const response = await completeSimple(
    model,
    {
      systemPrompt: requirePromptCatalogEntry('utilities/conversation-title.md'),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'Write a short, scan-friendly title for this conversation.',
                `Optimize for a narrow one-line sidebar where only the first 24-32 characters may be visible. Put the most distinguishing words first and keep it under ${settings.maxTitleLength} characters.`,
                'Prefer a compact label, not a sentence fragment.',
                'Action-first is fine when it is clear and specific.',
                'Avoid filler prefixes like "Page:", "Screen:", "Header:", or "When we...".',
                'Focus on the main thread, not the latest micro-step or temporary status.',
                'Return only the title.',
                '',
                transcript,
              ].join('\n'),
            },
          ],
          timestamp: options.now ?? Date.now(),
        },
      ],
    },
    {
      apiKey: authResult.apiKey,
      headers: authResult.headers,
      reasoning: settings.reasoning,
      maxTokens: 32,
      cacheRetention: 'none',
    },
  );

  const errorMessage = readCompletionError(response);
  if (errorMessage) {
    throw new Error(errorMessage);
  }

  return normalizeGeneratedConversationTitle(extractAssistantText(response.content), settings.maxTitleLength);
}
