import type { FormEventHandler, ReactNode } from 'react';
import { formatProjectStatus } from '../contextRailProject';
import type { ProjectFile, ProjectMilestone, ProjectNote, ProjectTask } from '../types';
import { timeAgo } from '../utils';
import { Pill, ToolbarButton, cx, type PillTone } from './ui';

const INPUT_CLASS = 'w-full rounded-xl border border-border-default bg-base px-4 py-3 text-[15px] leading-relaxed text-primary focus:outline-none focus:border-accent/60';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[132px] resize-y`;
const SELECT_CLASS = `${INPUT_CLASS} pr-10`;
const ACTION_BUTTON_CLASS = 'text-[12px] text-accent hover:text-accent/70 transition-colors disabled:opacity-40';
const STATUS_ACTION_BUTTON_CLASS = 'rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors disabled:opacity-40';

interface ProjectFormStateShape {
  title: string;
  description: string;
  repoRoot: string;
  summary: string;
  goal: string;
  acceptanceCriteria: string;
  planSummary: string;
  completionSummary: string;
  status: string;
  currentFocus: string;
  blockers: string;
  recentProgress: string;
}

interface MilestoneFormStateShape {
  title: string;
  status: string;
  summary: string;
  makeCurrent: boolean;
}

interface TaskFormStateShape {
  title: string;
  status: string;
  milestoneId: string;
}

interface NoteFormStateShape {
  title: string;
  kind: string;
  body: string;
}

interface FileUploadStateShape {
  kind: 'attachment' | 'artifact';
  title: string;
  description: string;
  file: File | null;
}

interface TaskEditorShapeAdd {
  mode: 'add';
  anchorMilestoneId?: string;
}

interface TaskEditorShapeEdit {
  mode: 'edit';
  taskId: string;
  anchorMilestoneId?: string;
}

function toneForStatus(status: string): PillTone {
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

function dotClassForStatus(status: string): string {
  switch (status) {
    case 'in_progress':
    case 'running':
      return 'bg-accent';
    case 'blocked':
      return 'bg-warning';
    case 'failed':
      return 'bg-danger';
    case 'completed':
      return 'bg-success';
    default:
      return 'bg-border-default';
  }
}

function milestoneStatusButtonClass(isActive: boolean): string {
  return cx(
    STATUS_ACTION_BUTTON_CLASS,
    isActive
      ? 'border-accent/30 bg-accent/10 text-accent'
      : 'border-border-subtle bg-base text-dim hover:border-border-default hover:text-primary',
  );
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProjectRecordEditorForm({
  value,
  statuses,
  busy,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: ProjectFormStateShape;
  statuses: string[];
  busy: boolean;
  error: string | null;
  onChange: (patch: Partial<ProjectFormStateShape>) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="max-w-4xl space-y-6 border-t border-border-subtle pt-6">
      <div className="space-y-1.5">
        <label className="ui-card-meta">Title</label>
        <input value={value.title} onChange={(event) => onChange({ title: event.target.value })} className={INPUT_CLASS} />
      </div>

      <div className="space-y-1.5">
        <label className="ui-card-meta">Description</label>
        <textarea value={value.description} onChange={(event) => onChange({ description: event.target.value })} className={TEXTAREA_CLASS} />
      </div>

      <div className="space-y-1.5">
        <label className="ui-card-meta">Repo root</label>
        <input
          value={value.repoRoot}
          onChange={(event) => onChange({ repoRoot: event.target.value })}
          className={INPUT_CLASS}
          placeholder="Optional. Absolute path or a path relative to the personal-agent repo."
        />
      </div>

      <div className="space-y-1.5">
        <label className="ui-card-meta">List summary</label>
        <textarea
          value={value.summary}
          onChange={(event) => onChange({ summary: event.target.value })}
          className={TEXTAREA_CLASS}
          placeholder="Used in project lists and compact previews."
        />
      </div>

      <div className="space-y-1.5">
        <label className="ui-card-meta">Goal</label>
        <textarea value={value.goal} onChange={(event) => onChange({ goal: event.target.value })} className={TEXTAREA_CLASS} />
      </div>

      <div className="space-y-1.5">
        <label className="ui-card-meta">Acceptance criteria (one per line)</label>
        <textarea
          value={value.acceptanceCriteria}
          onChange={(event) => onChange({ acceptanceCriteria: event.target.value })}
          className={TEXTAREA_CLASS}
        />
      </div>

      <div className="space-y-1.5">
        <label className="ui-card-meta">Plan summary</label>
        <textarea
          value={value.planSummary}
          onChange={(event) => onChange({ planSummary: event.target.value })}
          className={TEXTAREA_CLASS}
          placeholder="Optional narrative plan before or alongside milestones and tasks."
        />
      </div>

      <div className="space-y-1.5">
        <label className="ui-card-meta">Completion summary</label>
        <textarea
          value={value.completionSummary}
          onChange={(event) => onChange({ completionSummary: event.target.value })}
          className={TEXTAREA_CLASS}
          placeholder="Optional until the project is complete."
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-1.5">
          <label className="ui-card-meta">Status</label>
          <select value={value.status} onChange={(event) => onChange({ status: event.target.value })} className={SELECT_CLASS}>
            {statuses.map((status) => (
              <option key={status} value={status}>{formatProjectStatus(status)}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="ui-card-meta">Current focus</label>
          <input
            value={value.currentFocus}
            onChange={(event) => onChange({ currentFocus: event.target.value })}
            className={INPUT_CLASS}
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-1.5">
          <label className="ui-card-meta">Blockers (one per line)</label>
          <textarea value={value.blockers} onChange={(event) => onChange({ blockers: event.target.value })} className={TEXTAREA_CLASS} />
        </div>

        <div className="space-y-1.5">
          <label className="ui-card-meta">Recent progress (one per line)</label>
          <textarea value={value.recentProgress} onChange={(event) => onChange({ recentProgress: event.target.value })} className={TEXTAREA_CLASS} />
        </div>
      </div>

      {error && <p className="text-[12px] text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <ToolbarButton type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save project'}</ToolbarButton>
        <button type="button" onClick={onCancel} className="text-[13px] text-secondary hover:text-primary transition-colors">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ProjectMilestoneEditorForm({
  editor,
  value,
  statuses,
  busy,
  error,
  onChange,
  onCancel,
  onSubmit,
  showDivider = true,
}: {
  editor: { mode: 'add' } | { mode: 'edit'; milestoneId: string };
  value: MilestoneFormStateShape;
  statuses: string[];
  busy: boolean;
  error: string | null;
  onChange: (patch: Partial<MilestoneFormStateShape>) => void;
  onCancel: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  showDivider?: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className={cx('space-y-5', showDivider && 'border-t border-border-subtle pt-5')}>
      <div className="flex items-center justify-between gap-3">
        <p className="ui-card-meta">{editor.mode === 'add' ? 'New milestone' : `Edit milestone ${editor.milestoneId}`}</p>
        <button type="button" onClick={onCancel} className={ACTION_BUTTON_CLASS}>Cancel</button>
      </div>

      {editor.mode === 'edit' && <p className="ui-card-meta font-mono">{editor.milestoneId}</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="space-y-1.5">
          <label className="ui-card-meta">Title</label>
          <input value={value.title} onChange={(event) => onChange({ title: event.target.value })} className={INPUT_CLASS} />
        </div>

        <div className="space-y-1.5">
          <label className="ui-card-meta">Status</label>
          <select value={value.status} onChange={(event) => onChange({ status: event.target.value })} className={SELECT_CLASS}>
            {statuses.map((status) => (
              <option key={status} value={status}>{formatProjectStatus(status)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="ui-card-meta">Summary</label>
        <textarea value={value.summary} onChange={(event) => onChange({ summary: event.target.value })} className={TEXTAREA_CLASS} />
      </div>

      <label className="flex items-center gap-2 text-[13px] text-secondary">
        <input type="checkbox" checked={value.makeCurrent} onChange={(event) => onChange({ makeCurrent: event.target.checked })} />
        Set as current milestone
      </label>

      {error && <p className="text-[12px] text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <ToolbarButton type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save milestone'}</ToolbarButton>
      </div>
    </form>
  );
}

export function ProjectTaskEditorForm({
  editor,
  value,
  milestones,
  statuses,
  error,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  editor: TaskEditorShapeAdd | TaskEditorShapeEdit;
  value: TaskFormStateShape;
  milestones: ProjectMilestone[];
  statuses: string[];
  error: string | null;
  busy: boolean;
  onChange: (patch: Partial<TaskFormStateShape>) => void;
  onCancel: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-5 border-t border-border-subtle pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="ui-card-meta">{editor.mode === 'add' ? 'New task' : `Edit task ${editor.taskId}`}</p>
        <button type="button" onClick={onCancel} className={ACTION_BUTTON_CLASS}>Cancel</button>
      </div>

      {editor.mode === 'edit' && <p className="ui-card-meta font-mono">{editor.taskId}</p>}

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_15rem_15rem]">
        <div className="space-y-1.5">
          <label className="ui-card-meta">Title</label>
          <input value={value.title} onChange={(event) => onChange({ title: event.target.value })} className={INPUT_CLASS} />
        </div>

        <div className="space-y-1.5">
          <label className="ui-card-meta">Status</label>
          <select value={value.status} onChange={(event) => onChange({ status: event.target.value })} className={SELECT_CLASS}>
            {statuses.map((status) => (
              <option key={status} value={status}>{formatProjectStatus(status)}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="ui-card-meta">Milestone</label>
          <select value={value.milestoneId} onChange={(event) => onChange({ milestoneId: event.target.value })} className={SELECT_CLASS}>
            <option value="">No milestone</option>
            {milestones.map((milestone) => (
              <option key={milestone.id} value={milestone.id}>{milestone.title}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-[12px] text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <ToolbarButton type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save task'}</ToolbarButton>
      </div>
    </form>
  );
}

export function ProjectTaskRow({
  task,
  taskIndex,
  taskCount,
  busy,
  onMove,
  onEdit,
  onDelete,
}: {
  task: ProjectTask;
  taskIndex: number;
  taskCount: number;
  busy: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article id={`project-task-${task.id}`} className="py-4 scroll-mt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-medium leading-relaxed text-primary">{task.title}</p>
            <span className="ui-card-meta font-mono">{task.id}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
          <button type="button" onClick={() => onMove('up')} className={ACTION_BUTTON_CLASS} disabled={busy || taskIndex === 0}>↑</button>
          <button type="button" onClick={() => onMove('down')} className={ACTION_BUTTON_CLASS} disabled={busy || taskIndex === taskCount - 1}>↓</button>
          <button type="button" onClick={onEdit} className={ACTION_BUTTON_CLASS}>Edit</button>
          <button type="button" onClick={onDelete} className="text-[12px] text-danger hover:text-danger/75 transition-colors disabled:opacity-40" disabled={busy}>Delete</button>
          <Pill tone={toneForStatus(task.status)}>{formatProjectStatus(task.status)}</Pill>
        </div>
      </div>
    </article>
  );
}

export function ProjectTaskList({
  tasks,
  taskEditorTaskId,
  taskEditorForm,
  busy,
  onMoveTask,
  onEditTask,
  onDeleteTask,
}: {
  tasks: ProjectTask[];
  taskEditorTaskId: string | null;
  taskEditorForm: ReactNode;
  busy: boolean;
  onMoveTask: (taskId: string, direction: 'up' | 'down') => void;
  onEditTask: (task: ProjectTask) => void;
  onDeleteTask: (taskId: string) => void;
}) {
  return (
    <div className="space-y-0 divide-y divide-border-subtle border-y border-border-subtle">
      {tasks.map((task, taskIndex) => {
        if (taskEditorTaskId === task.id) {
          return (
            <div key={task.id} id={`project-task-${task.id}`} className="py-4 scroll-mt-6">
              {taskEditorForm}
            </div>
          );
        }

        return (
          <ProjectTaskRow
            key={task.id}
            task={task}
            taskIndex={taskIndex}
            taskCount={tasks.length}
            busy={busy}
            onMove={(direction) => onMoveTask(task.id, direction)}
            onEdit={() => onEditTask(task)}
            onDelete={() => onDeleteTask(task.id)}
          />
        );
      })}
    </div>
  );
}

export function ProjectMilestoneRow({
  milestone,
  isCurrent,
  milestoneIndex,
  milestoneCount,
  busy,
  quickStatuses,
  taskBusy,
  milestoneTasks,
  taskEditor,
  taskEditorForm,
  onMove,
  onMakeCurrent,
  onEdit,
  onDelete,
  onSetStatus,
  onOpenTaskAdd,
  onMoveTask,
  onEditTask,
  onDeleteTask,
}: {
  milestone: ProjectMilestone;
  isCurrent: boolean;
  milestoneIndex: number;
  milestoneCount: number;
  busy: boolean;
  quickStatuses: string[];
  taskBusy: boolean;
  milestoneTasks: ProjectTask[];
  taskEditor: TaskEditorShapeAdd | TaskEditorShapeEdit | null;
  taskEditorForm: ReactNode;
  onMove: (direction: 'up' | 'down') => void;
  onMakeCurrent: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetStatus: (status: string) => void;
  onOpenTaskAdd: () => void;
  onMoveTask: (taskId: string, direction: 'up' | 'down') => void;
  onEditTask: (task: ProjectTask) => void;
  onDeleteTask: (taskId: string) => void;
}) {
  const taskEditorIsAnchoredHere = taskEditor != null && taskEditor.anchorMilestoneId === milestone.id;
  const taskEditorTaskId = taskEditor?.mode === 'edit' ? taskEditor.taskId : null;

  return (
    <div className="py-4 space-y-4" id={`project-milestone-${milestone.id}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start gap-2.5">
            <span className={cx('mt-[7px] h-2 w-2 shrink-0 rounded-full', dotClassForStatus(milestone.status))} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[14px] font-medium leading-relaxed text-primary">{milestone.title}</p>
                {isCurrent && <span className="ui-card-meta">current</span>}
                <Pill tone={toneForStatus(milestone.status)}>{formatProjectStatus(milestone.status)}</Pill>
              </div>
              {milestone.summary && <p className="ui-card-meta mt-1 break-words">{milestone.summary}</p>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
          <button type="button" onClick={() => onMove('up')} className={ACTION_BUTTON_CLASS} disabled={busy || milestoneIndex === 0}>↑</button>
          <button type="button" onClick={() => onMove('down')} className={ACTION_BUTTON_CLASS} disabled={busy || milestoneIndex === milestoneCount - 1}>↓</button>
          {!isCurrent && (
            <button type="button" onClick={onMakeCurrent} className={ACTION_BUTTON_CLASS} disabled={busy}>
              Make current
            </button>
          )}
          <button type="button" onClick={onEdit} className={ACTION_BUTTON_CLASS}>Edit</button>
          <button type="button" onClick={onDelete} className="text-[12px] text-danger hover:text-danger/75 transition-colors disabled:opacity-40" disabled={busy}>
            Delete
          </button>
        </div>
      </div>

      <div className="ml-5 space-y-4 border-l border-border-subtle pl-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-card-meta">State</span>
          {quickStatuses.map((status) => (
            <button
              key={`${milestone.id}-${status}`}
              type="button"
              onClick={() => onSetStatus(status)}
              className={milestoneStatusButtonClass(milestone.status === status)}
              disabled={busy || milestone.status === status}
            >
              {formatProjectStatus(status)}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="ui-card-meta">Tasks for this milestone</p>
              <p className="ui-card-meta mt-1">{milestoneTasks.length} {milestoneTasks.length === 1 ? 'task' : 'tasks'}</p>
            </div>
            <button type="button" onClick={onOpenTaskAdd} className={ACTION_BUTTON_CLASS} disabled={taskBusy}>
              + Add task
            </button>
          </div>

          {taskEditorIsAnchoredHere && taskEditorForm}

          {milestoneTasks.length > 0 ? (
            <ProjectTaskList
              tasks={milestoneTasks}
              taskEditorTaskId={taskEditorTaskId}
              taskEditorForm={taskEditorForm}
              busy={taskBusy}
              onMoveTask={onMoveTask}
              onEditTask={onEditTask}
              onDeleteTask={onDeleteTask}
            />
          ) : !taskEditorIsAnchoredHere ? (
            <p className="ui-card-meta">No tasks for this milestone yet.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ProjectNoteEditorForm({
  editor,
  value,
  kinds,
  error,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  editor: { mode: 'add' } | { mode: 'edit'; noteId: string };
  value: NoteFormStateShape;
  kinds: string[];
  error: string | null;
  busy: boolean;
  onChange: (patch: Partial<NoteFormStateShape>) => void;
  onCancel: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-5 border-t border-border-subtle pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="ui-card-meta">{editor.mode === 'add' ? 'New note' : `Edit note ${editor.noteId}`}</p>
        <button type="button" onClick={onCancel} className={ACTION_BUTTON_CLASS}>Cancel</button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="space-y-1.5">
          <label className="ui-card-meta">Title</label>
          <input value={value.title} onChange={(event) => onChange({ title: event.target.value })} className={INPUT_CLASS} />
        </div>

        <div className="space-y-1.5">
          <label className="ui-card-meta">Kind</label>
          <select value={value.kind} onChange={(event) => onChange({ kind: event.target.value })} className={SELECT_CLASS}>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>{formatProjectStatus(kind)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="ui-card-meta">Body</label>
        <textarea value={value.body} onChange={(event) => onChange({ body: event.target.value })} className={TEXTAREA_CLASS} />
      </div>

      {error && <p className="text-[12px] text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <ToolbarButton type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save note'}</ToolbarButton>
      </div>
    </form>
  );
}

export function ProjectNoteRow({
  note,
  busy,
  onEdit,
  onDelete,
  children,
}: {
  note: ProjectNote;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  return (
    <article id={`project-note-${note.id}`} className="py-4 space-y-3 scroll-mt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-medium text-primary">{note.title}</p>
            <Pill tone="muted">{formatProjectStatus(note.kind)}</Pill>
            <span className="ui-card-meta">updated {timeAgo(note.updatedAt)}</span>
          </div>
          {children}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button type="button" onClick={onEdit} className={ACTION_BUTTON_CLASS}>Edit</button>
          <button type="button" onClick={onDelete} className="text-[12px] text-danger hover:text-danger/75 transition-colors disabled:opacity-40" disabled={busy}>Delete</button>
        </div>
      </div>
    </article>
  );
}

export function ProjectFileUploadForm({
  value,
  error,
  busy,
  onChange,
  onSubmit,
}: {
  value: FileUploadStateShape;
  error: string | null;
  busy: boolean;
  onChange: (patch: Partial<FileUploadStateShape>) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-5 border-t border-border-subtle pt-4">
      <div className="grid gap-5 xl:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <label className="ui-card-meta">Kind</label>
          <select value={value.kind} onChange={(event) => onChange({ kind: event.target.value as 'attachment' | 'artifact' })} className={SELECT_CLASS}>
            <option value="attachment">Attachment</option>
            <option value="artifact">Artifact</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="ui-card-meta">File</label>
          <input
            type="file"
            onChange={(event) => onChange({
              file: event.target.files?.[0] ?? null,
              title: value.title || event.target.files?.[0]?.name || '',
            })}
            className={INPUT_CLASS}
          />
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-1.5">
          <label className="ui-card-meta">Title</label>
          <input value={value.title} onChange={(event) => onChange({ title: event.target.value })} className={INPUT_CLASS} />
        </div>
        <div className="space-y-1.5">
          <label className="ui-card-meta">Description</label>
          <input value={value.description} onChange={(event) => onChange({ description: event.target.value })} className={INPUT_CLASS} />
        </div>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <div className="flex items-center gap-3">
        <ToolbarButton type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Add file'}</ToolbarButton>
      </div>
    </form>
  );
}

export function ProjectFileRow({
  file,
  busy,
  onDelete,
}: {
  file: ProjectFile;
  busy: boolean;
  onDelete: () => void;
}) {
  return (
    <article className="py-4 flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <a href={file.downloadPath} className="text-[14px] font-medium text-accent hover:text-accent/75 transition-colors">
            {file.title}
          </a>
          <span className="ui-card-meta">{file.originalName}</span>
          <span className="ui-card-meta">{formatBytes(file.sizeBytes)}</span>
        </div>
        {file.description && <p className="ui-card-meta break-words">{file.description}</p>}
        <p className="ui-card-meta">updated {timeAgo(file.updatedAt)}</p>
      </div>
      <button type="button" onClick={onDelete} className="text-[12px] text-danger hover:text-danger/75 transition-colors disabled:opacity-40" disabled={busy}>
        Delete
      </button>
    </article>
  );
}
