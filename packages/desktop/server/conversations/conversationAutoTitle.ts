import { existsSync, readFileSync } from 'node:fs';

import { type ThinkingLevel } from '@mariozechner/pi-ai';

const DEFAULT_PROVIDER = 'openai-codex';
const DEFAULT_MODEL = 'gpt-5.4-mini';
const DEFAULT_REASONING: ThinkingLevel = 'minimal';
const DEFAULT_MAX_MESSAGES = 8;
const DEFAULT_MAX_TITLE_LENGTH = 80;
const MAX_TITLE_SOURCE_MESSAGES = 32;
const MAX_TITLE_LENGTH = 160;

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

function readPositiveInteger(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(max, value) : fallback;
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
  const providerFromModel =
    slashMatches.length === 1 && slashIndex > 0 && slashIndex < configuredModel.length - 1 ? configuredModel.slice(0, slashIndex) : '';
  const modelId = providerFromModel ? configuredModel.slice(slashIndex + 1) : configuredModel;
  const explicitProvider = readNonEmptyString(conversationTitles.provider) || providerFromModel;
  const hasExplicitModel = modelId.length > 0;

  return {
    enabled: readBoolean(conversationTitles.enabled, true),
    provider: hasExplicitModel ? explicitProvider || DEFAULT_PROVIDER : DEFAULT_PROVIDER,
    model: hasExplicitModel ? modelId : DEFAULT_MODEL,
    reasoning: normalizeThinkingLevel(conversationTitles.reasoning),
    maxMessages: readPositiveInteger(conversationTitles.maxMessages, DEFAULT_MAX_MESSAGES, MAX_TITLE_SOURCE_MESSAGES),
    maxTitleLength: readPositiveInteger(conversationTitles.maxTitleLength, DEFAULT_MAX_TITLE_LENGTH, MAX_TITLE_LENGTH),
  };
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

  const normalized = normalizeWhitespace(
    firstLine
      .replace(/^title\s*:\s*/i, '')
      .replace(/^[-*•#]+\s*/, '')
      .replace(/^['"`]+/, '')
      .replace(/['"`]+$/, ''),
  );

  if (!normalized) {
    return null;
  }

  const titleLimit = Number.isSafeInteger(maxLength) && maxLength > 0 ? Math.min(MAX_TITLE_LENGTH, maxLength) : DEFAULT_MAX_TITLE_LENGTH;
  return truncateText(normalized, titleLimit);
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
