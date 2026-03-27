import { useId, type FormEventHandler, type ReactNode } from 'react';
import { formatProjectStatus } from '../contextRailProject';
import type { ProjectFile, ProjectMilestone, ProjectNote, ProjectTask } from '../types';
import {
  type FileUploadState,
  type MilestoneFormState,
  type NoteFormState,
  type ProjectMilestoneEditorState,
  type ProjectTaskEditorState,
  type ProjectFormState,
  type TaskFormState,
} from './projectDetailState';
import { timeAgo } from '../utils';
import { Pill, ToolbarButton, type PillTone } from './ui';
import { MentionTextarea } from './MentionTextarea';

const INPUT_CLASS = 'w-full rounded-xl border border-border-default bg-base px-4 py-3 text-[15px] leading-relaxed text-primary focus:outline-none focus:border-accent/60';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[132px] resize-y`;
const SELECT_CLASS = `${INPUT_CLASS} pr-10`;
const FILE_UPLOAD_FIELD_CLASS = 'w-full rounded-none border-0 border-b border-border-default bg-transparent px-0 pb-2.5 pt-1 text-[15px] leading-relaxed text-primary placeholder:text-dim/75 focus:outline-none focus:border-accent/60';
const FILE_PICKER_CLASS = 'block w-full min-w-0 text-[14px] leading-relaxed text-primary focus:outline-none file:mr-4 file:rounded-full file:border file:border-border-subtle file:bg-elevated/65 file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-secondary file:transition-colors hover:file:border-border-default hover:file:text-primary';
const ACTION_BUTTON_CLASS = 'text-[12px] text-accent hover:text-accent/70 transition-colors disabled:opacity-40';

function toneForStatus(status: string): PillTone {
  switch (status) {
    case 'doing':
    case 'in_progress':
      return 'accent';
    case 'blocked':
    case 'paused':
      return 'warning';
    case 'done':
    case 'completed':
      return 'success';
    default:
      return 'muted';
  }
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
  value: ProjectFormState;
  statuses: string[];
  busy: boolean;
  error: string | null;
  onChange: (patch: Partial<ProjectFormState>) => void;
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
        <label className="ui-card-meta">Summary</label>
        <MentionTextarea
          value={value.summary}
          onValueChange={(summary) => onChange({ summary })}
          className={TEXTAREA_CLASS}
          placeholder="Short durable summary shown in lists and previews."
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
          <label className="ui-card-meta">Repo root</label>
          <input
            value={value.repoRoot}
            onChange={(event) => onChange({ repoRoot: event.target.value })}
            className={INPUT_CLASS}
            placeholder="Optional. Absolute path or a path relative to the personal-agent repo."
          />
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

export function ProjectMilestoneEditorForm(_props: {
  editor: ProjectMilestoneEditorState;
  value: MilestoneFormState;
  statuses: string[];
  busy: boolean;
  error: string | null;
  onChange: (patch: Partial<MilestoneFormState>) => void;
  onCancel: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  showDivider?: boolean;
}) {
  return null;
}

export function ProjectTaskEditorForm({
  editor,
  value,
  statuses,
  error,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  editor: ProjectTaskEditorState;
  value: TaskFormState;
  milestones?: ProjectMilestone[];
  statuses: string[];
  error: string | null;
  busy: boolean;
  onChange: (patch: Partial<TaskFormState>) => void;
  onCancel: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-5 border-t border-border-subtle pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="ui-card-meta">{editor.mode === 'add' ? 'New task' : `Edit task ${editor.taskId}`}</p>
        <button type="button" onClick={onCancel} className={ACTION_BUTTON_CLASS}>Cancel</button>
      </div>

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

      {error && <p className="text-[12px] text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <ToolbarButton type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save task'}</ToolbarButton>
      </div>
    </form>
  );
}

function ProjectTaskRow({
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

export function ProjectMilestoneRow(_props: {
  milestone: ProjectMilestone;
  isCurrent: boolean;
  milestoneIndex: number;
  milestoneCount: number;
  busy: boolean;
  quickStatuses: string[];
  taskBusy: boolean;
  milestoneTasks: ProjectTask[];
  taskEditor: ProjectTaskEditorState | null;
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
  return null;
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
  value: NoteFormState;
  kinds: string[];
  error: string | null;
  busy: boolean;
  onChange: (patch: Partial<NoteFormState>) => void;
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
        <MentionTextarea value={value.body} onValueChange={(body) => onChange({ body })} className={TEXTAREA_CLASS} />
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
  value: FileUploadState;
  error: string | null;
  busy: boolean;
  onChange: (patch: Partial<FileUploadState>) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  const fileId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const fileMeta = value.file
    ? [formatBytes(value.file.size), value.file.type || null].filter(Boolean).join(' · ')
    : 'Pick a file to attach to this project.';

  return (
    <form onSubmit={onSubmit} className="space-y-4 border-t border-border-subtle pt-4">
      <div className="space-y-1.5">
        <label htmlFor={fileId} className="ui-card-meta">File</label>
        <div className="space-y-1.5 border-b border-border-default pb-2.5">
          <input
            id={fileId}
            type="file"
            onChange={(event) => onChange({
              file: event.target.files?.[0] ?? null,
              title: value.title || event.target.files?.[0]?.name || '',
            })}
            className={FILE_PICKER_CLASS}
          />
          <p className="ui-card-meta truncate">{fileMeta}</p>
        </div>
      </div>
      <div className="grid gap-x-6 gap-y-4 xl:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={titleId} className="ui-card-meta">Title</label>
          <input
            id={titleId}
            value={value.title}
            onChange={(event) => onChange({ title: event.target.value })}
            className={FILE_UPLOAD_FIELD_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={descriptionId} className="ui-card-meta">Description</label>
          <input
            id={descriptionId}
            value={value.description}
            onChange={(event) => onChange({ description: event.target.value })}
            className={FILE_UPLOAD_FIELD_CLASS}
          />
        </div>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <div className="flex items-center gap-3">
        <ToolbarButton type="submit" disabled={busy || !value.file}>{busy ? 'Uploading…' : 'Add file'}</ToolbarButton>
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
      <div className="flex items-center gap-3 shrink-0">
        <button type="button" onClick={onDelete} className="text-[12px] text-danger hover:text-danger/75 transition-colors disabled:opacity-40" disabled={busy}>
          Delete
        </button>
      </div>
    </article>
  );
}
