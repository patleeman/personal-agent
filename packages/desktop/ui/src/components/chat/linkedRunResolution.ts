import {
  getRunHeadline,
  getRunMoment,
  getRunTaskSlug,
  isRunActive,
  type RunPresentationLookups,
} from '../../automation/runPresentation';
import type { DurableRunRecord } from '../../shared/types';
import { type LinkedRunPresentation, normalizeRunLabel } from './linkedRuns.js';

export function extractLinkedTaskSlugFromRunId(runId: string): string | null {
  const normalized = runId.trim();
  if (!normalized.startsWith('run-')) {
    return null;
  }

  const timestampIndex = normalized.search(/-\d{4}-\d{2}-\d{2}T/i);
  if (timestampIndex <= 4) {
    return null;
  }

  const taskSlug = normalized.slice(4, timestampIndex).trim();
  return taskSlug.length > 0 ? taskSlug : null;
}

export function pickBestResolvedLinkedRunCandidate(candidates: DurableRunRecord[]): DurableRunRecord | null {
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    const leftActive = isRunActive(left) ? 1 : 0;
    const rightActive = isRunActive(right) ? 1 : 0;
    if (leftActive !== rightActive) {
      return rightActive - leftActive;
    }

    const leftAt = getRunMoment(left).at ?? '';
    const rightAt = getRunMoment(right).at ?? '';
    return rightAt.localeCompare(leftAt) || left.runId.localeCompare(right.runId);
  })[0] ?? null;
}

export function resolveLinkedRunRecord(
  linkedRun: LinkedRunPresentation,
  runs: DurableRunRecord[] | null | undefined,
  lookups: RunPresentationLookups,
): DurableRunRecord | null {
  if (!runs || runs.length === 0) {
    return null;
  }

  const exactMatch = runs.find((candidate) => candidate.runId === linkedRun.runId);
  if (exactMatch) {
    return exactMatch;
  }

  const linkedTaskSlug = extractLinkedTaskSlugFromRunId(linkedRun.runId);
  if (linkedTaskSlug) {
    const linkedTaskSlugNormalized = normalizeRunLabel(linkedTaskSlug);
    const taskSlugMatches = runs.filter((candidate) => {
      const candidateTaskSlug = getRunTaskSlug(candidate);
      return candidateTaskSlug ? normalizeRunLabel(candidateTaskSlug) === linkedTaskSlugNormalized : false;
    });

    const taskSlugResolved = pickBestResolvedLinkedRunCandidate(taskSlugMatches);
    if (taskSlugResolved) {
      return taskSlugResolved;
    }
  }

  const linkedTitleNormalized = normalizeRunLabel(linkedRun.title);
  if (linkedTitleNormalized) {
    const titleMatches = runs.filter((candidate) => {
      const candidateHeadline = getRunHeadline(candidate, lookups);
      return normalizeRunLabel(candidateHeadline.title) === linkedTitleNormalized;
    });

    const titleResolved = pickBestResolvedLinkedRunCandidate(titleMatches);
    if (titleResolved) {
      return titleResolved;
    }
  }

  return null;
}
