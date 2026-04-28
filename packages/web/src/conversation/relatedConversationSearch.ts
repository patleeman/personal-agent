import { fuzzyScore } from '../commands/slashMenu';
import type { ConversationSummaryRecord, SessionMeta } from '../shared/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RECENT_WINDOW_DAYS = 7;
const DEFAULT_CANDIDATE_LIMIT = 48;
const DEFAULT_RECENT_RESULTS_LIMIT = 10;
const MAX_RELATED_CONVERSATION_LIMIT = 100;
const COMMON_QUERY_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'for', 'from', 'help', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'out', 'please', 'should', 'that', 'the', 'this', 'to', 'want', 'what', 'why', 'with', 'you', 'your',
]);

export interface RelatedConversationSearchResult {
  sessionId: string;
  title: string;
  cwd: string;
  timestamp: string;
  snippet: string;
  matchedTerms: string[];
  score: number;
  sameWorkspace: boolean;
  summary?: ConversationSummaryRecord;
  reason?: string;
  preselectEligible?: boolean;
}

export interface RelatedConversationPreselection {
  sessionId: string;
  confidence: number;
}

function normalizeQueryTokens(query: string): string[] {
  const cleanedTokens = query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);

  const meaningfulTokens = cleanedTokens.filter((token) => token.length > 1 && !COMMON_QUERY_STOPWORDS.has(token));
  const tokens = meaningfulTokens.length > 0 ? meaningfulTokens : cleanedTokens;

  return [...new Set(tokens)].slice(0, 8);
}

function normalizePath(value: string | null | undefined): string {
  return typeof value === 'string'
    ? value.trim().replace(/[\\/]+$/, '')
    : '';
}

function normalizeField(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizePositiveIntegerLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(MAX_RELATED_CONVERSATION_LIMIT, value)
    : fallback;
}

function normalizeRecentWindowDays(value: number | null | undefined): number | null {
  if (value === null) {
    return null;
  }

  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : DEFAULT_RECENT_WINDOW_DAYS;
}

function normalizeNowMs(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : Date.now();
}

function parseConversationTimestamp(value: string | undefined): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return Number.NaN;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : Number.NaN;
}

function scoreField(token: string, value: string | undefined, weight: number): number | null {
  const normalizedValue = normalizeField(value);
  if (!normalizedValue) {
    return null;
  }

  const lowerValue = normalizedValue.toLowerCase();
  const containsIndex = lowerValue.indexOf(token);
  if (containsIndex !== -1) {
    return weight
      + Math.max(0, 36 - containsIndex)
      + Math.max(0, 18 - Math.max(0, lowerValue.length - token.length));
  }

  const fuzzy = fuzzyScore(token, normalizedValue);
  if (fuzzy === null) {
    return null;
  }

  return Math.floor(weight / 3) + fuzzy;
}

function scoreRecency(timestamp: string, nowMs: number): number {
  const parsed = parseConversationTimestamp(timestamp);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  const ageDays = Math.max(0, (nowMs - parsed) / DAY_MS);
  return Math.max(0, Math.round(42 - ageDays * 5));
}

function buildReason(input: {
  sameWorkspace: boolean;
  matchedTerms: string[];
  summary?: ConversationSummaryRecord;
}): string {
  const reasons: string[] = [];
  if (input.sameWorkspace) {
    reasons.push('Same workspace');
  }
  if (input.matchedTerms.length > 0) {
    reasons.push(`Matches ${input.matchedTerms.slice(0, 3).join(', ')}`);
  }
  if (input.summary?.filesTouched.length) {
    reasons.push(`Touched ${input.summary.filesTouched.slice(0, 2).join(', ')}`);
  }
  if (input.summary?.status && input.summary.status !== 'unknown') {
    reasons.push(input.summary.status === 'needs_user' ? 'Needs user' : input.summary.status.replace(/_/g, ' '));
  }
  return reasons.join(' · ');
}

function buildSummarySearchText(session: SessionMeta, searchText: string, summary?: ConversationSummaryRecord): string {
  if (!summary) {
    return searchText;
  }

  return [
    summary.searchText,
    summary.displaySummary,
    summary.outcome,
    summary.promptSummary,
    summary.keyTerms.join(' '),
    summary.filesTouched.join(' '),
    searchText,
    session.title,
  ].filter(Boolean).join('\n');
}

function scorePhrase(query: string, value: string | undefined, weight: number): number {
  const normalizedValue = normalizeField(value);
  const normalizedQuery = normalizeField(query).toLowerCase();
  if (!normalizedValue || !normalizedQuery) {
    return 0;
  }

  const lowerValue = normalizedValue.toLowerCase();
  const index = lowerValue.indexOf(normalizedQuery);
  if (index === -1) {
    return 0;
  }

  return weight + Math.max(0, 28 - index);
}

function minimumMatchedTokenCount(tokenCount: number): number {
  return tokenCount >= 4 ? 2 : 1;
}

function findSnippetStart(text: string, tokens: string[]): number {
  const lowerText = text.toLowerCase();
  let bestIndex = -1;

  for (const token of tokens) {
    const index = lowerText.indexOf(token);
    if (index === -1) {
      continue;
    }

    if (bestIndex === -1 || index < bestIndex) {
      bestIndex = index;
    }
  }

  return bestIndex;
}

function clampSnippet(text: string, start: number, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const safeStart = Math.max(0, Math.min(start, Math.max(0, text.length - maxLength)));
  const safeEnd = Math.min(text.length, safeStart + maxLength);
  const prefix = safeStart > 0 ? '…' : '';
  const suffix = safeEnd < text.length ? '…' : '';

  return `${prefix}${text.slice(safeStart, safeEnd).trim()}${suffix}`;
}

function buildSnippet(searchText: string | undefined, title: string, query: string, maxLength = 140): string {
  const normalizedText = normalizeField(searchText);
  if (!normalizedText) {
    return normalizeField(title);
  }

  const tokens = normalizeQueryTokens(query);
  if (tokens.length === 0) {
    return clampSnippet(normalizedText, 0, maxLength);
  }

  const matchIndex = findSnippetStart(normalizedText, tokens);
  if (matchIndex === -1) {
    return clampSnippet(normalizedText, 0, maxLength);
  }

  const windowStart = Math.max(0, matchIndex - Math.floor(maxLength / 3));
  return clampSnippet(normalizedText, windowStart, maxLength);
}

function isClosedConversation(session: SessionMeta): boolean {
  return session.isLive !== true && session.isRunning !== true;
}

function compareRecentConversationCandidates(left: SessionMeta, right: SessionMeta, workspaceCwd: string): number {
  const leftWorkspace = workspaceCwd.length > 0 && normalizePath(left.cwd) === workspaceCwd;
  const rightWorkspace = workspaceCwd.length > 0 && normalizePath(right.cwd) === workspaceCwd;
  if (leftWorkspace !== rightWorkspace) {
    return leftWorkspace ? -1 : 1;
  }

  const leftTimestamp = parseConversationTimestamp(left.lastActivityAt ?? left.timestamp);
  const rightTimestamp = parseConversationTimestamp(right.lastActivityAt ?? right.timestamp);
  if (Number.isFinite(leftTimestamp) || Number.isFinite(rightTimestamp)) {
    if (!Number.isFinite(leftTimestamp)) {
      return 1;
    }
    if (!Number.isFinite(rightTimestamp)) {
      return -1;
    }
    if (leftTimestamp !== rightTimestamp) {
      return rightTimestamp - leftTimestamp;
    }
  }

  return left.title.localeCompare(right.title);
}

export function selectRecentConversationCandidates(
  sessions: SessionMeta[] | null | undefined,
  options: {
    workspaceCwd?: string | null;
    nowMs?: number;
    recentWindowDays?: number | null;
    limit?: number;
    closedOnly?: boolean;
  } = {},
): SessionMeta[] {
  const nowMs = normalizeNowMs(options.nowMs);
  const recentWindowDays = normalizeRecentWindowDays(options.recentWindowDays);
  const recentWindowMs = recentWindowDays === null
    ? null
    : recentWindowDays * DAY_MS;
  const workspaceCwd = normalizePath(options.workspaceCwd);

  return [...(sessions ?? [])]
    .filter((session) => session.messageCount > 0)
    .filter((session) => !options.closedOnly || isClosedConversation(session))
    .filter((session) => workspaceCwd.length === 0 || normalizePath(session.cwd) === workspaceCwd)
    .filter((session) => {
      if (recentWindowMs === null) {
        return true;
      }

      const timestamp = parseConversationTimestamp(session.lastActivityAt ?? session.timestamp);
      return Number.isFinite(timestamp) && nowMs - timestamp <= recentWindowMs;
    })
    .sort((left, right) => compareRecentConversationCandidates(left, right, workspaceCwd))
    .slice(0, normalizePositiveIntegerLimit(options.limit, DEFAULT_CANDIDATE_LIMIT));
}

export function listRecentConversationResults(
  sessions: SessionMeta[] | null | undefined,
  options: {
    workspaceCwd?: string | null;
    summaries?: Record<string, ConversationSummaryRecord>;
    nowMs?: number;
    recentWindowDays?: number | null;
    limit?: number;
    closedOnly?: boolean;
  } = {},
): RelatedConversationSearchResult[] {
  const workspaceCwd = normalizePath(options.workspaceCwd);
  const limit = normalizePositiveIntegerLimit(options.limit, DEFAULT_RECENT_RESULTS_LIMIT);

  return selectRecentConversationCandidates(sessions, {
    ...options,
    recentWindowDays: options.recentWindowDays ?? null,
    limit,
  }).map((session, index) => {
    const summary = options.summaries?.[session.id];
    const sameWorkspace = workspaceCwd.length > 0 && normalizePath(session.cwd) === workspaceCwd;
    const reason = buildReason({ sameWorkspace, matchedTerms: [], summary });
    return {
      sessionId: session.id,
      title: session.title,
      cwd: session.cwd,
      timestamp: session.lastActivityAt ?? session.timestamp,
      snippet: summary?.displaySummary ?? '',
      matchedTerms: [],
      score: (limit - index) + (summary ? 20 : 0),
      sameWorkspace,
      ...(summary ? { summary } : {}),
      ...(reason ? { reason } : {}),
    };
  });
}

export function rankRelatedConversationSessions(input: {
  sessions: SessionMeta[];
  searchIndex: Record<string, string>;
  summaries?: Record<string, ConversationSummaryRecord>;
  query: string;
  workspaceCwd?: string | null;
  limit?: number;
  nowMs?: number;
}): RelatedConversationSearchResult[] {
  const tokens = normalizeQueryTokens(input.query);
  if (tokens.length === 0) {
    return [];
  }

  const workspaceCwd = normalizePath(input.workspaceCwd);
  const nowMs = normalizeNowMs(input.nowMs);
  const limit = normalizePositiveIntegerLimit(input.limit, 9);

  return input.sessions
    .map((session) => {
      const summary = input.summaries?.[session.id];
      const searchText = buildSummarySearchText(session, input.searchIndex[session.id] ?? '', summary);
      const fields = [session.title, session.cwd, searchText];
      let totalScore = 0;
      const matchedTerms: string[] = [];

      totalScore += scorePhrase(input.query, fields[0], 150);
      totalScore += scorePhrase(input.query, fields[2], 120);

      for (const token of tokens) {
        let bestTokenScore: number | null = null;

        const titleScore = scoreField(token, fields[0], 132);
        if (titleScore !== null) {
          bestTokenScore = Math.max(bestTokenScore ?? titleScore, titleScore);
        }

        const cwdScore = scoreField(token, fields[1], 82);
        if (cwdScore !== null) {
          bestTokenScore = Math.max(bestTokenScore ?? cwdScore, cwdScore);
        }

        const searchScore = scoreField(token, fields[2], 96);
        if (searchScore !== null) {
          bestTokenScore = Math.max(bestTokenScore ?? searchScore, searchScore);
        }

        if (bestTokenScore === null) {
          continue;
        }

        totalScore += bestTokenScore;
        matchedTerms.push(token);
      }

      if (matchedTerms.length < minimumMatchedTokenCount(tokens.length)) {
        return null;
      }

      totalScore += matchedTerms.length * 24;

      const timestamp = session.lastActivityAt ?? session.timestamp;
      const sameWorkspace = workspaceCwd.length > 0 && normalizePath(session.cwd) === workspaceCwd;
      if (sameWorkspace) {
        totalScore += 90;
      }
      if (summary) {
        totalScore += 45;
        if (summary.status === 'blocked' || summary.status === 'needs_user' || summary.status === 'in_progress') {
          totalScore += 20;
        }
      }
      totalScore += scoreRecency(timestamp, nowMs);

      const reason = buildReason({ sameWorkspace, matchedTerms, summary });

      return {
        sessionId: session.id,
        title: session.title,
        cwd: session.cwd,
        timestamp,
        snippet: buildSnippet(searchText, session.title, input.query),
        matchedTerms,
        score: totalScore,
        sameWorkspace,
        ...(summary ? { summary } : {}),
        ...(reason ? { reason } : {}),
      } satisfies RelatedConversationSearchResult;
    })
    .filter((result): result is RelatedConversationSearchResult => result !== null)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      if (left.sameWorkspace !== right.sameWorkspace) {
        return left.sameWorkspace ? -1 : 1;
      }

      const timestampCompare = right.timestamp.localeCompare(left.timestamp);
      if (timestampCompare !== 0) {
        return timestampCompare;
      }

      return left.title.localeCompare(right.title);
    })
    .slice(0, limit);
}

export function pickHighConfidenceRelatedConversation(results: RelatedConversationSearchResult[]): RelatedConversationPreselection | null {
  const [first, second] = results;
  if (!first || !first.sameWorkspace || !first.summary) {
    return null;
  }

  const matchedTermCount = first.matchedTerms.length;
  const scoreGap = second ? first.score - second.score : first.score;
  if (matchedTermCount < 2 || first.score < 360 || scoreGap < 70) {
    return null;
  }

  return { sessionId: first.sessionId, confidence: first.score };
}
