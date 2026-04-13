import { readSessionMeta } from './sessions.js';
import {
  summarizeSessionFileForPrompt,
  type LiveSessionLoaderOptions,
} from './liveSessions.js';

export const RELATED_THREADS_CONTEXT_CUSTOM_TYPE = 'related_threads_context';
const MAX_RELATED_THREAD_SELECTIONS = 3;

export interface RelatedConversationContextSummary {
  sessionId: string;
  title: string;
  cwd: string;
  timestamp: string;
  summary: string;
}

export interface RelatedConversationContextResult {
  contextMessages: Array<{
    customType: string;
    content: string;
  }>;
  summaries: RelatedConversationContextSummary[];
}

function normalizeSessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    ids.push(normalized);
  }

  return ids;
}

function normalizeSummaryText(value: string): string {
  const normalized = value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalized || 'No directly relevant context.';
}

function buildCombinedContext(summaries: RelatedConversationContextSummary[]): string {
  const lines = [
    'The user explicitly selected previous conversations to reuse as background context for the next prompt.',
    'Use only the parts that still help. Prefer the current prompt and current repo state over stale historical details.',
  ];

  summaries.forEach((summary, index) => {
    lines.push(
      '',
      `Conversation ${index + 1} — ${summary.title}`,
      `Workspace: ${summary.cwd}`,
      `Created: ${summary.timestamp}`,
      '',
      summary.summary,
    );
  });

  return lines.join('\n');
}

export async function buildRelatedConversationContext(input: {
  sessionIds?: unknown;
  prompt?: unknown;
  loaderOptions?: LiveSessionLoaderOptions;
}): Promise<RelatedConversationContextResult> {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) {
    throw new Error('prompt required');
  }

  const sessionIds = normalizeSessionIds(input.sessionIds);
  if (sessionIds.length === 0) {
    throw new Error('sessionIds required');
  }
  if (sessionIds.length > MAX_RELATED_THREAD_SELECTIONS) {
    throw new Error(`Pick at most ${MAX_RELATED_THREAD_SELECTIONS} related threads.`);
  }

  const summaries: RelatedConversationContextSummary[] = [];

  for (const sessionId of sessionIds) {
    const meta = readSessionMeta(sessionId);
    if (!meta) {
      throw new Error(`Conversation ${sessionId} not found.`);
    }

    const summary = await summarizeSessionFileForPrompt(meta.file, meta.cwd, prompt, input.loaderOptions ?? {});
    summaries.push({
      sessionId: meta.id,
      title: meta.title,
      cwd: meta.cwd,
      timestamp: meta.timestamp,
      summary: normalizeSummaryText(summary),
    });
  }

  return {
    contextMessages: [{
      customType: RELATED_THREADS_CONTEXT_CUSTOM_TYPE,
      content: buildCombinedContext(summaries),
    }],
    summaries,
  };
}
