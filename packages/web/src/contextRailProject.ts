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

export function formatProjectStatus(status: string | undefined): string {
  switch ((status ?? '').trim()) {
    case 'active': return 'active';
    case 'paused': return 'paused';
    case 'done': return 'done';
    case 'created': return 'active';
    case 'in_progress': return 'active';
    case 'blocked': return 'paused';
    case 'completed': return 'done';
    case 'cancelled': return 'done';
    default: {
      const normalized = (status ?? '').replace(/[-_]+/g, ' ').trim();
      return normalized.length > 0 ? normalized : 'unknown';
    }
  }
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

export function summarizeProjectPreview(project: Pick<ProjectRecord, 'summary' | 'description'>): string {
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
