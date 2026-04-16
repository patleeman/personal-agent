import { fuzzyScore } from '../commands/slashMenu';
import type { SessionMeta } from '../shared/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RECENT_WINDOW_DAYS = 7;
const DEFAULT_CANDIDATE_LIMIT = 48;
const DEFAULT_RECENT_RESULTS_LIMIT = 10;
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
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  const ageDays = Math.max(0, (nowMs - parsed) / DAY_MS);
  return Math.max(0, Math.round(42 - ageDays * 5));
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

  const leftTimestamp = left.lastActivityAt ?? left.timestamp;
  const rightTimestamp = right.lastActivityAt ?? right.timestamp;
  const timestampCompare = rightTimestamp.localeCompare(leftTimestamp);
  if (timestampCompare !== 0) {
    return timestampCompare;
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
  const nowMs = options.nowMs ?? Date.now();
  const recentWindowDays = options.recentWindowDays === undefined
    ? DEFAULT_RECENT_WINDOW_DAYS
    : options.recentWindowDays;
  const recentWindowMs = recentWindowDays === null
    ? null
    : recentWindowDays * DAY_MS;
  const workspaceCwd = normalizePath(options.workspaceCwd);

  return [...(sessions ?? [])]
    .filter((session) => session.messageCount > 0)
    .filter((session) => !options.closedOnly || isClosedConversation(session))
    .filter((session) => {
      if (recentWindowMs === null) {
        return true;
      }

      const timestamp = Date.parse(session.lastActivityAt ?? session.timestamp);
      return Number.isFinite(timestamp) && nowMs - timestamp <= recentWindowMs;
    })
    .sort((left, right) => compareRecentConversationCandidates(left, right, workspaceCwd))
    .slice(0, Math.max(1, options.limit ?? DEFAULT_CANDIDATE_LIMIT));
}

export function listRecentConversationResults(
  sessions: SessionMeta[] | null | undefined,
  options: {
    workspaceCwd?: string | null;
    nowMs?: number;
    recentWindowDays?: number | null;
    limit?: number;
    closedOnly?: boolean;
  } = {},
): RelatedConversationSearchResult[] {
  const workspaceCwd = normalizePath(options.workspaceCwd);
  const limit = Math.max(1, options.limit ?? DEFAULT_RECENT_RESULTS_LIMIT);

  return selectRecentConversationCandidates(sessions, {
    ...options,
    recentWindowDays: options.recentWindowDays ?? null,
    limit,
  }).map((session, index) => ({
    sessionId: session.id,
    title: session.title,
    cwd: session.cwd,
    timestamp: session.lastActivityAt ?? session.timestamp,
    snippet: '',
    matchedTerms: [],
    score: limit - index,
    sameWorkspace: workspaceCwd.length > 0 && normalizePath(session.cwd) === workspaceCwd,
  }));
}

export function rankRelatedConversationSessions(input: {
  sessions: SessionMeta[];
  searchIndex: Record<string, string>;
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
  const nowMs = input.nowMs ?? Date.now();
  const limit = Math.max(1, input.limit ?? 9);

  return input.sessions
    .map((session) => {
      const searchText = input.searchIndex[session.id] ?? '';
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
      totalScore += scoreRecency(timestamp, nowMs);

      return {
        sessionId: session.id,
        title: session.title,
        cwd: session.cwd,
        timestamp,
        snippet: buildSnippet(searchText, session.title, input.query),
        matchedTerms,
        score: totalScore,
        sameWorkspace,
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
