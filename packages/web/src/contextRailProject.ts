import type { ProjectPlanStep } from './types';
import { stripMarkdownListMarker } from './utils';

export function pickFocusedProjectId(
  linkedProjectIds: string[],
  currentFocusedProjectId?: string | null,
): string {
  if (currentFocusedProjectId && linkedProjectIds.includes(currentFocusedProjectId)) {
    return currentFocusedProjectId;
  }

  return linkedProjectIds[0] ?? '';
}

export function pickAttachProjectId(
  availableProjectIds: string[],
  currentAttachProjectId?: string | null,
): string {
  if (currentAttachProjectId && availableProjectIds.includes(currentAttachProjectId)) {
    return currentAttachProjectId;
  }

  return availableProjectIds[0] ?? '';
}

export function normalizeProjectText(value: string | undefined): string {
  return stripMarkdownListMarker(value)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_]+/g, '')
    .trim();
}

export function parseProjectListItems(value: string | undefined): string[] {
  if (!value || value.trim().length === 0) {
    return [];
  }

  return value
    .split('\n')
    .map((line) => normalizeProjectText(line))
    .filter((line) => line.length > 0 && line.toLowerCase() !== 'none');
}

export function hasMeaningfulBlockers(blockers: string | undefined): boolean {
  const normalized = normalizeProjectText(blockers).toLowerCase();
  return normalized.length > 0 && normalized !== 'none';
}

export function summarizeProjectPreview(currentPlan: string | undefined, blockers: string | undefined): string {
  const plan = normalizeProjectText(currentPlan);
  if (plan.length > 0 && plan.toLowerCase() !== 'none') {
    return plan;
  }

  if (hasMeaningfulBlockers(blockers)) {
    return `Blocked: ${normalizeProjectText(blockers)}`;
  }

  return 'No plan summary yet.';
}

export function getPlanProgress(steps: ProjectPlanStep[]): {
  done: number;
  total: number;
  pct: number;
} {
  const total = steps.length;
  const done = steps.filter((step) => step.completed).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return { done, total, pct };
}
