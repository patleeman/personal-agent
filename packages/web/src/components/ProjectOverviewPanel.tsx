import { Link } from 'react-router-dom';
import {
  formatProjectStatus,
  getPlanProgress,
  hasMeaningfulBlockers,
  pickCurrentMilestone,
} from '../contextRailProject';
import type { ProjectDetail } from '../types';
import { timeAgo } from '../utils';
import { IconButton, Pill, SurfacePanel, type PillTone } from './ui';

function taskTone(status: string): PillTone {
  switch (status) {
    case 'running':
      return 'accent';
    case 'blocked':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'completed':
      return 'success';
    default:
      return 'muted';
  }
}

function formatTaskStatus(status: string): string {
  const normalized = status.replace(/[-_]+/g, ' ').trim();
  return normalized.length > 0 ? normalized : 'pending';
}

export function ProjectOverviewPanel({
  project,
  onRemove,
  removeDisabled = false,
}: {
  project: ProjectDetail;
  onRemove?: () => void;
  removeDisabled?: boolean;
}) {
  const record = project.project;
  const status = formatProjectStatus(record.status);
  const blockers = record.blockers.filter((blocker) => blocker.trim().length > 0);
  const isBlocked = hasMeaningfulBlockers(record.blockers);
  const currentFocus = record.currentFocus?.trim();
  const recentProgress = record.recentProgress.filter((item) => item.trim().length > 0);

  const { done, total, pct } = getPlanProgress(record.plan.milestones);
  const currentMilestone = pickCurrentMilestone(record.plan);
  const currentMilestoneIndex = currentMilestone
    ? record.plan.milestones.findIndex((milestone) => milestone.id === currentMilestone.id)
    : -1;
  const upcomingMilestones = record.plan.milestones
    .slice(currentMilestoneIndex >= 0 ? currentMilestoneIndex + 1 : 0)
    .filter((milestone) => milestone.status !== 'completed' && milestone.status !== 'cancelled')
    .slice(0, 3);
  const hiddenUpcomingMilestones = Math.max(
    0,
    record.plan.milestones
      .slice(currentMilestoneIndex >= 0 ? currentMilestoneIndex + 1 : 0)
      .filter((milestone) => milestone.status !== 'completed' && milestone.status !== 'cancelled').length - upcomingMilestones.length,
  );
  const remainingMilestones = record.plan.milestones.filter(
    (milestone) => milestone.status !== 'completed' && milestone.status !== 'cancelled',
  ).length;

  const visibleTasks = project.tasks.slice(0, 5);
  const hiddenTasks = Math.max(0, project.tasks.length - visibleTasks.length);

  const showOverview = record.summary.trim().length > 0 || !!currentFocus || blockers.length > 0 || recentProgress.length > 0;
  const showTasksSection = project.taskCount > 0;

  return (
    <SurfacePanel muted className="px-3.5 py-3.5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="muted" mono>{record.id}</Pill>
            <span className="ui-card-meta">updated {timeAgo(record.updatedAt)}</span>
          </div>
          <p className="ui-card-title">{record.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link to={`/projects/${record.id}`} className="ui-action-button text-accent hover:text-accent/80">
            open project
          </Link>
          {onRemove && (
            <IconButton
              onClick={onRemove}
              disabled={removeDisabled}
              compact
              title={`Detach ${record.id}`}
              aria-label={`Detach ${record.id}`}
            >
              ×
            </IconButton>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={isBlocked ? 'warning' : 'teal'}>{status}</Pill>
        <Pill tone="muted">{project.taskCount} {project.taskCount === 1 ? 'task' : 'tasks'}</Pill>
        <Pill tone="muted">{remainingMilestones} {remainingMilestones === 1 ? 'milestone left' : 'milestones left'}</Pill>
        <Pill tone="muted">{project.artifactCount} artifacts</Pill>
      </div>

      {showOverview && (
        <div className="rounded-xl border border-border-subtle bg-base/70 px-3.5 py-3.5 space-y-3">
          <p className="ui-section-label">Overview</p>

          {record.summary.trim().length > 0 && (
            <div>
              <p className="ui-card-meta mb-1.5">Summary</p>
              <p className="ui-card-body">{record.summary}</p>
            </div>
          )}

          {currentFocus && (
            <div className={record.summary.trim().length > 0 ? 'border-t border-border-subtle pt-3' : ''}>
              <p className="ui-card-meta mb-1.5">Current focus</p>
              <p className="ui-card-body">{currentFocus}</p>
            </div>
          )}

          {blockers.length > 0 && (
            <div className={(record.summary.trim().length > 0 || currentFocus) ? 'border-t border-border-subtle pt-3' : ''}>
              <p className="ui-card-meta mb-1.5">Blocked by</p>
              <ul className="space-y-1.5">
                {blockers.map((blocker) => (
                  <li key={blocker} className="ui-card-body text-warning">⚠ {blocker}</li>
                ))}
              </ul>
            </div>
          )}

          {recentProgress.length > 0 && (
            <div className={(record.summary.trim().length > 0 || currentFocus || blockers.length > 0) ? 'border-t border-border-subtle pt-3' : ''}>
              <p className="ui-card-meta mb-2">Recent progress</p>
              <ul className="space-y-1.5">
                {recentProgress.slice(0, 4).map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[12px] leading-relaxed text-dim">
                    <span className="mt-[2px] shrink-0 text-success">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {recentProgress.length > 4 && <p className="ui-card-meta mt-2">+{recentProgress.length - 4} more updates in the full project view</p>}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-border-subtle pt-3">
        <div className="flex items-start justify-between mb-2 gap-3">
          <div>
            <p className="ui-section-label">Milestones</p>
            <p className="ui-card-meta mt-1">High-level milestones from PROJECT.yaml</p>
          </div>
          <Pill tone="muted" mono>{done}/{total} · {pct}%</Pill>
        </div>
        <div className="h-1 rounded-full bg-base overflow-hidden mb-3">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>

        {currentMilestone && (
          <div className="rounded-xl border border-border-subtle bg-base/70 px-3 py-3">
            <p className="ui-card-meta mb-1.5">Current milestone</p>
            <p className="ui-card-body">{currentMilestone.title}</p>
            {currentMilestone.summary && <p className="ui-card-meta mt-1.5 break-words">{currentMilestone.summary}</p>}
          </div>
        )}

        {upcomingMilestones.length > 0 && (
          <div className="mt-3">
            <p className="ui-card-meta mb-2">Coming up</p>
            <div className="space-y-2">
              {upcomingMilestones.map((milestone, index) => (
                <div key={milestone.id} className="rounded-lg border border-border-subtle bg-base/50 px-3 py-2.5">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-[1px] inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border-subtle px-1.5 text-[10px] font-mono text-dim">
                      {index + 2}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] leading-relaxed text-secondary">{milestone.title}</p>
                      {milestone.summary && <p className="ui-card-meta mt-1 break-words">{milestone.summary}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!currentMilestone && total > 0 && <p className="ui-card-meta">All milestones complete.</p>}
        {total === 0 && <p className="ui-card-meta">No milestones yet.</p>}

        {(hiddenUpcomingMilestones > 0 || done > 0) && (
          <div className="mt-3 space-y-1">
            {hiddenUpcomingMilestones > 0 && <p className="ui-card-meta">+{hiddenUpcomingMilestones} more milestones in the full project view</p>}
            {done > 0 && <p className="ui-card-meta">{done} completed {done === 1 ? 'milestone' : 'milestones'}</p>}
          </div>
        )}
      </div>

      {showTasksSection && (
        <div className="border-t border-border-subtle pt-3">
          <div className="flex items-start justify-between mb-2 gap-3">
            <div>
              <p className="ui-section-label">Tasks</p>
              <p className="ui-card-meta mt-1">Execution tasks attached to milestones in PROJECT.yaml</p>
            </div>
            <Pill tone="muted" mono>{project.taskCount}</Pill>
          </div>

          <ul className="space-y-2.5">
            {visibleTasks.map((task) => (
              <li key={task.id} className="rounded-lg border border-border-subtle bg-base/80 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-[12px] font-medium text-primary leading-relaxed">{task.title}</p>
                    <p className="ui-card-meta">milestone: {task.milestoneId}</p>
                  </div>
                  <Pill tone={taskTone(task.status)}>{formatTaskStatus(task.status)}</Pill>
                </div>
              </li>
            ))}
          </ul>

          {hiddenTasks > 0 && <p className="ui-card-meta mt-2">+{hiddenTasks} more tasks in the full project view</p>}
        </div>
      )}
    </SurfacePanel>
  );
}
