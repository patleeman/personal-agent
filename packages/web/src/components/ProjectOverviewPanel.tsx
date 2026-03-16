import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import {
  formatProjectStatus,
  getPlanProgress,
  hasMeaningfulBlockers,
  isProjectArchived,
  pickCurrentMilestone,
} from '../contextRailProject';
import { parseProjectDocument } from '../projectDocument';
import type { ProjectDetail } from '../types';
import { timeAgo } from '../utils';
import { IconButton, Pill, SurfacePanel, type PillTone } from './ui';

function taskTone(status: string): PillTone {
  switch (status) {
    case 'running':
    case 'in_progress':
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

function taskPriority(status: string): number {
  switch (status) {
    case 'blocked':
      return 0;
    case 'in_progress':
      return 1;
    case 'pending':
      return 2;
    case 'completed':
      return 3;
    case 'cancelled':
      return 4;
    default:
      return 5;
  }
}

function MarkdownSection({ content }: { content: string }) {
  return (
    <div className="ui-markdown max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{content}</ReactMarkdown>
    </div>
  );
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
  const acceptanceCriteria = record.requirements.acceptanceCriteria.filter((item) => item.trim().length > 0);
  const isArchived = isProjectArchived(record);
  const isBlocked = hasMeaningfulBlockers(record.blockers);
  const currentFocus = record.currentFocus?.trim();
  const description = record.description.trim();
  const goal = record.requirements.goal.trim();
  const projectRepoRoot = record.repoRoot?.trim();
  const listSummary = record.summary.trim();
  const recentProgress = record.recentProgress.filter((item) => item.trim().length > 0);
  const projectDocument = parseProjectDocument(project.brief?.content ?? '');
  const requirementsContent = goal || projectDocument.requirements.trim();
  const planContent = (record.planSummary ?? '').trim() || projectDocument.plan.trim();
  const completionContent = (record.completionSummary ?? '').trim() || projectDocument.completionSummary.trim();
  const visibleAcceptanceCriteria = acceptanceCriteria.slice(0, 4);
  const hiddenAcceptanceCriteria = Math.max(0, acceptanceCriteria.length - visibleAcceptanceCriteria.length);
  const visibleProgress = recentProgress.slice(0, 4);
  const hiddenProgress = Math.max(0, recentProgress.length - visibleProgress.length);

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

  const prioritizedTasks = [...project.tasks].sort((left, right) => taskPriority(left.status) - taskPriority(right.status));
  const visibleTasks = prioritizedTasks.slice(0, 5);
  const hiddenTasks = Math.max(0, project.tasks.length - visibleTasks.length);

  const metricParts = [
    `${record.plan.milestones.length} ${record.plan.milestones.length === 1 ? 'milestone' : 'milestones'}`,
    `${project.taskCount} ${project.taskCount === 1 ? 'task' : 'tasks'}`,
    ...(project.noteCount > 0 ? [`${project.noteCount} ${project.noteCount === 1 ? 'note' : 'notes'}`] : []),
    ...(project.attachmentCount > 0 ? [`${project.attachmentCount} ${project.attachmentCount === 1 ? 'attachment' : 'attachments'}`] : []),
    ...(project.artifactCount > 0 ? [`${project.artifactCount} ${project.artifactCount === 1 ? 'artifact' : 'artifacts'}`] : []),
    ...(project.linkedConversations.length > 0
      ? [`${project.linkedConversations.length} ${project.linkedConversations.length === 1 ? 'conversation' : 'conversations'}`]
      : []),
  ];

  const showSummaryLead = listSummary.length > 0 && listSummary !== description && listSummary !== currentFocus;
  const showRequirementsSection = requirementsContent.length > 0 || acceptanceCriteria.length > 0;
  const showPlanSection = planContent.length > 0 || showSummaryLead || blockers.length > 0 || recentProgress.length > 0;
  const showTasksSection = project.taskCount > 0;
  const showCompletionSection = completionContent.length > 0;

  return (
    <SurfacePanel muted className="overflow-hidden">
      <div className="px-3.5 py-3.5 space-y-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="muted" mono className="max-w-full truncate" title={record.id}>{record.id}</Pill>
              <span className="ui-card-meta">updated {timeAgo(record.updatedAt)}</span>
              {project.brief && <span className="ui-card-meta">brief {timeAgo(project.brief.updatedAt)}</span>}
              {record.archivedAt && <span className="ui-card-meta">archived {timeAgo(record.archivedAt)}</span>}
            </div>
            <div className="space-y-1.5">
              <p className="ui-card-title text-[14px] leading-snug">{record.title}</p>
              {description.length > 0 && <p className="ui-card-body">{description}</p>}
            </div>
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

        {projectRepoRoot && (
          <div className="space-y-1">
            <p className="ui-card-meta">Repo root</p>
            <p className="ui-card-body font-mono break-all">{projectRepoRoot}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
          <Pill tone={isArchived ? 'muted' : isBlocked ? 'warning' : 'teal'}>{status}</Pill>
          {metricParts.map((part, index) => (
            <span key={part} className="flex items-center gap-2">
              {index > 0 && <span className="opacity-35">·</span>}
              <span>{part}</span>
            </span>
          ))}
        </div>

        {currentFocus && (
          <div className="border-l-2 border-accent/35 pl-3">
            <p className="ui-card-meta">Current focus</p>
            <p className="ui-card-body mt-1 text-primary">{currentFocus}</p>
          </div>
        )}
      </div>

      {showRequirementsSection && (
        <section className="border-t border-border-subtle px-3.5 py-3.5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="ui-section-label">Requirements</p>
              <p className="ui-card-meta mt-1">Goal and definition of done</p>
            </div>
          </div>

          {requirementsContent.length > 0 && <MarkdownSection content={requirementsContent} />}

          {visibleAcceptanceCriteria.length > 0 && (
            <div className="space-y-2">
              <p className="ui-card-meta">Acceptance criteria</p>
              <ul className="space-y-1.5">
                {visibleAcceptanceCriteria.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[12px] leading-relaxed text-secondary">
                    <span className="mt-[2px] shrink-0 text-success">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {hiddenAcceptanceCriteria > 0 && (
                <p className="ui-card-meta">+{hiddenAcceptanceCriteria} more in the full project view</p>
              )}
            </div>
          )}
        </section>
      )}

      {showPlanSection && (
        <section className="border-t border-border-subtle px-3.5 py-3.5 space-y-3">
          <div>
            <p className="ui-section-label">Plan</p>
            <p className="ui-card-meta mt-1">Working narrative, blockers, and recent progress</p>
          </div>

          {planContent.length > 0 ? (
            <MarkdownSection content={planContent} />
          ) : showSummaryLead ? (
            <div className="space-y-1">
              <p className="ui-card-meta">List summary</p>
              <p className="ui-card-body">{listSummary}</p>
            </div>
          ) : null}

          {blockers.length > 0 && (
            <div className="space-y-2">
              <p className="ui-card-meta">Blocked by</p>
              <ul className="space-y-1.5">
                {blockers.map((blocker) => (
                  <li key={blocker} className="flex items-start gap-2 text-[12px] leading-relaxed text-warning">
                    <span className="mt-[2px] shrink-0">⚠</span>
                    <span>{blocker}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {visibleProgress.length > 0 && (
            <div className="space-y-2">
              <p className="ui-card-meta">Recent progress</p>
              <ul className="space-y-1.5">
                {visibleProgress.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[12px] leading-relaxed text-secondary">
                    <span className="mt-[2px] shrink-0 text-success">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {hiddenProgress > 0 && <p className="ui-card-meta">+{hiddenProgress} more recent updates in the full project view</p>}
            </div>
          )}
        </section>
      )}

      <section className="border-t border-border-subtle px-3.5 py-3.5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="ui-section-label">Milestones</p>
            <p className="ui-card-meta mt-1">{remainingMilestones} {remainingMilestones === 1 ? 'milestone left' : 'milestones left'}</p>
          </div>
          <span className="text-[11px] font-mono text-dim">{done}/{total} · {pct}%</span>
        </div>

        <div className="h-1 overflow-hidden rounded-full bg-base">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>

        {currentMilestone && (
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="ui-card-meta">Current milestone</p>
                <p className="ui-card-body mt-1 text-primary">{currentMilestone.title}</p>
              </div>
              <Pill tone={taskTone(currentMilestone.status)}>{formatProjectStatus(currentMilestone.status)}</Pill>
            </div>
            {currentMilestone.summary && <p className="ui-card-meta">{currentMilestone.summary}</p>}
          </div>
        )}

        {upcomingMilestones.length > 0 && (
          <div className="space-y-2">
            <p className="ui-card-meta">Coming up</p>
            <ul className="divide-y divide-border-subtle">
              {upcomingMilestones.map((milestone) => (
                <li key={milestone.id} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12px] leading-relaxed text-secondary">{milestone.title}</p>
                      {milestone.summary && <p className="ui-card-meta mt-1">{milestone.summary}</p>}
                    </div>
                    <span className="shrink-0 text-[10px] font-mono uppercase tracking-[0.14em] text-dim">
                      {formatProjectStatus(milestone.status)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!currentMilestone && total > 0 && <p className="ui-card-meta">All milestones complete.</p>}
        {total === 0 && <p className="ui-card-meta">No milestones yet.</p>}

        {(hiddenUpcomingMilestones > 0 || done > 0) && (
          <div className="space-y-1">
            {hiddenUpcomingMilestones > 0 && <p className="ui-card-meta">+{hiddenUpcomingMilestones} more milestones in the full project view</p>}
            {done > 0 && <p className="ui-card-meta">{done} completed {done === 1 ? 'milestone' : 'milestones'}</p>}
          </div>
        )}
      </section>

      {showTasksSection && (
        <section className="border-t border-border-subtle px-3.5 py-3.5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="ui-section-label">Tasks</p>
              <p className="ui-card-meta mt-1">Top execution tasks from PROJECT.yaml</p>
            </div>
            <span className="text-[11px] font-mono text-dim">{project.taskCount}</span>
          </div>

          <ul className="divide-y divide-border-subtle">
            {visibleTasks.map((task) => (
              <li key={task.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-[12px] font-medium leading-relaxed text-primary">{task.title}</p>
                    <p className="ui-card-meta">milestone: {task.milestoneId ?? 'unassigned'}</p>
                  </div>
                  <Pill tone={taskTone(task.status)}>{formatTaskStatus(task.status)}</Pill>
                </div>
              </li>
            ))}
          </ul>

          {hiddenTasks > 0 && <p className="ui-card-meta">+{hiddenTasks} more tasks in the full project view</p>}
        </section>
      )}

      {showCompletionSection && (
        <section className="border-t border-border-subtle px-3.5 py-3.5 space-y-3">
          <div>
            <p className="ui-section-label">Completion summary</p>
            <p className="ui-card-meta mt-1">Outcome and follow-up notes</p>
          </div>
          <MarkdownSection content={completionContent} />
        </section>
      )}
    </SurfacePanel>
  );
}
