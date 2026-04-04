import { bucketProjectStatus, formatProjectStatus, isProjectArchived } from '../contextRailProject';
import type { ProjectDetail } from '../types';
import { timeAgo } from '../utils';
import { IconButton, Pill, SurfacePanel } from './ui';

function previewLine(value: string): string | null {
  const lines = value.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? '';
    if (!trimmed) {
      continue;
    }

    if (index === 0 && trimmed.startsWith('# ')) {
      continue;
    }

    return trimmed.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').trim();
  }

  return null;
}

function taskRank(status: string): number {
  switch (status) {
    case 'doing':
    case 'in_progress':
      return 0;
    case 'todo':
    case 'pending':
      return 1;
    case 'done':
    case 'completed':
      return 2;
    default:
      return 3;
  }
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
  const isArchived = isProjectArchived(record);
  const documentRecord = project.document;
  const taskCount = project.taskCount ?? project.tasks.length;
  const childPageCount = project.childPageCount ?? project.childPages.length;
  const fileCount = project.fileCount ?? project.files?.length ?? ((project.attachments?.length ?? 0) + (project.artifacts?.length ?? 0));
  const projectSummary = record.summary.trim() || record.description.trim();
  const documentPreview = previewLine(documentRecord?.content ?? '') || projectSummary;
  const tasks = [...project.tasks].sort((left, right) => taskRank(left.status) - taskRank(right.status)).slice(0, 4);
  const hiddenTasks = Math.max(0, project.tasks.length - tasks.length);
  const metrics = [
    `${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}`,
    ...(childPageCount > 0 ? [`${childPageCount} ${childPageCount === 1 ? 'page' : 'pages'}`] : []),
    ...(fileCount > 0 ? [`${fileCount} ${fileCount === 1 ? 'file' : 'files'}`] : []),
    ...(project.linkedConversations.length > 0 ? [`${project.linkedConversations.length} ${project.linkedConversations.length === 1 ? 'conversation' : 'conversations'}`] : []),
  ];

  return (
    <SurfacePanel muted className="overflow-hidden">
      <div className="px-3.5 py-3.5 space-y-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="muted" mono className="max-w-full truncate" title={record.id}>{record.id}</Pill>
              <span className="ui-card-meta">updated {timeAgo(record.updatedAt)}</span>
              {record.archivedAt && <span className="ui-card-meta">archived {timeAgo(record.archivedAt)}</span>}
            </div>
            <div className="space-y-1.5">
              <p className="ui-card-title text-[14px] leading-snug">{record.title}</p>
              {projectSummary && <p className="ui-card-body">{projectSummary}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
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

        {record.repoRoot && (
          <p className="ui-card-meta font-mono break-all">{record.repoRoot}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
          <Pill tone={isArchived ? 'muted' : bucketProjectStatus(record.status) === 'paused' ? 'warning' : bucketProjectStatus(record.status) === 'done' ? 'success' : 'teal'}>
            {formatProjectStatus(record.status)}
          </Pill>
          {metrics.map((part, index) => (
            <span key={part} className="flex items-center gap-2">
              {index > 0 && <span className="opacity-35">·</span>}
              <span>{part}</span>
            </span>
          ))}
        </div>
      </div>

      {documentPreview && (
        <section className="border-t border-border-subtle px-3.5 py-3.5 space-y-2">
          <p className="ui-section-label">Doc</p>
          <p className="ui-card-body">{documentPreview}</p>
        </section>
      )}

      <section className="border-t border-border-subtle px-3.5 py-3.5 space-y-3">
        <div>
          <p className="ui-section-label">Tasks</p>
          <p className="ui-card-meta mt-1">Flat page task list</p>
        </div>

        {tasks.length > 0 ? (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between gap-3 text-[12px]">
                <p className="min-w-0 truncate text-primary">{task.title}</p>
                <span className="shrink-0 text-dim">{formatProjectStatus(task.status)}</span>
              </div>
            ))}
            {hiddenTasks > 0 && <p className="ui-card-meta">+{hiddenTasks} more in the full page view</p>}
          </div>
        ) : (
          <p className="ui-card-meta">No tasks yet.</p>
        )}
      </section>
    </SurfacePanel>
  );
}
