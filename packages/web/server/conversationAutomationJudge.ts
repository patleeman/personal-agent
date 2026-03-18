import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { completeSimple, type Api, type Model } from '@mariozechner/pi-ai';
import { collectConversationTitleSourceMessages, type ConversationTitleMessageInput } from './conversationAutoTitle.js';

const DEFAULT_PROVIDER = 'openai-codex';
const DEFAULT_MODEL = 'gpt-5.1-codex-mini';
export const DEFAULT_CONVERSATION_AUTOMATION_JUDGE_SYSTEM_PROMPT = [
  'You are a strict judge for personal-agent conversation automation.',
  'You receive only a sanitized conversation thread containing user and assistant messages.',
  'Tool calls, tool outputs, and chain-of-thought are intentionally excluded and must not be inferred from their absence.',
  'Evaluate only the explicit instruction you are given against the visible thread.',
  'Return JSON only with this exact shape: {"pass": boolean, "reason": string, "confidence": number}.',
  'Keep reason concise and concrete. Confidence must be between 0 and 1.',
].join(' ');

export interface ConversationAutomationJudgeSettings {
  provider: string;
  model: string;
  systemPrompt: string;
}

export interface ConversationAutomationJudgeSettingsState {
  currentModel: string;
  effectiveModel: string;
  systemPrompt: string;
  usingDefaultSystemPrompt: boolean;
}

export interface ConversationAutomationJudgeDecision {
  pass: boolean;
  reason: string;
  confidence: number | null;
}

export interface ConversationAutomationJudgeModelRegistry {
  getAvailable(): Model<Api>[];
  getApiKey(model: Model<Api>): Promise<string | undefined>;
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

function readWebUiSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return isRecord(settings.webUi) ? { ...settings.webUi } : {};
}

function readConversationAutomationJudgeSettingsObject(settings: Record<string, unknown>): Record<string, unknown> {
  const webUi = readWebUiSettings(settings);
  return isRecord(webUi.conversationAutomationJudge) ? { ...webUi.conversationAutomationJudge } : {};
}

function normalizeModelRef(model: unknown, provider: unknown): string {
  const normalizedModel = readNonEmptyString(model);
  if (!normalizedModel) {
    return '';
  }

  if (normalizedModel.includes('/')) {
    return normalizedModel;
  }

  const normalizedProvider = readNonEmptyString(provider);
  return normalizedProvider ? `${normalizedProvider}/${normalizedModel}` : normalizedModel;
}

function resolveDefaultModelSettings(settings: Record<string, unknown>): { provider: string; model: string } {
  return {
    provider: readNonEmptyString(settings.defaultProvider) || DEFAULT_PROVIDER,
    model: readNonEmptyString(settings.defaultModel) || DEFAULT_MODEL,
  };
}

function splitModelRef(modelRef: string): { provider: string; model: string } {
  const normalized = readNonEmptyString(modelRef);
  const slashIndex = normalized.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= normalized.length - 1) {
    return {
      provider: '',
      model: normalized,
    };
  }

  return {
    provider: normalized.slice(0, slashIndex),
    model: normalized.slice(slashIndex + 1),
  };
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
  return errorMessage || 'Conversation automation judge failed.';
}

function parseJudgeDecisionText(text: string): ConversationAutomationJudgeDecision {
  const trimmed = text.trim();
  const withoutFences = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  const jsonText = start >= 0 && end > start
    ? withoutFences.slice(start, end + 1)
    : withoutFences;
  const parsed = JSON.parse(jsonText) as unknown;
  if (!isRecord(parsed) || typeof parsed.pass !== 'boolean') {
    throw new Error('Conversation automation judge must return JSON with a boolean pass field.');
  }

  const reason = readNonEmptyString(parsed.reason) || (parsed.pass ? 'Passed.' : 'Failed.');
  const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
    ? Math.max(0, Math.min(1, parsed.confidence))
    : null;

  return {
    pass: parsed.pass,
    reason,
    confidence,
  };
}

export function readConversationAutomationJudgeSettings(settingsFile: string): ConversationAutomationJudgeSettings {
  const settings = readSettingsObject(settingsFile);
  const automationJudge = readConversationAutomationJudgeSettingsObject(settings);
  const defaultModel = resolveDefaultModelSettings(settings);
  const configuredModel = normalizeModelRef(automationJudge.model, automationJudge.provider);
  const split = splitModelRef(configuredModel);

  return {
    provider: split.provider || defaultModel.provider,
    model: split.model || defaultModel.model,
    systemPrompt: readNonEmptyString(automationJudge.systemPrompt) || DEFAULT_CONVERSATION_AUTOMATION_JUDGE_SYSTEM_PROMPT,
  };
}

export function readSavedConversationAutomationJudgePreferences(settingsFile: string): ConversationAutomationJudgeSettingsState {
  const settings = readSettingsObject(settingsFile);
  const automationJudge = readConversationAutomationJudgeSettingsObject(settings);
  const systemPrompt = readNonEmptyString(automationJudge.systemPrompt);

  return {
    currentModel: normalizeModelRef(automationJudge.model, automationJudge.provider),
    effectiveModel: (() => {
      const resolved = readConversationAutomationJudgeSettings(settingsFile);
      return `${resolved.provider}/${resolved.model}`;
    })(),
    systemPrompt: systemPrompt || DEFAULT_CONVERSATION_AUTOMATION_JUDGE_SYSTEM_PROMPT,
    usingDefaultSystemPrompt: systemPrompt.length === 0,
  };
}

export function writeSavedConversationAutomationJudgePreferences(
  input: { model?: string | null; systemPrompt?: string | null },
  settingsFile: string,
): ConversationAutomationJudgeSettingsState {
  const settings = readSettingsObject(settingsFile);
  const webUi = readWebUiSettings(settings);
  const automationJudge = readConversationAutomationJudgeSettingsObject(settings);

  if (input.model !== undefined) {
    const normalizedModel = readNonEmptyString(input.model ?? '');
    if (normalizedModel) {
      automationJudge.model = normalizedModel;
      delete automationJudge.provider;
    } else {
      delete automationJudge.model;
      delete automationJudge.provider;
    }
  }

  if (input.systemPrompt !== undefined) {
    const normalizedPrompt = readNonEmptyString(input.systemPrompt ?? '');
    if (normalizedPrompt && normalizedPrompt !== DEFAULT_CONVERSATION_AUTOMATION_JUDGE_SYSTEM_PROMPT) {
      automationJudge.systemPrompt = normalizedPrompt;
    } else {
      delete automationJudge.systemPrompt;
    }
  }

  if (Object.keys(automationJudge).length > 0) {
    webUi.conversationAutomationJudge = automationJudge;
  } else {
    delete webUi.conversationAutomationJudge;
  }

  if (Object.keys(webUi).length > 0) {
    settings.webUi = webUi;
  } else {
    delete settings.webUi;
  }

  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');

  return readSavedConversationAutomationJudgePreferences(settingsFile);
}

export function buildConversationAutomationJudgeTranscript(messages: ConversationTitleMessageInput[]): string {
  const sourceMessages = collectConversationTitleSourceMessages(messages, 0);
  return sourceMessages
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`)
    .join('\n');
}

function resolveConversationAutomationJudgeModel(
  modelRegistry: ConversationAutomationJudgeModelRegistry,
  settings: ConversationAutomationJudgeSettings,
): Model<Api> | null {
  return modelRegistry.getAvailable().find((model) => model.provider === settings.provider && model.id === settings.model) ?? null;
}

export async function runConversationAutomationJudge(options: {
  prompt: string;
  messages: ConversationTitleMessageInput[];
  modelRegistry: ConversationAutomationJudgeModelRegistry;
  settings?: ConversationAutomationJudgeSettings;
  settingsFile?: string;
  now?: number;
}): Promise<ConversationAutomationJudgeDecision> {
  const settings = options.settings ?? readConversationAutomationJudgeSettings(options.settingsFile ?? '');
  const transcript = buildConversationAutomationJudgeTranscript(options.messages);
  if (!transcript) {
    throw new Error('Conversation automation judge requires at least one visible user or assistant message.');
  }

  const model = resolveConversationAutomationJudgeModel(options.modelRegistry, settings);
  if (!model) {
    throw new Error(`Conversation automation judge model not found: ${settings.provider}/${settings.model}`);
  }

  const response = await completeSimple(
    model,
    {
      systemPrompt: settings.systemPrompt,
      messages: [
        {
          role: 'user',
          timestamp: options.now ?? Date.now(),
          content: [{
            type: 'text',
            text: [
              'Evaluate the sanitized conversation against this instruction.',
              'Return JSON only with keys: pass, reason, confidence.',
              '',
              'Instruction:',
              options.prompt.trim(),
              '',
              'Conversation:',
              transcript,
            ].join('\n'),
          }],
        },
      ],
    },
    {
      apiKey: await options.modelRegistry.getApiKey(model),
      reasoning: 'minimal',
      temperature: 0,
      maxTokens: 220,
      cacheRetention: 'none',
    },
  );

  const errorMessage = readCompletionError(response);
  if (errorMessage) {
    throw new Error(errorMessage);
  }

  const text = extractAssistantText(response.content);
  if (!text.trim()) {
    throw new Error('Conversation automation judge returned no text.');
  }

  return parseJudgeDecisionText(text);
}
