import type { WorkstreamPlanStep } from './types';
import { stripMarkdownListMarker } from './utils';

export function pickFocusedWorkstreamId(
  linkedWorkstreamIds: string[],
  currentFocusedWorkstreamId?: string | null,
): string {
  if (currentFocusedWorkstreamId && linkedWorkstreamIds.includes(currentFocusedWorkstreamId)) {
    return currentFocusedWorkstreamId;
  }

  return linkedWorkstreamIds[0] ?? '';
}

export function pickAttachWorkstreamId(
  availableWorkstreamIds: string[],
  currentAttachWorkstreamId?: string | null,
): string {
  if (currentAttachWorkstreamId && availableWorkstreamIds.includes(currentAttachWorkstreamId)) {
    return currentAttachWorkstreamId;
  }

  return availableWorkstreamIds[0] ?? '';
}

export function normalizeWorkstreamText(value: string | undefined): string {
  return stripMarkdownListMarker(value)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_]+/g, '')
    .trim();
}

export function hasMeaningfulBlockers(blockers: string | undefined): boolean {
  const normalized = normalizeWorkstreamText(blockers).toLowerCase();
  return normalized.length > 0 && normalized !== 'none';
}

export function summarizeWorkstreamPreview(currentPlan: string | undefined, blockers: string | undefined): string {
  const plan = normalizeWorkstreamText(currentPlan);
  if (plan.length > 0 && plan.toLowerCase() !== 'none') {
    return plan;
  }

  if (hasMeaningfulBlockers(blockers)) {
    return `Blocked: ${normalizeWorkstreamText(blockers)}`;
  }

  return 'No plan summary yet.';
}

export function getPlanProgress(steps: WorkstreamPlanStep[]): {
  done: number;
  total: number;
  pct: number;
} {
  const total = steps.length;
  const done = steps.filter((step) => step.completed).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return { done, total, pct };
}
