import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { bucketProjectStatus, formatProjectStatus, isProjectArchived } from '../contextRailProject';
import type { ProjectDetail, ProjectFile, ProjectNote, ProjectTask } from '../types';
import {
  ProjectFileUploadForm,
  ProjectNoteEditorForm,
  ProjectTaskEditorForm,
} from './ProjectDetailForms';
import {
  composeProjectDocumentContent,
  ProjectActivityContent,
  ProjectDocumentContent,
  ProjectRecordViewer,
  projectDocumentStartsWithTitleHeading,
  stripMatchingLeadingHeading,
} from './ProjectDetailSections';
import {
  buildActivityItems,
  emptyFileUploadState,
  emptyNoteForm,
  emptyTaskForm,
  noteFormFromNote,
  normalizeProjectForm,
  projectFormFromDetail,
  projectFormsEqual,
  taskFormFromTask,
  type FileUploadState,
  type NoteFormState,
  type ProjectNoteEditorState,
  type ProjectTaskEditorState,
  type ProjectFormState,
  type TaskFormState,
} from './projectDetailState';
import { MentionTextarea } from './MentionTextarea';
import { IconButton, Pill, cx, type PillTone } from './ui';
import { timeAgo } from '../utils';

const ACTION_TEXT_BUTTON_CLASS = 'text-[12px] font-medium text-accent hover:text-accent/75 transition-colors disabled:opacity-40';
const DANGER_TEXT_BUTTON_CLASS = 'text-[12px] font-medium text-danger hover:text-danger/75 transition-colors disabled:opacity-40';
const RAIL_SECTION_CLASS = 'border-t border-border-subtle pt-3 first:border-t-0 first:pt-0';
const RAIL_SECONDARY_BUTTON_CLASS = 'inline-flex items-center justify-center rounded-lg border border-border-default bg-base/50 px-2.5 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-surface';
const PROJECT_TOOLBAR_BUTTON_CLASS = 'h-8 w-8 rounded-full border border-border-subtle bg-base/40 text-secondary hover:bg-surface hover:text-primary disabled:cursor-default disabled:opacity-40';
const PROJECT_TOOLBAR_PRIMARY_BUTTON_CLASS = 'h-8 w-8 rounded-full border border-accent/25 bg-accent/10 text-accent hover:bg-accent/15 hover:text-accent disabled:cursor-default disabled:opacity-40';
const PROJECT_TOOLBAR_GROUP_CLASS = 'inline-flex items-center gap-1 rounded-full border border-border-subtle bg-base/30 p-1';
const PROJECT_INLINE_TITLE_INPUT_CLASS = 'w-full rounded-2xl border border-transparent bg-transparent -mx-3 px-3 py-2 text-[32px] font-semibold leading-none tracking-tight text-primary transition-colors placeholder:text-dim/60 hover:border-border-subtle/70 hover:bg-base/25 focus:border-accent/45 focus:bg-base/35 focus:outline-none';
const PROJECT_INLINE_SUMMARY_CLASS = 'w-full max-w-3xl min-h-[5.5rem] resize-y rounded-2xl border border-transparent bg-transparent -mx-3 px-3 py-2 text-[14px] leading-relaxed text-secondary transition-colors placeholder:text-dim/70 hover:border-border-subtle/70 hover:bg-base/25 focus:border-accent/45 focus:bg-base/35 focus:outline-none';
const PROJECT_PROPERTY_INPUT_CLASS = 'w-full rounded-lg border border-transparent bg-transparent -mx-2 px-2 py-1 text-[13px] leading-relaxed text-primary transition-colors placeholder:text-dim/70 hover:border-border-subtle/70 hover:bg-base/25 focus:border-accent/45 focus:bg-base/35 focus:outline-none';
const PROJECT_PROPERTY_SELECT_CLASS = `${PROJECT_PROPERTY_INPUT_CLASS} pr-8`;
const PROJECT_STATUSES = ['active', 'paused', 'done'];
const TASK_STATUSES = ['todo', 'doing', 'done'];
const PROJECT_NOTE_KINDS = ['note', 'decision', 'question', 'meeting', 'checkpoint'];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unable to read file.'));
        return;
      }

      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function toneForProjectStatus(status: string, archived: boolean): PillTone {
  if (archived) {
    return 'muted';
  }

  const bucket = bucketProjectStatus(status);
  if (bucket === 'paused') {
    return 'warning';
  }

  if (bucket === 'done') {
    return 'success';
  }

  return 'teal';
}

function isTaskDone(status: string): boolean {
  return status === 'done' || status === 'completed';
}

function formatTaskSummary(tasks: ProjectTask[]): { open: number; done: number } {
  const done = tasks.filter((task) => isTaskDone(task.status)).length;
  return {
    open: Math.max(0, tasks.length - done),
    done,
  };
}

function summarizeConversationMeta(conversation: ProjectDetail['linkedConversations'][number]): string {
  if (conversation.snippet?.trim()) {
    return conversation.snippet.trim();
  }

  if (conversation.cwd?.trim()) {
    return conversation.cwd.trim();
  }

  return conversation.isRunning ? 'Conversation running' : 'Linked conversation';
}

function ToolbarGlyph({ path }: { path: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function ProjectSection({
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border-subtle pt-6 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-primary">{title}</h2>
          {meta ? <p className="mt-0.5 text-[12px] text-secondary">{meta}</p> : null}
        </div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function ProjectRailSection({
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={RAIL_SECTION_CLASS}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-primary">{title}</h3>
          {meta ? <p className="mt-0.5 text-[11px] text-secondary">{meta}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function ProjectPropertyRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-[0.14em] text-dim">{label}</p>
      <div className="text-[13px] leading-relaxed text-primary">{value}</div>
    </div>
  );
}

function TaskStatusGlyph({ status }: { status: string }) {
  const done = isTaskDone(status);

  return (
    <span
      className={cx(
        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
        done
          ? 'border-success/45 bg-success/12 text-success'
          : status === 'doing' || status === 'in_progress'
            ? 'border-accent/55 bg-accent/10 text-accent'
            : status === 'blocked' || status === 'paused'
              ? 'border-warning/45 bg-warning/10 text-warning'
              : 'border-border-default text-secondary',
      )}
    >
      {done ? '✓' : ''}
    </span>
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
  const done = isTaskDone(task.status);

  return (
    <article id={`project-task-${task.id}`} className="flex items-start gap-2.5 px-3 py-2.5 scroll-mt-6">
      <TaskStatusGlyph status={task.status} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className={cx('text-[14px] leading-relaxed', done ? 'text-secondary line-through' : 'font-medium text-primary')}>
              {task.title}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
              <span className="font-mono">{task.id}</span>
              <span className="opacity-40">·</span>
              <span>{formatProjectStatus(task.status)}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
            <button type="button" onClick={() => onMove('up')} className={ACTION_TEXT_BUTTON_CLASS} disabled={busy || taskIndex === 0}>↑</button>
            <button type="button" onClick={() => onMove('down')} className={ACTION_TEXT_BUTTON_CLASS} disabled={busy || taskIndex === taskCount - 1}>↓</button>
            <button type="button" onClick={onEdit} className={ACTION_TEXT_BUTTON_CLASS}>Edit</button>
            <button type="button" onClick={onDelete} className={DANGER_TEXT_BUTTON_CLASS} disabled={busy}>Delete</button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ProjectTaskListBlock({
  tasks,
  taskEditorTaskId,
  taskEditorForm,
  busy,
  onMoveTask,
  onEditTask,
  onDeleteTask,
  emptyLabel = 'No tasks yet.',
}: {
  tasks: ProjectTask[];
  taskEditorTaskId: string | null;
  taskEditorForm: ReactNode;
  busy: boolean;
  onMoveTask: (taskId: string, direction: 'up' | 'down') => void;
  onEditTask: (task: ProjectTask) => void;
  onDeleteTask: (taskId: string) => void;
  emptyLabel?: string;
}) {
  if (tasks.length === 0) {
    return <p className="px-3 py-2.5 text-[12px] text-secondary">{emptyLabel}</p>;
  }

  return (
    <div className="divide-y divide-border-subtle">
      {tasks.map((task, taskIndex) => {
        if (taskEditorTaskId === task.id) {
          return (
            <div key={task.id} id={`project-task-${task.id}`} className="px-3 py-3 scroll-mt-6">
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

function ProjectNoteList({
  notes,
  noteEditor,
  noteEditorForm,
  noteBusy,
  onEditNote,
  onDeleteNote,
}: {
  notes: ProjectNote[];
  noteEditor: ProjectNoteEditorState | null;
  noteEditorForm: ReactNode;
  noteBusy: boolean;
  onEditNote: (note: ProjectNote) => void;
  onDeleteNote: (noteId: string) => void;
}) {
  if (notes.length === 0 && noteEditor?.mode !== 'add') {
    return <p className="text-[12px] text-secondary">No notes yet.</p>;
  }

  return (
    <div className="space-y-2.5">
      {noteEditor?.mode === 'add' ? noteEditorForm : null}
      <div className="divide-y divide-border-subtle">
        {notes.map((note) => {
          const isEditing = noteEditor?.mode === 'edit' && noteEditor.noteId === note.id;
          if (isEditing) {
            return (
              <div key={note.id} id={`project-note-${note.id}`} className="px-3 py-3 scroll-mt-6">
                {noteEditorForm}
              </div>
            );
          }

          return (
            <article key={note.id} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-primary">{note.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
                    <span>{formatProjectStatus(note.kind)}</span>
                    <span className="opacity-40">·</span>
                    <span>updated {timeAgo(note.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => onEditNote(note)} className={ACTION_TEXT_BUTTON_CLASS}>Edit</button>
                  <button type="button" onClick={() => onDeleteNote(note.id)} className={DANGER_TEXT_BUTTON_CLASS} disabled={noteBusy}>Delete</button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ProjectFileList({
  files,
  fileBusy,
  onDeleteFile,
}: {
  files: ProjectFile[];
  fileBusy: boolean;
  onDeleteFile: (file: ProjectFile) => void;
}) {
  if (files.length === 0) {
    return <p className="text-[12px] text-secondary">No files yet.</p>;
  }

  return (
    <div className="divide-y divide-border-subtle">
      {files.map((file) => (
        <article key={file.id} className="px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <a href={file.downloadPath} className="text-[13px] font-medium text-accent transition-colors hover:text-accent/75">
                {file.title}
              </a>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
                <span>{file.originalName}</span>
                <span className="opacity-40">·</span>
                <span>updated {timeAgo(file.updatedAt)}</span>
              </div>
              {file.description ? <p className="mt-0.5 text-[11px] leading-relaxed text-secondary">{file.description}</p> : null}
            </div>
            <button type="button" onClick={() => onDeleteFile(file)} className={DANGER_TEXT_BUTTON_CLASS} disabled={fileBusy}>Delete</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function ProjectConversationList({
  conversations,
}: {
  conversations: ProjectDetail['linkedConversations'];
}) {
  if (conversations.length === 0) {
    return <p className="text-[12px] text-secondary">No linked conversations yet.</p>;
  }

  return (
    <div className="divide-y divide-border-subtle">
      {conversations.map((conversation) => (
        <a
          key={conversation.conversationId}
          href={`/conversations/${encodeURIComponent(conversation.conversationId)}`}
          className="block px-3 py-2.5 transition-colors hover:bg-surface/50"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-primary">{conversation.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-secondary" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{summarizeConversationMeta(conversation)}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
                <span>{conversation.lastActivityAt ? `updated ${timeAgo(conversation.lastActivityAt)}` : 'linked'}</span>
                {conversation.needsAttention ? (
                  <>
                    <span className="opacity-40">·</span>
                    <span>needs attention</span>
                  </>
                ) : null}
                {conversation.isRunning ? (
                  <>
                    <span className="opacity-40">·</span>
                    <span>running</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

export function ProjectDetailPanel({
  project,
  activeProfile,
  onChanged,
  onDeleted,
}: {
  project: ProjectDetail;
  activeProfile?: string;
  onChanged?: () => void;
  onDeleted?: (projectId: string) => void;
}) {
  const navigate = useNavigate();
  const record = project.project;
  const projectProfile = project.profile;
  const canStartConversation = !activeProfile || activeProfile === projectProfile;
  const archived = isProjectArchived(record);
  const activityItems = useMemo(() => buildActivityItems(project), [project]);
  const documentRecord = project.document;
  const fileCount = project.fileCount ?? project.files?.length ?? ((project.attachments?.length ?? 0) + (project.artifacts?.length ?? 0));
  const taskSummary = formatTaskSummary(project.tasks);
  const openTasks = project.tasks.filter((task) => !isTaskDone(task.status));
  const completedTasks = project.tasks.filter((task) => isTaskDone(task.status));
  const blockers = record.blockers.filter((blocker) => blocker.trim().length > 0);
  const projectApiOptions = { profile: projectProfile };
  const [projectForm, setProjectForm] = useState<ProjectFormState>(() => projectFormFromDetail(project));
  const [savedProjectForm, setSavedProjectForm] = useState<ProjectFormState>(() => projectFormFromDetail(project));
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectSavedAt, setProjectSavedAt] = useState<number | null>(null);
  const projectFormRef = useRef(projectForm);
  const savedProjectFormRef = useRef(savedProjectForm);
  const projectBusyRef = useRef(projectBusy);
  const projectSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectSaveQueuedRef = useRef(false);
  const projectIdRef = useRef(record.id);

  const [taskEditor, setTaskEditor] = useState<ProjectTaskEditorState | null>(null);
  const [taskForm, setTaskForm] = useState<TaskFormState>(() => emptyTaskForm());
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);

  const [documentContent, setDocumentContent] = useState(() => stripMatchingLeadingHeading(documentRecord?.content ?? '', record.title));
  const [savedDocumentContent, setSavedDocumentContent] = useState(() => stripMatchingLeadingHeading(documentRecord?.content ?? '', record.title));
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [documentSavedAt, setDocumentSavedAt] = useState<number | null>(null);
  const documentContentRef = useRef(documentContent);
  const savedDocumentContentRef = useRef(savedDocumentContent);
  const documentBusyRef = useRef(documentBusy);
  const documentSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const documentSaveQueuedRef = useRef(false);
  const documentUsesTitleHeadingRef = useRef(projectDocumentStartsWithTitleHeading(documentRecord?.content ?? '', record.title));

  const [noteEditor, setNoteEditor] = useState<ProjectNoteEditorState | null>(null);
  const [noteForm, setNoteForm] = useState<NoteFormState>(() => emptyNoteForm());
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const [fileUpload, setFileUpload] = useState<FileUploadState>(() => emptyFileUploadState());
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileComposerOpen, setFileComposerOpen] = useState(false);

  const [conversationBusy, setConversationBusy] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);

  const [rawProjectOpen, setRawProjectOpen] = useState(false);
  const [rawProjectLoaded, setRawProjectLoaded] = useState(false);
  const [rawProjectContent, setRawProjectContent] = useState('');
  const [rawProjectBusy, setRawProjectBusy] = useState(false);
  const [rawProjectError, setRawProjectError] = useState<string | null>(null);

  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    projectFormRef.current = projectForm;
  }, [projectForm]);

  useEffect(() => {
    savedProjectFormRef.current = savedProjectForm;
  }, [savedProjectForm]);

  useEffect(() => {
    projectBusyRef.current = projectBusy;
  }, [projectBusy]);

  useEffect(() => {
    documentContentRef.current = documentContent;
  }, [documentContent]);

  useEffect(() => {
    savedDocumentContentRef.current = savedDocumentContent;
  }, [savedDocumentContent]);

  useEffect(() => {
    documentBusyRef.current = documentBusy;
  }, [documentBusy]);

  useEffect(() => {
    const previousProjectId = projectIdRef.current;
    const previousSavedProjectForm = savedProjectFormRef.current;
    const nextProjectForm = projectFormFromDetail(project);
    const nextDocumentContent = stripMatchingLeadingHeading(documentRecord?.content ?? '', record.title);
    const previousSavedDocumentContent = savedDocumentContentRef.current;

    projectIdRef.current = record.id;
    savedProjectFormRef.current = nextProjectForm;
    documentUsesTitleHeadingRef.current = projectDocumentStartsWithTitleHeading(documentRecord?.content ?? '', record.title);
    setSavedProjectForm(nextProjectForm);
    setSavedDocumentContent(nextDocumentContent);
    setProjectForm((current) => {
      if (previousProjectId !== record.id || projectFormsEqual(current, previousSavedProjectForm)) {
        projectFormRef.current = nextProjectForm;
        return nextProjectForm;
      }

      return current;
    });
    setDocumentContent((current) => {
      if (previousProjectId !== record.id || current === previousSavedDocumentContent) {
        documentContentRef.current = nextDocumentContent;
        return nextDocumentContent;
      }

      return current;
    });
  }, [documentRecord?.content, project, record.id, record.title]);

  useEffect(() => {
    clearScheduledProjectSave();
    clearScheduledDocumentSave();
    projectSaveQueuedRef.current = false;
    documentSaveQueuedRef.current = false;
    setTaskEditor(null);
    setNoteEditor(null);
    setFileUpload(emptyFileUploadState());
    setFileComposerOpen(false);
    setShowCompletedTasks(false);
    setProjectError(null);
    setProjectSavedAt(null);
    setTaskError(null);
    setDocumentError(null);
    setDocumentSavedAt(null);
    setNoteError(null);
    setFileError(null);
    setConversationError(null);
    setArchiveError(null);
    setAdvancedOpen(false);
    setDeleteError(null);
    setRawProjectOpen(false);
    setRawProjectLoaded(false);
    setRawProjectContent('');
    setRawProjectError(null);
  }, [record.id]);

  useEffect(() => {
    if (projectSavedAt === null) {
      return undefined;
    }

    const timeout = setTimeout(() => setProjectSavedAt(null), 1800);
    return () => clearTimeout(timeout);
  }, [projectSavedAt]);

  useEffect(() => {
    if (documentSavedAt === null) {
      return undefined;
    }

    const timeout = setTimeout(() => setDocumentSavedAt(null), 1800);
    return () => clearTimeout(timeout);
  }, [documentSavedAt]);

  useEffect(() => () => {
    if (projectSaveTimerRef.current) {
      clearTimeout(projectSaveTimerRef.current);
      projectSaveTimerRef.current = null;
    }
    if (documentSaveTimerRef.current) {
      clearTimeout(documentSaveTimerRef.current);
      documentSaveTimerRef.current = null;
    }
  }, []);

  function clearScheduledProjectSave() {
    if (projectSaveTimerRef.current) {
      clearTimeout(projectSaveTimerRef.current);
      projectSaveTimerRef.current = null;
    }
  }

  function scheduleProjectSave(options: { immediate?: boolean } = {}) {
    clearScheduledProjectSave();

    if (options.immediate) {
      void flushProjectSave();
      return;
    }

    projectSaveTimerRef.current = setTimeout(() => {
      projectSaveTimerRef.current = null;
      void flushProjectSave();
    }, 500);
  }

  function clearScheduledDocumentSave() {
    if (documentSaveTimerRef.current) {
      clearTimeout(documentSaveTimerRef.current);
      documentSaveTimerRef.current = null;
    }
  }

  function scheduleDocumentSave(options: { immediate?: boolean } = {}) {
    clearScheduledDocumentSave();

    if (options.immediate) {
      void flushDocumentSave();
      return;
    }

    documentSaveTimerRef.current = setTimeout(() => {
      documentSaveTimerRef.current = null;
      void flushDocumentSave();
    }, 900);
  }

  function updateProjectFormField(patch: Partial<ProjectFormState>, options: { immediate?: boolean } = {}) {
    const nextProjectForm = { ...projectFormRef.current, ...patch };
    projectFormRef.current = nextProjectForm;
    setProjectForm(nextProjectForm);
    setProjectError(null);
    setProjectSavedAt(null);
    scheduleProjectSave(options);
  }

  async function flushProjectSave() {
    clearScheduledProjectSave();

    if (projectBusyRef.current) {
      projectSaveQueuedRef.current = true;
      return;
    }

    const draftProjectForm = projectFormRef.current;
    if (projectFormsEqual(draftProjectForm, savedProjectFormRef.current)) {
      projectSaveQueuedRef.current = false;
      return;
    }

    const normalizedProjectForm = normalizeProjectForm(draftProjectForm);
    if (!normalizedProjectForm.title) {
      setProjectError('Project title must not be empty.');
      return;
    }

    if (!normalizedProjectForm.summary) {
      setProjectError('Project summary must not be empty.');
      return;
    }

    if (!normalizedProjectForm.status) {
      setProjectError('Project status must not be empty.');
      return;
    }

    projectBusyRef.current = true;
    setProjectBusy(true);
    setProjectError(null);

    let saveSucceeded = false;

    try {
      await api.updateProject(record.id, {
        title: normalizedProjectForm.title,
        ...(record.summary.trim().length === 0 ? { description: normalizedProjectForm.summary } : {}),
        repoRoot: normalizedProjectForm.repoRoot || null,
        summary: normalizedProjectForm.summary,
        status: normalizedProjectForm.status,
      }, projectApiOptions);

      savedProjectFormRef.current = normalizedProjectForm;
      setSavedProjectForm(normalizedProjectForm);
      setProjectSavedAt(Date.now());
      if (projectFormsEqual(projectFormRef.current, draftProjectForm)) {
        projectFormRef.current = normalizedProjectForm;
        setProjectForm(normalizedProjectForm);
      }
      saveSucceeded = true;
      onChanged?.();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      projectBusyRef.current = false;
      setProjectBusy(false);
      const shouldSaveAgain = projectSaveQueuedRef.current || !projectFormsEqual(projectFormRef.current, savedProjectFormRef.current);
      projectSaveQueuedRef.current = false;
      if (saveSucceeded && shouldSaveAgain) {
        scheduleProjectSave({ immediate: true });
      }
    }
  }

  function updateDocumentContent(value: string) {
    documentContentRef.current = value;
    setDocumentContent(value);
    setDocumentError(null);
    setDocumentSavedAt(null);
  }

  async function flushDocumentSave() {
    clearScheduledDocumentSave();

    if (documentBusyRef.current) {
      documentSaveQueuedRef.current = true;
      return;
    }

    const draftDocumentContent = documentContentRef.current;
    if (draftDocumentContent === savedDocumentContentRef.current) {
      documentSaveQueuedRef.current = false;
      return;
    }

    documentBusyRef.current = true;
    setDocumentBusy(true);
    setDocumentError(null);

    let saveSucceeded = false;

    try {
      const nextContent = composeProjectDocumentContent(
        draftDocumentContent,
        projectFormRef.current.title || record.title,
        documentUsesTitleHeadingRef.current,
      );
      await api.saveProjectDocument(record.id, nextContent, projectApiOptions);
      savedDocumentContentRef.current = draftDocumentContent;
      setSavedDocumentContent(draftDocumentContent);
      setDocumentSavedAt(Date.now());
      saveSucceeded = true;
      onChanged?.();
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : String(error));
    } finally {
      documentBusyRef.current = false;
      setDocumentBusy(false);
      const shouldSaveAgain = documentSaveQueuedRef.current || documentContentRef.current !== savedDocumentContentRef.current;
      documentSaveQueuedRef.current = false;
      if (saveSucceeded && shouldSaveAgain) {
        scheduleDocumentSave({ immediate: true });
      }
    }
  }

  useEffect(() => {
    const nextSignature = documentContent.trim();
    const savedSignature = savedDocumentContent.trim();
    if (nextSignature.length === 0 && savedSignature.length === 0) {
      return;
    }

    if (documentContent === savedDocumentContent || documentBusy) {
      return;
    }

    scheduleDocumentSave();
    return () => clearScheduledDocumentSave();
  }, [documentBusy, documentContent, savedDocumentContent]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flushDocumentSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [documentContent, savedDocumentContent]);

  function openTaskAdd() {
    setTaskEditor({ mode: 'add' });
    setTaskForm(emptyTaskForm());
    setTaskError(null);
  }

  function openTaskEdit(task: ProjectTask) {
    setTaskEditor({ mode: 'edit', taskId: task.id });
    setTaskForm(taskFormFromTask(task));
    setTaskError(null);
  }

  function openNoteAdd() {
    setNoteEditor({ mode: 'add' });
    setNoteForm(emptyNoteForm());
    setNoteError(null);
  }

  function openNoteEdit(note: ProjectNote) {
    setNoteEditor({ mode: 'edit', noteId: note.id });
    setNoteForm(noteFormFromNote(note));
    setNoteError(null);
  }

  async function saveTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTaskBusy(true);
    setTaskError(null);

    try {
      if (taskEditor?.mode === 'edit') {
        await api.updateProjectTask(record.id, taskEditor.taskId, {
          title: taskForm.title.trim(),
          status: taskForm.status,
        }, projectApiOptions);
      } else {
        await api.createProjectTask(record.id, {
          title: taskForm.title.trim(),
          status: taskForm.status,
        }, projectApiOptions);
      }
      setTaskEditor(null);
      setTaskForm(emptyTaskForm());
      onChanged?.();
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : String(error));
    } finally {
      setTaskBusy(false);
    }
  }

  async function moveTask(taskId: string, direction: 'up' | 'down') {
    setTaskBusy(true);
    setTaskError(null);

    try {
      await api.moveProjectTask(record.id, taskId, direction, projectApiOptions);
      onChanged?.();
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : String(error));
    } finally {
      setTaskBusy(false);
    }
  }

  async function deleteTask(taskId: string) {
    if (!window.confirm(`Delete task ${taskId}?`)) {
      return;
    }

    setTaskBusy(true);
    setTaskError(null);

    try {
      await api.deleteProjectTask(record.id, taskId, projectApiOptions);
      if (taskEditor?.mode === 'edit' && taskEditor.taskId === taskId) {
        setTaskEditor(null);
      }
      onChanged?.();
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : String(error));
    } finally {
      setTaskBusy(false);
    }
  }

  async function saveNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNoteBusy(true);
    setNoteError(null);

    try {
      if (noteEditor?.mode === 'edit') {
        await api.updateProjectNote(record.id, noteEditor.noteId, {
          title: noteForm.title.trim(),
          kind: noteForm.kind,
          body: noteForm.body.trim() || undefined,
        }, projectApiOptions);
      } else {
        await api.createProjectNote(record.id, {
          title: noteForm.title.trim(),
          kind: noteForm.kind,
          body: noteForm.body.trim() || undefined,
        }, projectApiOptions);
      }
      setNoteEditor(null);
      setNoteForm(emptyNoteForm());
      onChanged?.();
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setNoteBusy(false);
    }
  }

  async function deleteNote(noteId: string) {
    if (!window.confirm(`Delete note ${noteId}?`)) {
      return;
    }

    setNoteBusy(true);
    setNoteError(null);

    try {
      await api.deleteProjectNote(record.id, noteId, projectApiOptions);
      if (noteEditor?.mode === 'edit' && noteEditor.noteId === noteId) {
        setNoteEditor(null);
      }
      onChanged?.();
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setNoteBusy(false);
    }
  }

  async function saveFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fileUpload.file) {
      setFileError('Pick a file first.');
      return;
    }

    setFileBusy(true);
    setFileError(null);

    try {
      const data = await fileToBase64(fileUpload.file);
      await api.uploadProjectFile(record.id, {
        name: fileUpload.file.name,
        mimeType: fileUpload.file.type || undefined,
        title: fileUpload.title.trim() || undefined,
        description: fileUpload.description.trim() || undefined,
        data,
      }, projectApiOptions);
      setFileUpload(emptyFileUploadState());
      setFileComposerOpen(false);
      onChanged?.();
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    } finally {
      setFileBusy(false);
    }
  }

  async function deleteFile(file: ProjectFile) {
    if (!window.confirm(`Delete ${file.originalName}?`)) {
      return;
    }

    setFileBusy(true);
    setFileError(null);

    try {
      await api.deleteProjectFile(record.id, file.id, projectApiOptions);
      onChanged?.();
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    } finally {
      setFileBusy(false);
    }
  }

  async function startConversationFromProject() {
    if (!canStartConversation) {
      return;
    }

    setConversationBusy(true);
    setConversationError(null);
    try {
      const { id } = await api.createLiveSession(undefined, [record.id]);
      navigate(`/conversations/${id}`);
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : String(error));
      setConversationBusy(false);
    }
  }

  function downloadProjectPackage() {
    const link = document.createElement('a');
    link.href = `/api/projects/${encodeURIComponent(record.id)}/package?viewProfile=${encodeURIComponent(projectProfile)}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function toggleRawProject() {
    if (rawProjectOpen) {
      setRawProjectOpen(false);
      return;
    }

    setAdvancedOpen(true);
    setRawProjectError(null);
    setRawProjectOpen(true);

    if (rawProjectLoaded) {
      return;
    }

    setRawProjectBusy(true);
    try {
      const source = await api.projectSource(record.id, projectApiOptions);
      setRawProjectContent(source.content);
      setRawProjectLoaded(true);
    } catch (error) {
      setRawProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setRawProjectBusy(false);
    }
  }

  async function saveRawProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRawProjectBusy(true);
    setRawProjectError(null);

    try {
      await api.saveProjectSource(record.id, rawProjectContent, projectApiOptions);
      onChanged?.();
    } catch (error) {
      setRawProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setRawProjectBusy(false);
    }
  }

  async function toggleArchive() {
    setArchiveBusy(true);
    setArchiveError(null);

    try {
      if (archived) {
        await api.unarchiveProject(record.id, projectApiOptions);
      } else {
        await api.archiveProject(record.id, projectApiOptions);
      }
      onChanged?.();
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : String(error));
    } finally {
      setArchiveBusy(false);
    }
  }

  async function deleteProject() {
    if (!window.confirm(`Delete project ${record.id}?`)) {
      return;
    }

    setDeleteBusy(true);
    setDeleteError(null);

    try {
      await api.deleteProject(record.id, projectApiOptions);
      onDeleted?.(record.id);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
      setDeleteBusy(false);
    }
  }

  const taskEditorForm = taskEditor ? (
    <ProjectTaskEditorForm
      editor={taskEditor}
      value={taskForm}
      statuses={TASK_STATUSES}
      error={taskError}
      busy={taskBusy}
      onChange={(patch) => setTaskForm((current) => ({ ...current, ...patch }))}
      onCancel={() => setTaskEditor(null)}
      onSubmit={saveTask}
    />
  ) : null;

  const noteEditorForm = noteEditor ? (
    <ProjectNoteEditorForm
      editor={noteEditor}
      value={noteForm}
      kinds={PROJECT_NOTE_KINDS}
      error={noteError}
      busy={noteBusy}
      onChange={(patch) => setNoteForm((current) => ({ ...current, ...patch }))}
      onCancel={() => setNoteEditor(null)}
      onSubmit={saveNote}
    />
  ) : null;

  const fileUploadForm = fileComposerOpen ? (
    <ProjectFileUploadForm
      value={fileUpload}
      error={fileError}
      busy={fileBusy}
      onChange={(patch) => setFileUpload((current) => ({ ...current, ...patch }))}
      onSubmit={saveFile}
    />
  ) : null;

  const projectSaveMessage = projectError ?? (projectBusy ? 'Saving…' : (projectSavedAt ? 'Saved' : null));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18.5rem]">
      <div className="min-w-0 space-y-6">
        <section className="space-y-4 pb-1">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-dim">
              <span>Projects</span>
              <span className="opacity-40">›</span>
              <span className="font-mono text-secondary">{record.id}</span>
            </div>

            <div className={PROJECT_TOOLBAR_GROUP_CLASS}>
              <IconButton
                type="button"
                onClick={() => { void startConversationFromProject(); }}
                disabled={conversationBusy || deleteBusy || !canStartConversation}
                className={PROJECT_TOOLBAR_PRIMARY_BUTTON_CLASS}
                title="Start conversation"
                aria-label="Start conversation"
              >
                <ToolbarGlyph path="M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25H13.5l-3 3v-3H6.75A2.25 2.25 0 0 1 4.5 14.25v-7.5Z" />
              </IconButton>
              <IconButton
                type="button"
                onClick={() => setAdvancedOpen((value) => !value)}
                disabled={deleteBusy}
                className={PROJECT_TOOLBAR_BUTTON_CLASS}
                title={advancedOpen ? 'Hide more' : 'More'}
                aria-label={advancedOpen ? 'Hide more' : 'More'}
              >
                <ToolbarGlyph path="M12 6.5h.01M12 12h.01M12 17.5h.01" />
              </IconButton>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={toneForProjectStatus(projectForm.status, archived)}>
                {formatProjectStatus(projectForm.status)}
              </Pill>
              <span className="text-[11px] text-dim">updated {timeAgo(record.updatedAt)}</span>
              {archived && record.archivedAt && <span className="text-[11px] text-dim">archived {timeAgo(record.archivedAt)}</span>}
              {projectSaveMessage ? (
                <span className={cx('text-[11px]', projectError ? 'text-danger' : 'text-dim')}>
                  {projectSaveMessage}
                </span>
              ) : null}
            </div>

            <div className="space-y-2">
              <h1 className="m-0">
                <input
                  aria-label="Project title"
                  name="project-title"
                  autoComplete="off"
                  value={projectForm.title}
                  onChange={(event) => updateProjectFormField({ title: event.target.value })}
                  onBlur={() => { void flushProjectSave(); }}
                  className={PROJECT_INLINE_TITLE_INPUT_CLASS}
                  placeholder="Project title"
                />
              </h1>
              <MentionTextarea
                aria-label="Project summary"
                name="project-summary"
                autoComplete="off"
                value={projectForm.summary}
                onValueChange={(summary) => updateProjectFormField({ summary })}
                onBlur={() => { void flushProjectSave(); }}
                className={PROJECT_INLINE_SUMMARY_CLASS}
                placeholder="Add a short project summary…"
              />
              {record.currentFocus?.trim() ? (
                <p className="text-[12px] text-dim">Current focus · {record.currentFocus.trim()}</p>
              ) : null}
            </div>
          </div>
        </section>

        <ProjectSection
          title="Document"
          meta={documentError
            ? documentError
            : documentBusy
              ? 'Saving…'
              : documentContent !== savedDocumentContent
                ? 'Unsaved changes'
                : documentRecord
                  ? `Updated ${timeAgo(documentRecord.updatedAt)}`
                  : (documentSavedAt ? 'Saved' : 'Start writing')}
        >
          <ProjectDocumentContent
            content={documentContent}
            busy={documentBusy}
            dirty={documentContent !== savedDocumentContent}
            error={documentError}
            onChange={updateDocumentContent}
          />
        </ProjectSection>

        <ProjectSection
          title="Activity"
          meta={activityItems.length > 0 ? `${activityItems.length} recent ${activityItems.length === 1 ? 'event' : 'events'}` : 'No activity yet'}
        >
          <ProjectActivityContent items={activityItems} />
        </ProjectSection>

        <ProjectSection
          title="Tasks"
          meta={`${taskSummary.open} open · ${taskSummary.done} done`}
          action={(
            <button type="button" onClick={openTaskAdd} className={ACTION_TEXT_BUTTON_CLASS} disabled={taskBusy}>
              + Add task
            </button>
          )}
        >
          <div className="overflow-hidden rounded-xl border border-border-subtle bg-transparent">
            {taskEditor?.mode === 'add' ? <div className="px-3 py-3">{taskEditorForm}</div> : null}
            <ProjectTaskListBlock
              tasks={openTasks}
              taskEditorTaskId={taskEditor?.mode === 'edit' ? taskEditor.taskId : null}
              taskEditorForm={taskEditorForm}
              busy={taskBusy}
              onMoveTask={(taskId, direction) => { void moveTask(taskId, direction); }}
              onEditTask={openTaskEdit}
              onDeleteTask={(taskId) => { void deleteTask(taskId); }}
              emptyLabel={completedTasks.length > 0 ? 'No open tasks.' : 'No tasks yet.'}
            />
            {completedTasks.length > 0 ? (
              <div className="border-t border-border-subtle px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setShowCompletedTasks((value) => !value)}
                  className={ACTION_TEXT_BUTTON_CLASS}
                >
                  {showCompletedTasks ? 'Hide completed tasks' : `Show completed tasks (${completedTasks.length})`}
                </button>
              </div>
            ) : null}
            {showCompletedTasks ? (
              <div className="border-t border-border-subtle bg-base/10">
                <ProjectTaskListBlock
                  tasks={completedTasks}
                  taskEditorTaskId={taskEditor?.mode === 'edit' ? taskEditor.taskId : null}
                  taskEditorForm={taskEditorForm}
                  busy={taskBusy}
                  onMoveTask={(taskId, direction) => { void moveTask(taskId, direction); }}
                  onEditTask={openTaskEdit}
                  onDeleteTask={(taskId) => { void deleteTask(taskId); }}
                />
              </div>
            ) : null}
          </div>
          {taskError && !taskEditor ? <p className="text-[12px] text-danger">{taskError}</p> : null}
        </ProjectSection>
      </div>

      <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
        {!canStartConversation && activeProfile ? (
          <p className="text-[12px] leading-relaxed text-secondary">
            Switch the active profile to <span className="font-mono text-primary">{projectProfile}</span> in Settings before starting a conversation from this project.
          </p>
        ) : null}
        {(conversationError || archiveError || deleteError) ? <p className="text-[12px] text-danger">{conversationError ?? archiveError ?? deleteError}</p> : null}

        {advancedOpen ? (
          <ProjectRailSection title="More">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={downloadProjectPackage} className={RAIL_SECONDARY_BUTTON_CLASS}>Export</button>
                <button type="button" onClick={() => { void toggleArchive(); }} className={RAIL_SECONDARY_BUTTON_CLASS} disabled={archiveBusy || deleteBusy}>
                  {archiveBusy ? (archived ? 'Restoring…' : 'Archiving…') : (archived ? 'Restore' : 'Archive')}
                </button>
                <button type="button" onClick={() => { void toggleRawProject(); }} className={RAIL_SECONDARY_BUTTON_CLASS} disabled={deleteBusy}>
                  {rawProjectOpen ? 'Hide YAML' : 'Raw YAML'}
                </button>
                <button type="button" onClick={() => { void deleteProject(); }} className={DANGER_TEXT_BUTTON_CLASS} disabled={deleteBusy}>
                  {deleteBusy ? 'Deleting…' : 'Delete project'}
                </button>
              </div>
              {rawProjectOpen ? (
                <ProjectRecordViewer
                  repoRoot={record.repoRoot}
                  summary={record.summary}
                  rawProjectOpen={rawProjectOpen}
                  rawProjectContent={rawProjectContent}
                  rawProjectBusy={rawProjectBusy}
                  rawProjectError={rawProjectError}
                  onRawProjectContentChange={setRawProjectContent}
                  onRawProjectSubmit={saveRawProject}
                  showSummary={false}
                />
              ) : null}
            </div>
          </ProjectRailSection>
        ) : null}

        <ProjectRailSection title="Properties">
          <div className="space-y-3">
            <ProjectPropertyRow
              label="Status"
              value={(
                <select
                  aria-label="Project status"
                  name="project-status"
                  value={projectForm.status}
                  onChange={(event) => updateProjectFormField({ status: event.target.value }, { immediate: true })}
                  onBlur={() => { void flushProjectSave(); }}
                  className={PROJECT_PROPERTY_SELECT_CLASS}
                >
                  {PROJECT_STATUSES.map((status) => (
                    <option key={status} value={status}>{formatProjectStatus(status)}</option>
                  ))}
                </select>
              )}
            />
            <ProjectPropertyRow label="Profile" value={projectProfile} />
            <ProjectPropertyRow label="Updated" value={timeAgo(record.updatedAt)} />
            <ProjectPropertyRow
              label="Repo root"
              value={(
                <input
                  aria-label="Project repo root"
                  name="project-repo-root"
                  autoComplete="off"
                  spellCheck={false}
                  value={projectForm.repoRoot}
                  onChange={(event) => updateProjectFormField({ repoRoot: event.target.value })}
                  onBlur={() => { void flushProjectSave(); }}
                  className={cx(PROJECT_PROPERTY_INPUT_CLASS, 'font-mono')}
                  placeholder="Add repo root…"
                />
              )}
            />
            {record.currentFocus?.trim() ? <ProjectPropertyRow label="Current focus" value={record.currentFocus.trim()} /> : null}
            {blockers.length > 0 ? (
              <ProjectPropertyRow
                label="Blockers"
                value={(
                  <ul className="list-disc space-y-1 pl-4 text-[12px] text-secondary">
                    {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                  </ul>
                )}
              />
            ) : null}
          </div>
        </ProjectRailSection>

        <ProjectRailSection
          title="Linked conversations"
          meta={`${project.linkedConversations.length} ${project.linkedConversations.length === 1 ? 'conversation' : 'conversations'}`}
        >
          <ProjectConversationList conversations={project.linkedConversations} />
        </ProjectRailSection>

        <ProjectRailSection
          title="Notes"
          meta={`${project.noteCount ?? project.notes.length} ${project.notes.length === 1 ? 'note' : 'notes'}`}
          action={(
            <button
              type="button"
              onClick={() => {
                if (noteEditor?.mode === 'add') {
                  setNoteEditor(null);
                  return;
                }
                openNoteAdd();
              }}
              className={ACTION_TEXT_BUTTON_CLASS}
              disabled={noteBusy}
            >
              {noteEditor?.mode === 'add' ? 'Cancel' : '+ Add note'}
            </button>
          )}
        >
          <ProjectNoteList
            notes={project.notes}
            noteEditor={noteEditor}
            noteEditorForm={noteEditorForm}
            noteBusy={noteBusy}
            onEditNote={openNoteEdit}
            onDeleteNote={(noteId) => { void deleteNote(noteId); }}
          />
          {noteError && !noteEditor ? <p className="mt-2 text-[12px] text-danger">{noteError}</p> : null}
        </ProjectRailSection>

        <ProjectRailSection
          title="Files"
          meta={`${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}
          action={(
            <button
              type="button"
              onClick={() => {
                setFileError(null);
                setFileComposerOpen((value) => !value);
              }}
              className={ACTION_TEXT_BUTTON_CLASS}
              disabled={fileBusy}
            >
              {fileComposerOpen ? 'Cancel' : 'Upload file'}
            </button>
          )}
        >
          <div className="space-y-2.5">
            {fileUploadForm}
            <ProjectFileList files={project.files} fileBusy={fileBusy} onDeleteFile={(file) => { void deleteFile(file); }} />
            {fileError && !fileComposerOpen ? <p className="text-[12px] text-danger">{fileError}</p> : null}
          </div>
        </ProjectRailSection>
      </aside>
    </div>
  );
}
