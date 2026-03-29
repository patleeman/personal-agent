import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { completeSimple, type Api, type Model, type ThinkingLevel } from '@mariozechner/pi-ai';
import { ModelRegistry } from '@mariozechner/pi-coding-agent';
import type { WorkspaceGitDraftSource } from './workspaceBrowser.js';
import { createModelRegistryForAuthFile } from './modelRegistry.js';

const DEFAULT_PROVIDER = 'openai-codex';
const DEFAULT_MODEL = 'gpt-5.4';
const DEFAULT_REASONING: ThinkingLevel = 'minimal';
const MAX_DIFF_CHARS = 12_000;
const MAX_FILE_LINES = 12;

export interface WorkspaceCommitDraftResult {
  subject: string;
  body: string | null;
  message: string;
  source: 'ai' | 'fallback';
  notice: string | null;
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

function readDraftModelSettings(settingsFile: string): {
  provider: string;
  model: string;
  reasoning: ThinkingLevel;
} {
  const settings = readSettingsObject(settingsFile);

  return {
    provider: readNonEmptyString(settings.defaultProvider) || DEFAULT_PROVIDER,
    model: readNonEmptyString(settings.defaultModel) || DEFAULT_MODEL,
    reasoning: normalizeThinkingLevel(settings.defaultThinkingLevel),
  };
}

function resolveModel(modelRegistry: ModelRegistry, settings: { provider: string; model: string }): Model<Api> | null {
  return modelRegistry.getAvailable().find((model) => model.provider === settings.provider && model.id === settings.model) ?? null;
}

function extractAssistantText(content: unknown): string {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : '';
  }

  return content
    .filter((block): block is { type: 'text'; text?: string } => Boolean(block) && typeof block === 'object' && (block as { type?: string }).type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
}

function readCompletionError(response: unknown): string | null {
  if (!isRecord(response) || response.stopReason !== 'error') {
    return null;
  }

  const errorMessage = readNonEmptyString(response.errorMessage);
  return errorMessage || 'Commit draft generation failed.';
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

function normalizeDraftMessage(text: string): { subject: string; body: string | null } | null {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return null;
  }

  const lines = normalized.split('\n');
  const subject = lines.shift()?.trim() ?? '';
  if (!subject) {
    return null;
  }

  const body = lines.join('\n').trim();
  return {
    subject: subject.slice(0, 72).trim(),
    body: body.length > 0 ? body : null,
  };
}

function dominantVerb(entries: WorkspaceGitDraftSource['entries']): string {
  const changeSet = new Set(entries.map((entry) => entry.change));
  if (changeSet.size === 1) {
    const only = entries[0]?.change;
    switch (only) {
      case 'added':
      case 'untracked':
        return 'Add';
      case 'deleted':
        return 'Remove';
      case 'renamed':
        return 'Rename';
      default:
        return 'Update';
    }
  }

  return 'Update';
}

function buildFallbackDraft(source: WorkspaceGitDraftSource): WorkspaceCommitDraftResult {
  const verb = dominantVerb(source.entries);
  const subject = source.entries.length === 1
    ? `${verb} ${basename(source.entries[0]?.relativePath ?? 'staged file')}`
    : `${verb} ${source.entries.length} files`;
  const bodyLines = source.entries
    .slice(0, MAX_FILE_LINES)
    .map((entry) => `- ${entry.relativePath}`);

  const body = source.entries.length > 1 ? bodyLines.join('\n') : null;
  const message = body ? `${subject}\n\n${body}` : subject;

  return {
    subject,
    body,
    message,
    source: 'fallback',
    notice: null,
  };
}

function withNotice(result: WorkspaceCommitDraftResult, notice: string): WorkspaceCommitDraftResult {
  return {
    ...result,
    notice,
  };
}

function buildDraftPrompt(source: WorkspaceGitDraftSource): string {
  const fileLines = source.entries
    .map((entry) => `- ${entry.relativePath} [${entry.change}]`)
    .slice(0, MAX_FILE_LINES)
    .join('\n');

  return [
    'Draft a git commit message for the currently staged changes only.',
    'Use imperative mood.',
    'Keep the subject specific and under 72 characters.',
    'Do not mention unstaged changes or speculate beyond the diff.',
    'Return plain text only: the first line is the subject, followed by an optional blank line and body.',
    '',
    'Staged files:',
    fileLines || '- none',
    '',
    'Staged diff:',
    truncate(source.diff, MAX_DIFF_CHARS),
  ].join('\n');
}

export async function draftWorkspaceCommitMessage(options: {
  draftSource: WorkspaceGitDraftSource;
  authFile: string;
  settingsFile: string;
}): Promise<WorkspaceCommitDraftResult> {
  const fallback = buildFallbackDraft(options.draftSource);
  const settings = readDraftModelSettings(options.settingsFile);
  const modelRegistry = createModelRegistryForAuthFile(options.authFile);
  const model = resolveModel(modelRegistry, settings);

  if (!model) {
    return withNotice(fallback, 'Used a local fallback draft because no coding model is available.');
  }

  const authResult = await modelRegistry.getApiKeyAndHeaders(model);
  if (!authResult.ok) {
    return withNotice(fallback, `Used a local fallback draft because the active coding model auth could not be resolved: ${authResult.error}`);
  }

  if (!authResult.apiKey && !authResult.headers) {
    return withNotice(fallback, 'Used a local fallback draft because no auth is configured for the active coding model.');
  }

  try {
    const response = await completeSimple(
      model,
      {
        systemPrompt: 'You write concise, high-signal git commit messages for staged changes.',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: buildDraftPrompt(options.draftSource) }],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: authResult.apiKey,
        headers: authResult.headers,
        reasoning: settings.reasoning,
        maxTokens: 200,
        cacheRetention: 'none',
      },
    );

    const errorMessage = readCompletionError(response);
    if (errorMessage) {
      return withNotice(fallback, `Used a local fallback draft because the model returned an error: ${errorMessage}`);
    }

    const parsed = normalizeDraftMessage(extractAssistantText((response as { content?: unknown }).content));
    if (!parsed) {
      return withNotice(fallback, 'Used a local fallback draft because the model response was empty.');
    }

    return {
      subject: parsed.subject,
      body: parsed.body,
      message: parsed.body ? `${parsed.subject}\n\n${parsed.body}` : parsed.subject,
      source: 'ai',
      notice: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown model error.';
    return withNotice(fallback, `Used a local fallback draft because the model request failed: ${message}`);
  }
}
