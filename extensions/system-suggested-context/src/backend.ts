import type { ExtensionBackendContext } from '@personal-agent/extensions/backend';
import {
  persistTraceSuggestedContext,
  readConversationSummary,
  readSessionBlocks,
  readSessionMeta,
  scheduleConversationSearchIndexing,
  searchIndexedConversationDocuments,
} from '@personal-agent/extensions/backend/conversations';
import { eng, removeStopwords } from 'stopword';

interface IndexedConversationSearchCandidate {
  sessionId: string;
  title: string;
  cwd: string;
  timestamp: string;
  lastActivityAt?: string;
  searchText: string;
}

interface SessionMeta {
  id: string;
  title: string;
  cwd: string;
  timestamp: string;
  lastActivityAt?: string;
  isRunning: boolean;
  needsAttention: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const RELATED_CONVERSATION_POINTERS_CUSTOM_TYPE = 'related_conversation_pointers';
const MAX_RELATED_CONVERSATION_POINTERS = 5;
const AUTO_POINTER_MIN_SCORE = 6;
const AUTO_POINTER_RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const POINTER_CACHE_TTL_MS = 60_000;
const WARM_POINTER_BUDGET_MS = 150;
const PRODUCT_STOPWORDS = new Set([
  'actually',
  'agent',
  'agents',
  'app',
  'conversation',
  'conversations',
  'does',
  'doing',
  'done',
  'good',
  'how',
  'junk',
  'like',
  'look',
  'looks',
  'new',
  'now',
  'okay',
  'please',
  'pro',
  'really',
  'screen',
  'stuff',
  'thing',
  'things',
  'thread',
  'threads',
  'today',
  'used',
  'user',
  'want',
  'wants',
  'what',
  'when',
  'where',
  'why',
  'work',
  'working',
  'would',
  'yeah',
]);

// ── Types ────────────────────────────────────────────────────────────────────

interface RelatedConversationPointer {
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

interface RelatedConversationPointersResult {
  contextMessages: Array<{
    customType: string;
    content: string;
  }>;
  pointers: RelatedConversationPointer[];
  warnings: string[];
}

interface CachedPointerResult {
  cachedAtMs: number;
  result: RelatedConversationPointersResult;
}

// ── Module-level cache ───────────────────────────────────────────────────────

const pointerCache = new Map<string, CachedPointerResult>();

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeSessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) continue;
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

function normalizeCacheText(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function buildPointerCacheKey(input: {
  prompt: string;
  currentConversationId?: string;
  currentCwd?: string;
  limit?: number;
  profile?: string;
}): string {
  return JSON.stringify({
    profile: input.profile ?? '',
    prompt: normalizeCacheText(input.prompt).toLowerCase(),
    currentConversationId: input.currentConversationId ?? '',
    currentCwd: input.currentCwd ?? '',
    limit: normalizePointerLimit(input.limit),
  });
}

function tokenize(value: string): string[] {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);
  const terms = removeStopwords(tokens, eng).filter((term) => !PRODUCT_STOPWORDS.has(term));
  return Array.from(new Set(terms)).slice(0, 32);
}

function includesAnyTerm(text: string, terms: string[]): string[] {
  const normalized = text.toLowerCase();
  return terms.filter((term) => normalized.includes(term));
}

function normalizePreview(value: string | undefined, maxLength = 220): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…` : normalized;
}

function parsePointerTimestamp(value: string | undefined): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : Number.NaN;
}

function scoreCandidate(input: {
  meta: SessionMeta;
  terms: string[];
  currentCwd?: string;
  preview?: string;
  searchText?: string;
  nowMs?: number;
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
    const ageDays = ((input.nowMs ?? Date.now()) - lastActivity) / 86_400_000;
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

async function resolveSessionMetaWithRetry(sessionId: string): Promise<SessionMeta | null> {
  return (
    ((await readSessionMeta(sessionId)) as SessionMeta | undefined) ??
    ((await readSessionMeta(sessionId)) as SessionMeta | undefined) ??
    null
  );
}

async function buildPointer(input: {
  meta: SessionMeta;
  promptTerms: string[];
  currentCwd?: string;
  source: 'manual' | 'auto';
  nowMs?: number;
}): Promise<RelatedConversationPointer> {
  const summary = await readConversationSummary(input.meta.id);
  const preview = normalizePreview(summary?.displaySummary || summary?.promptSummary);
  const searchText = summary?.searchText;
  const scored = scoreCandidate({
    meta: input.meta,
    terms: input.promptTerms,
    currentCwd: input.currentCwd,
    preview,
    searchText,
    nowMs: input.nowMs,
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

function buildIndexedPointer(input: {
  candidate: IndexedConversationSearchCandidate;
  promptTerms: string[];
  currentCwd?: string;
  nowMs?: number;
}): RelatedConversationPointer {
  const meta = {
    id: input.candidate.sessionId,
    title: input.candidate.title,
    cwd: input.candidate.cwd,
    timestamp: input.candidate.timestamp,
    lastActivityAt: input.candidate.lastActivityAt,
  } as SessionMeta;
  const scored = scoreCandidate({
    meta,
    terms: input.promptTerms,
    currentCwd: input.currentCwd,
    searchText: input.candidate.searchText,
    nowMs: input.nowMs,
  });
  return {
    sessionId: input.candidate.sessionId,
    title: input.candidate.title,
    cwd: input.candidate.cwd,
    timestamp: input.candidate.timestamp,
    ...(input.candidate.lastActivityAt ? { lastActivityAt: input.candidate.lastActivityAt } : {}),
    score: scored.score,
    source: 'auto',
    reasons: scored.reasons.length > 0 ? scored.reasons : ['indexed candidate'],
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

async function hasConversationTranscriptContent(conversationId: string): Promise<boolean> {
  return (((await readSessionBlocks(conversationId, { tailBlocks: 1 })) as { totalBlocks?: number } | undefined)?.totalBlocks ?? 0) > 0;
}

async function buildRelatedConversationPointers(input: {
  prompt: string;
  currentConversationId?: string;
  currentCwd?: string;
  selectedSessionIds?: unknown;
  limit?: number;
  nowMs?: number;
  includeAuto?: boolean;
}): Promise<RelatedConversationPointersResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return { contextMessages: [], pointers: [], warnings: [] };
  }

  const limit = normalizePointerLimit(input.limit);
  const selectedIds = normalizeSessionIds(input.selectedSessionIds).filter((sessionId) => sessionId !== input.currentConversationId);
  const promptTerms = tokenize(prompt);
  const nowMs = Number.isSafeInteger(input.nowMs) && input.nowMs !== undefined ? input.nowMs : Date.now();
  const warnings: string[] = [];
  const pointers: RelatedConversationPointer[] = [];
  const used = new Set<string>();

  for (const sessionId of selectedIds) {
    if (pointers.length >= limit) break;
    const meta = await resolveSessionMetaWithRetry(sessionId);
    if (!meta) {
      warnings.push(`Selected related conversation ${sessionId} could not be read and was omitted.`);
      continue;
    }
    const pointer = await buildPointer({ meta, promptTerms, currentCwd: input.currentCwd, source: 'manual', nowMs });
    pointers.push(pointer);
    used.add(pointer.sessionId);
  }

  if (input.includeAuto !== false && pointers.length < limit) {
    const indexedCandidates = (
      await searchIndexedConversationDocuments({
        terms: promptTerms,
        currentConversationId: input.currentConversationId,
        currentCwd: input.currentCwd,
        nowMs,
        recentWindowMs: AUTO_POINTER_RECENT_WINDOW_MS,
        limit: limit - pointers.length,
      })
    )
      .map((candidate) => buildIndexedPointer({ candidate, promptTerms, currentCwd: input.currentCwd, nowMs }))
      .filter((pointer) => pointer.score >= AUTO_POINTER_MIN_SCORE)
      .sort((a, b) => b.score - a.score || pointerActivityMs(b) - pointerActivityMs(a));

    for (const pointer of indexedCandidates) {
      if (pointers.length >= limit) break;
      if (used.has(pointer.sessionId)) continue;
      pointers.push(pointer);
      used.add(pointer.sessionId);
    }
  }

  if (pointers.length === 0) {
    return { contextMessages: [], pointers: [], warnings };
  }

  return {
    contextMessages: [
      {
        customType: RELATED_CONVERSATION_POINTERS_CUSTOM_TYPE,
        content: formatPointerContext(pointers),
      },
    ],
    pointers,
    warnings,
  };
}

function readCachedRelatedConversationPointers(input: {
  prompt: string;
  currentConversationId?: string;
  currentCwd?: string;
  limit?: number;
  nowMs?: number;
  profile?: string;
}): RelatedConversationPointersResult | null {
  const key = buildPointerCacheKey(input);
  const nowMs = Number.isSafeInteger(input.nowMs) && input.nowMs !== undefined ? input.nowMs : Date.now();
  const cached = pointerCache.get(key);
  if (!cached || nowMs - cached.cachedAtMs > POINTER_CACHE_TTL_MS) {
    pointerCache.delete(key);
    return null;
  }
  return cached.result;
}

async function warmRelatedConversationPointerCache(input: {
  prompt: string;
  currentConversationId?: string;
  currentCwd?: string;
  limit?: number;
  nowMs?: number;
  profile?: string;
}): Promise<RelatedConversationPointersResult> {
  void scheduleConversationSearchIndexing();
  const started = Date.now();
  const nowMs = Number.isSafeInteger(input.nowMs) && input.nowMs !== undefined ? input.nowMs : Date.now();
  const key = buildPointerCacheKey(input);
  if (Date.now() - started > WARM_POINTER_BUDGET_MS) {
    const empty = { contextMessages: [], pointers: [], warnings: [] };
    pointerCache.set(key, { cachedAtMs: nowMs, result: empty });
    return empty;
  }
  const result = await buildRelatedConversationPointers({
    ...input,
    selectedSessionIds: [],
    includeAuto: true,
    nowMs,
  });
  if (Date.now() - started > WARM_POINTER_BUDGET_MS) {
    const empty = { contextMessages: [], pointers: [], warnings: [] };
    pointerCache.set(key, { cachedAtMs: nowMs, result: empty });
    return empty;
  }
  pointerCache.set(key, { cachedAtMs: nowMs, result });
  return result;
}

// ── Backend action: warm pointers during typing ──────────────────────────────

export async function warmPointers(
  input: { prompt: string; currentConversationId?: string; currentCwd?: string },
  ctx: ExtensionBackendContext,
): Promise<{ ok: boolean; pointerCount: number }> {
  const result = await warmRelatedConversationPointerCache({
    profile: ctx.profile,
    prompt: input.prompt,
    currentConversationId: input.currentConversationId,
    currentCwd: input.currentCwd,
  });
  return { ok: true, pointerCount: result.pointers.length };
}

// ── Prompt context provider: inject pointers on submit ──────────────────────

export async function providePromptContext(
  input: {
    prompt: string;
    conversationId: string;
    currentCwd?: string;
    relatedConversationIds?: unknown;
  },
  _ctx: ExtensionBackendContext,
): Promise<{ contextMessages: Array<{ customType: string; content: string }>; warnings?: string[] }> {
  // Only inject pointers for brand-new conversations with no existing content
  if (await hasConversationTranscriptContent(input.conversationId)) {
    return { contextMessages: [], warnings: [] };
  }

  const hasSelectedIds =
    Array.isArray(input.relatedConversationIds) &&
    input.relatedConversationIds.some((id) => typeof id === 'string' && id.trim().length > 0);

  try {
    const pointers = hasSelectedIds
      ? await buildRelatedConversationPointers({
          prompt: input.prompt,
          currentConversationId: input.conversationId,
          currentCwd: input.currentCwd,
          selectedSessionIds: input.relatedConversationIds,
          includeAuto: false,
        })
      : (readCachedRelatedConversationPointers({
          profile: _ctx.profile,
          prompt: input.prompt,
          currentConversationId: input.conversationId,
          currentCwd: input.currentCwd,
        }) ?? { contextMessages: [], pointers: [], warnings: [] });

    if (pointers.pointers.length > 0) {
      // Fire-and-forget telemetry: persist which pointer IDs were used
      const pointerIds = pointers.pointers.map((p) => p.sessionId);
      void persistTraceSuggestedContext({ sessionId: input.conversationId, pointerIds });
    }

    return {
      contextMessages: pointers.contextMessages,
      warnings: pointers.warnings.length > 0 ? pointers.warnings : undefined,
    };
  } catch (error) {
    return {
      contextMessages: [],
      warnings: ['Related conversation pointers failed; sent without them.'],
    };
  }
}
