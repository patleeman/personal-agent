import { eng, removeStopwords } from 'stopword';
import { readConversationSummary } from './conversationSummaries.js';
import {
  listSessions,
  readSessionMeta,
  readSessionSearchText,
  type SessionMeta,
} from './sessions.js';

export const RELATED_CONVERSATION_POINTERS_CUSTOM_TYPE = 'related_conversation_pointers';
const MAX_RELATED_CONVERSATION_POINTERS = 5;
const AUTO_POINTER_MIN_SCORE = 6;
const MAX_AUTO_SESSION_SEARCH_READS = 24;
const PRODUCT_STOPWORDS = new Set([
  'actually', 'agent', 'agents', 'app', 'conversation', 'conversations', 'does', 'doing', 'done', 'good', 'how', 'junk',
  'like', 'look', 'looks', 'new', 'now', 'okay', 'please', 'pro', 'really', 'screen', 'stuff', 'thing', 'things',
  'thread', 'threads', 'today', 'used', 'user', 'want', 'wants', 'what', 'when', 'where', 'why', 'work', 'working',
  'would', 'yeah',
]);

export interface RelatedConversationPointer {
  sessionId: string;
  title: string;
  cwd: string;
  timestamp: string;
  lastActivityAt?: string;
  score: number;
  source: 'manual' | 'auto';
  weakMatch?: boolean;
  reasons: string[];
  preview?: string;
}

export interface RelatedConversationPointersResult {
  contextMessages: Array<{
    customType: string;
    content: string;
  }>;
  pointers: RelatedConversationPointer[];
  warnings: string[];
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

function normalizePointerLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, MAX_RELATED_CONVERSATION_POINTERS)
    : MAX_RELATED_CONVERSATION_POINTERS;
}

function tokenize(value: string): string[] {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);
  const terms = removeStopwords(tokens, eng)
    .filter((term) => !PRODUCT_STOPWORDS.has(term));

  return Array.from(new Set(terms)).slice(0, 32);
}

function includesAnyTerm(text: string, terms: string[]): string[] {
  const normalized = text.toLowerCase();
  return terms.filter((term) => normalized.includes(term));
}

function normalizePreview(value: string | undefined, maxLength = 220): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
    : normalized;
}

function parsePointerTimestamp(value: string | undefined): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return Number.NaN;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : Number.NaN;
}

function scoreCandidate(input: {
  meta: SessionMeta;
  terms: string[];
  currentCwd?: string;
  preview?: string;
  searchText?: string;
}): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const titleMatches = includesAnyTerm(input.meta.title, input.terms);
  if (titleMatches.length > 0) {
    score += Math.min(12, titleMatches.length * 5);
    reasons.push(`title matches ${titleMatches.slice(0, 4).join(', ')}`);
  }

  if (input.currentCwd && input.meta.cwd === input.currentCwd) {
    score += 3;
    reasons.push('same workspace');
  }

  const previewMatches = includesAnyTerm(input.preview ?? '', input.terms);
  if (previewMatches.length > 0) {
    score += Math.min(8, previewMatches.length * 2);
    reasons.push(`cached preview matches ${previewMatches.slice(0, 4).join(', ')}`);
  }

  const searchMatches = includesAnyTerm(input.searchText ?? '', input.terms);
  if (searchMatches.length > 0) {
    score += Math.min(6, searchMatches.length);
    reasons.push(`transcript index matches ${searchMatches.slice(0, 4).join(', ')}`);
  }

  const lastActivity = parsePointerTimestamp(input.meta.lastActivityAt ?? input.meta.timestamp);
  if (Number.isFinite(lastActivity)) {
    const ageDays = (Date.now() - lastActivity) / 86_400_000;
    if (ageDays <= 7) {
      score += 2;
      reasons.push('recent activity');
    } else if (ageDays <= 30) {
      score += 1;
      reasons.push('recent-ish activity');
    }
  }

  return { score, reasons };
}

function resolveSessionMetaWithRetry(sessionId: string): SessionMeta | null {
  return readSessionMeta(sessionId) ?? readSessionMeta(sessionId);
}

function buildPointer(input: {
  meta: SessionMeta;
  promptTerms: string[];
  currentCwd?: string;
  source: 'manual' | 'auto';
  allowSessionSearchRead?: boolean;
}): RelatedConversationPointer {
  const summary = readConversationSummary(input.meta.id);
  const preview = normalizePreview(summary?.displaySummary || summary?.promptSummary);
  const searchText = summary?.searchText || (input.allowSessionSearchRead ? readSessionSearchText(input.meta.id, 6_000) ?? undefined : undefined);
  const scored = scoreCandidate({
    meta: input.meta,
    terms: input.promptTerms,
    currentCwd: input.currentCwd,
    preview,
    searchText,
  });

  return {
    sessionId: input.meta.id,
    title: input.meta.title,
    cwd: input.meta.cwd,
    timestamp: input.meta.timestamp,
    ...(input.meta.lastActivityAt ? { lastActivityAt: input.meta.lastActivityAt } : {}),
    score: scored.score,
    source: input.source,
    ...(input.source === 'manual' && scored.score < AUTO_POINTER_MIN_SCORE ? { weakMatch: true } : {}),
    reasons: scored.reasons.length > 0 ? scored.reasons : [input.source === 'manual' ? 'manually selected' : 'ranked candidate'],
    ...(preview ? { preview } : {}),
  };
}

function pointerActivityMs(pointer: RelatedConversationPointer): number {
  const parsed = parsePointerTimestamp(pointer.lastActivityAt ?? pointer.timestamp);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function formatPointerContext(pointers: RelatedConversationPointer[]): string {
  const lines = [
    'Potentially related previous conversations are available as pointers only.',
    'Do not treat these pointer previews as factual source context. If details matter, call conversation_inspect before relying on them.',
    'Use only conversations that help with the current prompt; ignore stale or weak matches.',
  ];

  pointers.forEach((pointer, index) => {
    lines.push(
      '',
      `${index + 1}. ${pointer.title}`,
      `   id: ${pointer.sessionId}`,
      `   workspace: ${pointer.cwd}`,
      `   created: ${pointer.timestamp}`,
      ...(pointer.lastActivityAt ? [`   last activity: ${pointer.lastActivityAt}`] : []),
      `   source: ${pointer.source}${pointer.weakMatch ? ' (weak match, manually selected)' : ''}`,
      `   relevance: ${pointer.score} — ${pointer.reasons.join('; ')}`,
      ...(pointer.preview ? [`   cached preview: ${pointer.preview}`] : []),
    );
  });

  return lines.join('\n');
}

export function buildRelatedConversationPointers(input: {
  prompt: string;
  currentConversationId?: string;
  currentCwd?: string;
  selectedSessionIds?: unknown;
  limit?: number;
}): RelatedConversationPointersResult {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return { contextMessages: [], pointers: [], warnings: [] };
  }

  const limit = normalizePointerLimit(input.limit);
  const selectedIds = normalizeSessionIds(input.selectedSessionIds).filter((sessionId) => sessionId !== input.currentConversationId);
  const promptTerms = tokenize(prompt);
  const warnings: string[] = [];
  const pointers: RelatedConversationPointer[] = [];
  const used = new Set<string>();

  for (const sessionId of selectedIds) {
    if (pointers.length >= limit) {
      break;
    }

    const meta = resolveSessionMetaWithRetry(sessionId);
    if (!meta) {
      warnings.push(`Selected related conversation ${sessionId} could not be read and was omitted.`);
      continue;
    }

    const pointer = buildPointer({ meta, promptTerms, currentCwd: input.currentCwd, source: 'manual', allowSessionSearchRead: true });
    pointers.push(pointer);
    used.add(pointer.sessionId);
  }

  if (pointers.length < limit) {
    const autoMetas = listSessions()
      .filter((meta) => meta.id !== input.currentConversationId && !used.has(meta.id) && meta.messageCount > 0);
    const autoMetasById = new Map(autoMetas.map((meta) => [meta.id, meta]));
    const cheapAutoCandidates = autoMetas
      .map((meta) => buildPointer({ meta, promptTerms, currentCwd: input.currentCwd, source: 'auto', allowSessionSearchRead: false }));

    const autoCandidatesById = new Map<string, RelatedConversationPointer>();
    for (const pointer of cheapAutoCandidates) {
      if (pointer.score >= AUTO_POINTER_MIN_SCORE) {
        autoCandidatesById.set(pointer.sessionId, pointer);
      }
    }

    if (promptTerms.length > 0) {
      for (const cheapPointer of cheapAutoCandidates
        .filter((pointer) => pointer.score < AUTO_POINTER_MIN_SCORE)
        .sort((a, b) => b.score - a.score || pointerActivityMs(b) - pointerActivityMs(a))
        .slice(0, MAX_AUTO_SESSION_SEARCH_READS)) {
        const meta = autoMetasById.get(cheapPointer.sessionId);
        if (!meta) {
          continue;
        }

        const pointer = buildPointer({ meta, promptTerms, currentCwd: input.currentCwd, source: 'auto', allowSessionSearchRead: true });
        if (pointer.score >= AUTO_POINTER_MIN_SCORE) {
          autoCandidatesById.set(pointer.sessionId, pointer);
        }
      }
    }

    const autoCandidates = Array.from(autoCandidatesById.values())
      .sort((a, b) => b.score - a.score || pointerActivityMs(b) - pointerActivityMs(a));

    for (const pointer of autoCandidates) {
      if (pointers.length >= limit) {
        break;
      }
      pointers.push(pointer);
    }
  }

  if (pointers.length === 0) {
    return { contextMessages: [], pointers: [], warnings };
  }

  return {
    contextMessages: [{
      customType: RELATED_CONVERSATION_POINTERS_CUSTOM_TYPE,
      content: formatPointerContext(pointers),
    }],
    pointers,
    warnings,
  };
}
