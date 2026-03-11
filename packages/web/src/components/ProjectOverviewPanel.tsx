import { Link } from 'react-router-dom';
import {
  getPlanProgress,
  hasMeaningfulBlockers,
  normalizeProjectText,
  parseProjectListItems,
  summarizeProjectPreview,
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
  const status = normalizeProjectText(project.summary.status);
  const blockers = normalizeProjectText(project.summary.blockers);
  const isBlocked = hasMeaningfulBlockers(project.summary.blockers);
  const preview = summarizeProjectPreview(project.summary.currentPlan, project.summary.blockers);
  const completedItems = parseProjectListItems(project.summary.completedItems);
  const openTaskFallback = parseProjectListItems(project.summary.openTasks);
  const summaryTasks = project.taskCount > 0 ? project.taskCount : openTaskFallback.length;

  const { done, total, pct } = getPlanProgress(project.plan.steps);
  const visibleSteps = project.plan.steps.slice(0, 6);
  const hiddenSteps = Math.max(0, total - visibleSteps.length);

  const visibleTasks = project.tasks.slice(0, 6);
  const hiddenTasks = Math.max(0, project.tasks.length - visibleTasks.length);
  const visibleFallbackTasks = project.tasks.length === 0 ? openTaskFallback.slice(0, 6) : [];
  const hiddenFallbackTasks = project.tasks.length === 0 ? Math.max(0, openTaskFallback.length - visibleFallbackTasks.length) : 0;
  const visibleCompletedItems = completedItems.slice(0, 3);
  const hiddenCompletedItems = Math.max(0, completedItems.length - visibleCompletedItems.length);

  return (
    <SurfacePanel muted className="px-3.5 py-3.5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="muted" mono>{project.id}</Pill>
            <span className="ui-card-meta">updated {timeAgo(project.summary.updatedAt)}</span>
          </div>
          <div className="min-w-0 space-y-1.5">
            <p className="ui-card-title">{project.summary.objective}</p>
            <p className="ui-card-body">{preview}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link to={`/projects/${project.id}`} className="ui-action-button text-accent hover:text-accent/80">
            open project
          </Link>
          {onRemove && (
            <IconButton
              onClick={onRemove}
              disabled={removeDisabled}
              compact
              title={`Detach ${project.id}`}
              aria-label={`Detach ${project.id}`}
            >
              ×
            </IconButton>
          )}
        </div>
      </div>

      <div className="border-t border-border-subtle pt-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="ui-section-label">Summary</p>
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <Pill tone={isBlocked ? 'warning' : 'teal'}>{status}</Pill>
            <Pill tone="muted">{summaryTasks} {summaryTasks === 1 ? 'task' : 'tasks'}</Pill>
            <Pill tone="muted">{project.artifactCount} artifacts</Pill>
          </div>
        </div>

        {isBlocked && <p className="ui-card-body text-warning">⚠ {blockers}</p>}

        {visibleCompletedItems.length > 0 && (
          <div>
            <p className="ui-card-meta mb-2">Recently completed</p>
            <ul className="space-y-1.5">
              {visibleCompletedItems.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[12px] leading-relaxed text-dim">
                  <span className="mt-[2px] shrink-0 text-success">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            {hiddenCompletedItems > 0 && <p className="ui-card-meta mt-2">+{hiddenCompletedItems} more completed items</p>}
          </div>
        )}
      </div>

      <div className="border-t border-border-subtle pt-3">
        <div className="flex items-center justify-between mb-2 gap-3">
          <p className="ui-section-label">Plan</p>
          <Pill tone="muted" mono>{done}/{total} · {pct}%</Pill>
        </div>
        <div className="h-1 rounded-full bg-base overflow-hidden mb-3">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        {visibleSteps.length > 0 ? (
          <ul className="space-y-2">
            {visibleSteps.map((step, index) => (
              <li key={index} className="flex items-start gap-2.5 text-[12px] leading-relaxed">
                <span className={`mt-[2px] shrink-0 ${step.completed ? 'text-success' : 'text-dim'}`}>
                  {step.completed ? '✓' : '○'}
                </span>
                <span className={step.completed ? 'text-dim line-through' : 'text-secondary'}>{step.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ui-card-meta">No project plan yet.</p>
        )}
        {hiddenSteps > 0 && <p className="ui-card-meta mt-2">+{hiddenSteps} more steps in the full project view</p>}
      </div>

      <div className="border-t border-border-subtle pt-3">
        <div className="flex items-center justify-between mb-2 gap-3">
          <p className="ui-section-label">Tasks</p>
          <Pill tone="muted" mono>{summaryTasks}</Pill>
        </div>

        {visibleTasks.length > 0 && (
          <ul className="space-y-2.5">
            {visibleTasks.map((task) => (
              <li key={task.id} className="rounded-lg border border-border-subtle bg-base/80 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-[12px] font-medium text-primary leading-relaxed">{task.title}</p>
                    {task.summary && <p className="ui-card-meta break-words">{task.summary}</p>}
                  </div>
                  <Pill tone={taskTone(task.status)}>{formatTaskStatus(task.status)}</Pill>
                </div>
              </li>
            ))}
          </ul>
        )}

        {visibleTasks.length === 0 && visibleFallbackTasks.length > 0 && (
          <ul className="space-y-2">
            {visibleFallbackTasks.map((task) => (
              <li key={task} className="flex items-start gap-2.5 text-[12px] leading-relaxed text-secondary">
                <span className="mt-[2px] shrink-0 text-dim">○</span>
                <span>{task}</span>
              </li>
            ))}
          </ul>
        )}

        {summaryTasks === 0 && <p className="ui-card-meta">No project tasks yet.</p>}
        {hiddenTasks > 0 && <p className="ui-card-meta mt-2">+{hiddenTasks} more tasks in the full project view</p>}
        {hiddenFallbackTasks > 0 && <p className="ui-card-meta mt-2">+{hiddenFallbackTasks} more tasks in the summary</p>}
      </div>
    </SurfacePanel>
  );
}
