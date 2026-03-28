import type { ProjectMilestone, ProjectPlan, ProjectRecord } from './types';

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

function normalizeStatusLabel(status: string | undefined): string {
  return (status ?? '').replace(/[-_]+/g, ' ').trim().toLowerCase();
}

export function bucketProjectStatus(status: string | undefined): 'active' | 'paused' | 'done' | 'unknown' {
  switch (normalizeStatusLabel(status)) {
    case 'active':
    case 'created':
    case 'in progress':
    case 'pending':
      return 'active';
    case 'paused':
    case 'blocked':
      return 'paused';
    case 'done':
    case 'completed':
    case 'cancelled':
      return 'done';
    default:
      return normalizeStatusLabel(status) ? 'unknown' : 'unknown';
  }
}

export function formatProjectStatus(status: string | undefined): string {
  const normalized = normalizeStatusLabel(status);
  return normalized.length > 0 ? normalized : 'unknown';
}

export function isProjectArchived(project: Pick<ProjectRecord, 'archivedAt'>): boolean {
  return Boolean(project.archivedAt?.trim());
}

export function hasMeaningfulBlockers(blockers: string[] | undefined): boolean {
  return (blockers ?? []).some((blocker) => blocker.trim().length > 0);
}

function isActiveMilestoneStatus(status: string): boolean {
  return status === 'in_progress' || status === 'blocked';
}

function isClosedMilestoneStatus(status: string): boolean {
  return status === 'completed' || status === 'cancelled';
}

export function pickCurrentMilestone(plan: ProjectPlan): ProjectMilestone | undefined {
  if (plan.currentMilestoneId) {
    const explicitMilestone = plan.milestones.find((milestone) => milestone.id === plan.currentMilestoneId);
    if (explicitMilestone) {
      return explicitMilestone;
    }
  }

  const activeMilestone = plan.milestones.find((milestone) => isActiveMilestoneStatus(milestone.status));
  if (activeMilestone) {
    return activeMilestone;
  }

  const nextMilestone = plan.milestones.find((milestone) => !isClosedMilestoneStatus(milestone.status));
  if (nextMilestone) {
    return nextMilestone;
  }

  return plan.milestones[0];
}

export function summarizeProjectPreview(project: Pick<ProjectRecord, 'currentFocus' | 'summary' | 'description'>): string {
  const currentFocus = project.currentFocus?.trim();
  if (currentFocus) {
    return currentFocus;
  }

  const summary = project.summary.trim();
  if (summary.length > 0) {
    return summary;
  }

  const description = project.description.trim();
  if (description.length > 0) {
    return description;
  }

  return 'No summary yet.';
}

export function getPlanProgress(milestones: ProjectMilestone[]): {
  done: number;
  total: number;
  pct: number;
} {
  const total = milestones.length;
  const done = milestones.filter((milestone) => milestone.status === 'completed').length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return { done, total, pct };
}
