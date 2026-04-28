import type { ConversationSummaryRecord, SessionMeta } from '../shared/types';
import type { RelatedConversationSearchResult } from './relatedConversationSearch';

const MIN_AUTO_PRESELECT_QUERY_LENGTH = 3;
const MAX_VISIBLE_RELATED_THREAD_RESULTS = 100;
const MAX_AUTO_RELATED_THREAD_SELECTIONS = 5;

function normalizeVisibleRelatedThreadLimit(value: number): number {
  return Number.isSafeInteger(value) && value >= 0
    ? Math.min(MAX_VISIBLE_RELATED_THREAD_RESULTS, value)
    : 0;
}

export function buildRelatedThreadCandidateLookup(candidates: SessionMeta[]): {
  candidateById: Map<string, SessionMeta>;
  candidateIds: string[];
} {
  return {
    candidateById: new Map(candidates.map((session) => [session.id, session] as const)),
    candidateIds: candidates.map((session) => session.id),
  };
}

export function selectVisibleRelatedThreadResults(input: {
  selectedRelatedThreadIds: string[];
  query: string;
  searchResults: RelatedConversationSearchResult[];
  recentResults: RelatedConversationSearchResult[];
  candidateById: Map<string, SessionMeta>;
  searchIndex: Record<string, string>;
  summaries: Record<string, ConversationSummaryRecord>;
  workspaceCwd: string | null;
  limit: number;
}): RelatedConversationSearchResult[] {
  const limit = normalizeVisibleRelatedThreadLimit(input.limit);
  const baseResults = input.query.trim().length > 0
    ? input.searchResults
    : input.recentResults;
  const results: RelatedConversationSearchResult[] = [];
  const seen = new Set<string>();

  for (const sessionId of input.selectedRelatedThreadIds) {
    if (seen.has(sessionId)) {
      continue;
    }

    const existing = baseResults.find((result) => result.sessionId === sessionId);
    if (existing) {
      results.push(existing);
      seen.add(sessionId);
      continue;
    }

    const session = input.candidateById.get(sessionId);
    if (!session) {
      continue;
    }

    const normalizedSnippet = (input.searchIndex[sessionId] ?? '').replace(/\s+/g, ' ').trim();
    const summary = input.summaries[sessionId];
    const snippet = normalizedSnippet.length > 140
      ? `${normalizedSnippet.slice(0, 139).trimEnd()}…`
      : normalizedSnippet;
    const sameWorkspace = Boolean(input.workspaceCwd && session.cwd === input.workspaceCwd);
    results.push({
      sessionId,
      title: session.title,
      cwd: session.cwd,
      timestamp: session.lastActivityAt ?? session.timestamp,
      snippet: summary?.displaySummary ?? snippet,
      matchedTerms: [],
      score: Number.MAX_SAFE_INTEGER - results.length,
      sameWorkspace,
      ...(summary ? { summary, reason: sameWorkspace ? 'Same workspace' : undefined } : {}),
    });
    seen.add(sessionId);
  }

  for (const result of baseResults) {
    if (seen.has(result.sessionId)) {
      continue;
    }

    results.push(result);
    seen.add(result.sessionId);
    if (results.length >= limit) {
      break;
    }
  }

  return results.slice(0, limit);
}

export function toggleRelatedThreadSelectionIds(input: {
  current: string[];
  sessionId: string;
  maxSelections: number;
}): {
  next: string[];
  rejected: boolean;
} {
  if (input.current.includes(input.sessionId)) {
    return {
      next: input.current.filter((candidate) => candidate !== input.sessionId),
      rejected: false,
    };
  }

  if (input.current.length >= input.maxSelections) {
    return { next: input.current, rejected: true };
  }

  return { next: [...input.current, input.sessionId], rejected: false };
}

export function pruneRelatedThreadSelectionIds(
  current: string[],
  candidateById: ReadonlyMap<string, unknown>,
): string[] {
  return current.filter((sessionId) => candidateById.has(sessionId));
}

export function selectMissingRelatedThreadSearchIndexIds(input: {
  draft: boolean;
  inputText: string;
  selectedThreadIds: string[];
  candidateIds: string[];
  searchIndex: Record<string, string>;
}): string[] {
  if (
    !input.draft
    || (input.inputText.trim().length === 0 && input.selectedThreadIds.length === 0)
    || input.candidateIds.length === 0
  ) {
    return [];
  }

  return input.candidateIds.filter((sessionId) => input.searchIndex[sessionId] === undefined);
}

export function selectMissingRelatedThreadSummaryIds(input: {
  draft: boolean;
  candidateIds: string[];
  summaries: Record<string, ConversationSummaryRecord>;
}): string[] {
  if (!input.draft || input.candidateIds.length === 0) {
    return [];
  }

  return input.candidateIds.filter((sessionId) => input.summaries[sessionId] === undefined);
}

export function resolveRelatedThreadPreselectionUpdate(input: {
  draft: boolean;
  query: string;
  selectedThreadIds: string[];
  autoSelectedThreadIds: string[];
  searchResults: RelatedConversationSearchResult[];
  maxAutoSelections: number;
}): {
  selectedThreadIds: string[];
  autoSelectedThreadIds: string[];
  changed: boolean;
} {
  const selectedSet = new Set(input.selectedThreadIds);
  const autoSelectedSet = new Set(input.autoSelectedThreadIds);
  const maxAutoSelections = Number.isSafeInteger(input.maxAutoSelections) && input.maxAutoSelections >= 0
    ? Math.min(MAX_AUTO_RELATED_THREAD_SELECTIONS, input.maxAutoSelections)
    : 0;
  const hasManualSelection = input.selectedThreadIds.some((sessionId) => !autoSelectedSet.has(sessionId));
  const prunedAutoSelectedThreadIds = input.autoSelectedThreadIds.filter((sessionId) => selectedSet.has(sessionId));
  const clearAutoSelections = () => ({
    selectedThreadIds: input.selectedThreadIds.filter((sessionId) => !autoSelectedSet.has(sessionId)),
    autoSelectedThreadIds: [],
    changed: input.autoSelectedThreadIds.length > 0,
  });

  if (input.selectedThreadIds.length === 0 && input.autoSelectedThreadIds.length > 0) {
    return { selectedThreadIds: [], autoSelectedThreadIds: [], changed: true };
  }

  if (!input.draft || input.query.trim().length < MIN_AUTO_PRESELECT_QUERY_LENGTH) {
    if (input.autoSelectedThreadIds.length > 0) {
      return clearAutoSelections();
    }
    return {
      selectedThreadIds: input.selectedThreadIds,
      autoSelectedThreadIds: input.autoSelectedThreadIds,
      changed: false,
    };
  }

  const autoSelectedThreadIds = input.searchResults
    .slice(0, maxAutoSelections)
    .map((result) => result.sessionId);

  if (autoSelectedThreadIds.length === 0) {
    if (input.autoSelectedThreadIds.length > 0) {
      return clearAutoSelections();
    }
    return {
      selectedThreadIds: input.selectedThreadIds,
      autoSelectedThreadIds: input.autoSelectedThreadIds,
      changed: false,
    };
  }

  if (prunedAutoSelectedThreadIds.length !== input.autoSelectedThreadIds.length) {
    return {
      selectedThreadIds: input.selectedThreadIds,
      autoSelectedThreadIds: prunedAutoSelectedThreadIds,
      changed: true,
    };
  }

  if (
    autoSelectedThreadIds.length === input.autoSelectedThreadIds.length
    && autoSelectedThreadIds.every((sessionId, index) => sessionId === input.autoSelectedThreadIds[index])
  ) {
    return {
      selectedThreadIds: input.selectedThreadIds,
      autoSelectedThreadIds: input.autoSelectedThreadIds,
      changed: false,
    };
  }

  if (hasManualSelection) {
    return {
      selectedThreadIds: input.selectedThreadIds,
      autoSelectedThreadIds: input.autoSelectedThreadIds,
      changed: false,
    };
  }

  return {
    selectedThreadIds: autoSelectedThreadIds,
    autoSelectedThreadIds,
    changed: true,
  };
}
