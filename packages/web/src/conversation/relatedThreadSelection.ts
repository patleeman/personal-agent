import type { ConversationSummaryRecord, SessionMeta } from '../shared/types';
import type { RelatedConversationSearchResult } from './relatedConversationSearch';

const MIN_AUTO_PRESELECT_QUERY_LENGTH = 3;

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
    if (results.length >= input.limit) {
      break;
    }
  }

  return results.slice(0, input.limit);
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
  const autoSelectedSet = new Set(input.autoSelectedThreadIds);
  const hasManualSelection = input.selectedThreadIds.some((sessionId) => !autoSelectedSet.has(sessionId));
  const onlyAutoSelected = input.selectedThreadIds.length > 0 && !hasManualSelection;

  if (!input.draft || input.query.trim().length < MIN_AUTO_PRESELECT_QUERY_LENGTH) {
    if (onlyAutoSelected) {
      return { selectedThreadIds: [], autoSelectedThreadIds: [], changed: true };
    }
    return {
      selectedThreadIds: input.selectedThreadIds,
      autoSelectedThreadIds: input.autoSelectedThreadIds,
      changed: false,
    };
  }

  const autoSelectedThreadIds = input.searchResults
    .slice(0, Math.max(0, input.maxAutoSelections))
    .map((result) => result.sessionId);

  if (autoSelectedThreadIds.length === 0) {
    if (onlyAutoSelected) {
      return { selectedThreadIds: [], autoSelectedThreadIds: [], changed: true };
    }
    return {
      selectedThreadIds: input.selectedThreadIds,
      autoSelectedThreadIds: input.autoSelectedThreadIds,
      changed: false,
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
