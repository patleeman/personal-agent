import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { api } from '../api';
import {
  formatProjectStatus,
  getPlanProgress,
  hasMeaningfulBlockers,
  pickCurrentMilestone,
} from '../contextRailProject';
import type { ProjectDetail, ProjectFile, ProjectLinkedConversation, ProjectMilestone, ProjectNote, ProjectTask } from '../types';
import { timeAgo } from '../utils';
import { EmptyState, Pill, SectionLabel, ToolbarButton, cx, type PillTone } from './ui';

const INPUT_CLASS = 'w-full rounded-xl border border-border-default bg-base px-4 py-3 text-[15px] leading-relaxed text-primary focus:outline-none focus:border-accent/60';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[132px] resize-y`;
const SELECT_CLASS = `${INPUT_CLASS} pr-10`;
const ACTION_BUTTON_CLASS = 'text-[12px] text-accent hover:text-accent/70 transition-colors disabled:opacity-40';
const STATUS_ACTION_BUTTON_CLASS = 'rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors disabled:opacity-40';

const PROJECT_STATUSES = ['created', 'in_progress', 'blocked', 'completed', 'cancelled'];
const MILESTONE_STATUSES = ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'];
const MILESTONE_QUICK_STATUSES = ['pending', 'in_progress', 'blocked', 'completed'];
const TASK_STATUSES = ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'];
const PROJECT_NOTE_KINDS = ['note', 'decision', 'question', 'meeting', 'checkpoint'];
const UNASSIGNED_TASK_KEY = '__unassigned__';

interface DetailSectionProps {
  id: string;
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

interface ProjectFormState {
  title: string;
  description: string;
  repoRoot: string;
  summary: string;
  status: string;
  currentFocus: string;
  blockers: string;
  recentProgress: string;
}

interface MilestoneFormState {
  title: string;
  status: string;
  summary: string;
  makeCurrent: boolean;
}

interface TaskFormState {
  title: string;
  status: string;
  milestoneId: string;
}

interface NoteFormState {
  title: string;
  kind: string;
  body: string;
}

interface FileUploadState {
  kind: 'attachment' | 'artifact';
  title: string;
  description: string;
  file: File | null;
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

function detailSection({ id, title, meta, actions, children }: DetailSectionProps) {
  return (
    <section id={id} className="border-t border-border-subtle pt-8 space-y-5 scroll-mt-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <SectionLabel label={title} />
        <div className="flex items-center gap-3 flex-wrap">
          {meta && <div className="ui-card-meta">{meta}</div>}
          {actions}
        </div>
      </div>
      {children}
    </section>
  );
}

function projectFormFromDetail(project: ProjectDetail): ProjectFormState {
  return {
    title: project.project.title,
    description: project.project.description,
    repoRoot: project.project.repoRoot ?? '',
    summary: project.project.summary,
    status: project.project.status,
    currentFocus: project.project.currentFocus ?? '',
    blockers: project.project.blockers.join('\n'),
    recentProgress: project.project.recentProgress.join('\n'),
  };
}

function emptyMilestoneForm(): MilestoneFormState {
  return {
    title: '',
    status: 'pending',
    summary: '',
    makeCurrent: false,
  };
}

function milestoneFormFromMilestone(milestone: ProjectMilestone, isCurrent: boolean): MilestoneFormState {
  return {
    title: milestone.title,
    status: milestone.status,
    summary: milestone.summary ?? '',
    makeCurrent: isCurrent,
  };
}

function emptyTaskForm(): TaskFormState {
  return {
    title: '',
    status: 'pending',
    milestoneId: '',
  };
}

function taskFormFromTask(task: ProjectTask): TaskFormState {
  return {
    title: task.title,
    status: task.status,
    milestoneId: task.milestoneId ?? '',
  };
}

function emptyNoteForm(): NoteFormState {
  return {
    title: '',
    kind: 'note',
    body: '',
  };
}

function noteFormFromNote(note: ProjectNote): NoteFormState {
  return {
    title: note.title,
    kind: note.kind,
    body: note.body,
  };
}

function emptyFileUploadState(): FileUploadState {
  return {
    kind: 'attachment',
    title: '',
    description: '',
    file: null,
  };
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

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function DetailSection(props: DetailSectionProps) {
  return detailSection(props);
}

export function ProjectDetailPanel({
  project,
  onChanged,
  onDeleted,
}: {
  project: ProjectDetail;
  onChanged?: () => void;
  onDeleted?: (projectId: string) => void;
}) {
  const navigate = useNavigate();
  const record = project.project;
  const blockers = record.blockers.filter((blocker) => blocker.trim().length > 0);
  const recentProgress = record.recentProgress.filter((item) => item.trim().length > 0);
  const milestones = record.plan.milestones;
  const currentMilestone = pickCurrentMilestone(record.plan);
  const { done, total, pct } = getPlanProgress(milestones);
  const tasksByMilestone = new Map<string, ProjectTask[]>();

  project.tasks.forEach((task) => {
    const milestoneKey = task.milestoneId ?? UNASSIGNED_TASK_KEY;
    const existing = tasksByMilestone.get(milestoneKey) ?? [];
    existing.push(task);
    tasksByMilestone.set(milestoneKey, existing);
  });

  const unassignedTasks = tasksByMilestone.get(UNASSIGNED_TASK_KEY) ?? [];

  const [editingProject, setEditingProject] = useState(false);
  const [projectForm, setProjectForm] = useState<ProjectFormState>(() => projectFormFromDetail(project));
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  const [milestoneEditor, setMilestoneEditor] = useState<{ mode: 'add' } | { mode: 'edit'; milestoneId: string } | null>(null);
  const [milestoneForm, setMilestoneForm] = useState<MilestoneFormState>(() => emptyMilestoneForm());
  const [milestoneBusy, setMilestoneBusy] = useState(false);
  const [milestoneError, setMilestoneError] = useState<string | null>(null);

  const [taskEditor, setTaskEditor] = useState<
    | { mode: 'add'; anchorMilestoneId?: string }
    | { mode: 'edit'; taskId: string; anchorMilestoneId?: string }
    | null
  >(null);
  const [taskForm, setTaskForm] = useState<TaskFormState>(() => emptyTaskForm());
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);

  const [briefEditing, setBriefEditing] = useState(false);
  const [briefContent, setBriefContent] = useState(project.brief?.content ?? '');
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const [noteEditor, setNoteEditor] = useState<{ mode: 'add' } | { mode: 'edit'; noteId: string } | null>(null);
  const [noteForm, setNoteForm] = useState<NoteFormState>(() => emptyNoteForm());
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const [fileUpload, setFileUpload] = useState<FileUploadState>(() => emptyFileUploadState());
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [conversationBusy, setConversationBusy] = useState(false);

  const [rawProjectOpen, setRawProjectOpen] = useState(false);
  const [rawProjectLoaded, setRawProjectLoaded] = useState(false);
  const [rawProjectContent, setRawProjectContent] = useState('');
  const [rawProjectBusy, setRawProjectBusy] = useState(false);
  const [rawProjectError, setRawProjectError] = useState<string | null>(null);

  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!editingProject) {
      setProjectForm(projectFormFromDetail(project));
    }
  }, [editingProject, project]);

  useEffect(() => {
    setMilestoneEditor(null);
    setMilestoneForm(emptyMilestoneForm());
    setMilestoneError(null);
    setTaskEditor(null);
    setTaskForm(emptyTaskForm());
    setTaskError(null);
    setBriefEditing(false);
    setBriefContent(project.brief?.content ?? '');
    setBriefError(null);
    setNoteEditor(null);
    setNoteForm(emptyNoteForm());
    setNoteError(null);
    setFileUpload(emptyFileUploadState());
    setFileError(null);
    setRawProjectLoaded(false);
    setRawProjectError(null);
    setDeleteError(null);
    if (!rawProjectOpen) {
      setRawProjectContent('');
    }
  }, [project, rawProjectOpen]);

  async function handleProjectSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProjectBusy(true);
    setProjectError(null);

    try {
      await api.updateProject(record.id, {
        title: projectForm.title,
        description: projectForm.description,
        repoRoot: projectForm.repoRoot.trim() || null,
        summary: projectForm.summary,
        status: projectForm.status,
        currentFocus: projectForm.currentFocus.trim() || null,
        blockers: splitLines(projectForm.blockers),
        recentProgress: splitLines(projectForm.recentProgress),
      });
      setEditingProject(false);
      onChanged?.();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectBusy(false);
    }
  }

  function openMilestoneAdd() {
    setMilestoneEditor({ mode: 'add' });
    setMilestoneForm(emptyMilestoneForm());
    setMilestoneError(null);
  }

  function openMilestoneEdit(milestone: ProjectMilestone) {
    setMilestoneEditor({ mode: 'edit', milestoneId: milestone.id });
    setMilestoneForm(milestoneFormFromMilestone(milestone, currentMilestone?.id === milestone.id));
    setMilestoneError(null);
  }

  async function saveMilestone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!milestoneEditor) return;

    setMilestoneBusy(true);
    setMilestoneError(null);

    try {
      if (milestoneEditor.mode === 'add') {
        await api.addProjectMilestone(record.id, {
          title: milestoneForm.title,
          status: milestoneForm.status,
          summary: milestoneForm.summary.trim() || undefined,
          makeCurrent: milestoneForm.makeCurrent,
        });
      } else {
        await api.updateProjectMilestone(record.id, milestoneEditor.milestoneId, {
          title: milestoneForm.title,
          status: milestoneForm.status,
          summary: milestoneForm.summary.trim() || null,
          makeCurrent: milestoneForm.makeCurrent,
        });
      }

      setMilestoneEditor(null);
      setMilestoneForm(emptyMilestoneForm());
      onChanged?.();
    } catch (error) {
      setMilestoneError(error instanceof Error ? error.message : String(error));
    } finally {
      setMilestoneBusy(false);
    }
  }

  async function makeMilestoneCurrent(milestoneId: string) {
    setMilestoneBusy(true);
    setMilestoneError(null);

    try {
      await api.updateProject(record.id, { currentMilestoneId: milestoneId });
      onChanged?.();
    } catch (error) {
      setMilestoneError(error instanceof Error ? error.message : String(error));
    } finally {
      setMilestoneBusy(false);
    }
  }

  async function setMilestoneStatus(milestoneId: string, status: string) {
    setMilestoneBusy(true);
    setMilestoneError(null);

    try {
      await api.updateProjectMilestone(record.id, milestoneId, status === 'in_progress'
        ? { status, makeCurrent: true }
        : { status });

      const isCurrent = currentMilestone?.id === milestoneId;
      if (isCurrent && (status === 'completed' || status === 'cancelled')) {
        const nextCurrentMilestone = milestones.find((milestone) => (
          milestone.id !== milestoneId
          && milestone.status !== 'completed'
          && milestone.status !== 'cancelled'
        ));
        await api.updateProject(record.id, { currentMilestoneId: nextCurrentMilestone?.id ?? null });
      }

      onChanged?.();
    } catch (error) {
      setMilestoneError(error instanceof Error ? error.message : String(error));
    } finally {
      setMilestoneBusy(false);
    }
  }

  function openTaskAdd(milestoneId = '') {
    setTaskEditor({ mode: 'add', anchorMilestoneId: milestoneId || undefined });
    setTaskForm({
      ...emptyTaskForm(),
      milestoneId,
    });
    setTaskError(null);
  }

  function openTaskEdit(task: ProjectTask) {
    setTaskEditor({ mode: 'edit', taskId: task.id, anchorMilestoneId: task.milestoneId });
    setTaskForm(taskFormFromTask(task));
    setTaskError(null);
  }

  async function saveTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskEditor) return;

    setTaskBusy(true);
    setTaskError(null);

    try {
      const payload = {
        title: taskForm.title,
        status: taskForm.status,
        milestoneId: taskForm.milestoneId.trim() || null,
      };

      if (taskEditor.mode === 'add') {
        await api.createProjectTask(record.id, payload);
      } else {
        await api.updateProjectTask(record.id, taskEditor.taskId, payload);
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

  async function moveMilestone(milestoneId: string, direction: 'up' | 'down') {
    setMilestoneBusy(true);
    setMilestoneError(null);

    try {
      await api.moveProjectMilestone(record.id, milestoneId, direction);
      onChanged?.();
    } catch (error) {
      setMilestoneError(error instanceof Error ? error.message : String(error));
    } finally {
      setMilestoneBusy(false);
    }
  }

  async function deleteMilestone(milestoneId: string) {
    if (!window.confirm(`Delete milestone ${milestoneId}?`)) {
      return;
    }

    setMilestoneBusy(true);
    setMilestoneError(null);

    try {
      await api.deleteProjectMilestone(record.id, milestoneId);
      if (milestoneEditor?.mode === 'edit' && milestoneEditor.milestoneId === milestoneId) {
        setMilestoneEditor(null);
      }
      onChanged?.();
    } catch (error) {
      setMilestoneError(error instanceof Error ? error.message : String(error));
    } finally {
      setMilestoneBusy(false);
    }
  }

  async function moveTask(taskId: string, direction: 'up' | 'down') {
    setTaskBusy(true);
    setTaskError(null);

    try {
      await api.moveProjectTask(record.id, taskId, direction);
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
      await api.deleteProjectTask(record.id, taskId);
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

  async function toggleRawProject() {
    const nextOpen = !rawProjectOpen;
    setRawProjectOpen(nextOpen);
    setRawProjectError(null);

    if (!nextOpen || rawProjectLoaded || rawProjectBusy) {
      return;
    }

    setRawProjectBusy(true);
    try {
      const source = await api.projectSource(record.id);
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
      await api.saveProjectSource(record.id, rawProjectContent);
      onChanged?.();
    } catch (error) {
      setRawProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setRawProjectBusy(false);
    }
  }

  async function deleteProject() {
    if (!window.confirm(`Delete project ${record.id}? This removes PROJECT.yaml, notes, attachments, and artifacts.`)) {
      return;
    }

    setDeleteBusy(true);
    setDeleteError(null);

    try {
      await api.deleteProject(record.id);
      setDeleteBusy(false);
      onDeleted?.(record.id);
      return;
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
      setDeleteBusy(false);
    }
  }

  async function saveBrief(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBriefBusy(true);
    setBriefError(null);

    try {
      await api.saveProjectBrief(record.id, briefContent);
      setBriefEditing(false);
      onChanged?.();
    } catch (error) {
      setBriefError(error instanceof Error ? error.message : String(error));
    } finally {
      setBriefBusy(false);
    }
  }

  async function regenerateBrief() {
    setBriefBusy(true);
    setBriefError(null);

    try {
      await api.regenerateProjectBrief(record.id);
      setBriefEditing(false);
      onChanged?.();
    } catch (error) {
      setBriefError(error instanceof Error ? error.message : String(error));
    } finally {
      setBriefBusy(false);
    }
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

  async function saveNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!noteEditor) {
      return;
    }

    setNoteBusy(true);
    setNoteError(null);

    try {
      if (noteEditor.mode === 'add') {
        await api.createProjectNote(record.id, noteForm);
      } else {
        await api.updateProjectNote(record.id, noteEditor.noteId, noteForm);
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
      await api.deleteProjectNote(record.id, noteId);
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

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function saveFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fileUpload.file) {
      setFileError('Choose a file to upload.');
      return;
    }

    setFileBusy(true);
    setFileError(null);

    try {
      const data = await fileToBase64(fileUpload.file);
      await api.uploadProjectFile(record.id, {
        kind: fileUpload.kind,
        name: fileUpload.file.name,
        mimeType: fileUpload.file.type || undefined,
        title: fileUpload.title.trim() || undefined,
        description: fileUpload.description.trim() || undefined,
        data,
      });
      setFileUpload(emptyFileUploadState());
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
      await api.deleteProjectFile(record.id, file.kind, file.id);
      onChanged?.();
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    } finally {
      setFileBusy(false);
    }
  }

  async function startConversationFromProject() {
    setConversationBusy(true);
    try {
      const { id } = await api.createLiveSession(undefined, [record.id]);
      navigate(`/conversations/${id}`);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
      setConversationBusy(false);
    }
  }

  function renderTaskEditorForm() {
    if (!taskEditor) {
      return null;
    }

    return (
      <form onSubmit={saveTask} className="space-y-5 border border-border-subtle rounded-xl px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="ui-card-meta">{taskEditor.mode === 'add' ? 'New task' : `Edit task ${taskEditor.taskId}`}</p>
          <button type="button" onClick={() => setTaskEditor(null)} className={ACTION_BUTTON_CLASS}>Cancel</button>
        </div>

        {taskEditor.mode === 'edit' && (
          <p className="ui-card-meta font-mono">{taskEditor.taskId}</p>
        )}

        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_15rem_15rem]">
          <div className="space-y-1.5">
            <label className="ui-card-meta">Title</label>
            <input
              value={taskForm.title}
              onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))}
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-1.5">
            <label className="ui-card-meta">Status</label>
            <select
              value={taskForm.status}
              onChange={(event) => setTaskForm((current) => ({ ...current, status: event.target.value }))}
              className={SELECT_CLASS}
            >
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>{formatProjectStatus(status)}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="ui-card-meta">Milestone</label>
            <select
              value={taskForm.milestoneId}
              onChange={(event) => setTaskForm((current) => ({ ...current, milestoneId: event.target.value }))}
              className={SELECT_CLASS}
            >
              <option value="">No milestone</option>
              {milestones.map((milestone) => (
                <option key={milestone.id} value={milestone.id}>{milestone.title}</option>
              ))}
            </select>
          </div>
        </div>

        {taskError && <p className="text-[12px] text-danger">{taskError}</p>}

        <div className="flex items-center gap-3">
          <ToolbarButton type="submit" disabled={taskBusy}>{taskBusy ? 'Saving…' : 'Save task'}</ToolbarButton>
        </div>
      </form>
    );
  }

  function renderTaskCard(task: ProjectTask, taskIndex: number, taskCount: number) {
    const isEditing = taskEditor?.mode === 'edit' && taskEditor.taskId === task.id;

    if (isEditing) {
      return (
        <div key={task.id} id={`project-task-${task.id}`} className="py-4 scroll-mt-6">
          {renderTaskEditorForm()}
        </div>
      );
    }

    return (
      <article key={task.id} id={`project-task-${task.id}`} className="py-4 scroll-mt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-medium leading-relaxed text-primary">{task.title}</p>
              <span className="ui-card-meta font-mono">{task.id}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
            <button type="button" onClick={() => { void moveTask(task.id, 'up'); }} className={ACTION_BUTTON_CLASS} disabled={taskBusy || taskIndex === 0}>↑</button>
            <button type="button" onClick={() => { void moveTask(task.id, 'down'); }} className={ACTION_BUTTON_CLASS} disabled={taskBusy || taskIndex === taskCount - 1}>↓</button>
            <button type="button" onClick={() => openTaskEdit(task)} className={ACTION_BUTTON_CLASS}>Edit</button>
            <button type="button" onClick={() => { void deleteTask(task.id); }} className="text-[12px] text-danger hover:text-danger/75 transition-colors disabled:opacity-40" disabled={taskBusy}>Delete</button>
            <Pill tone={toneForStatus(task.status)}>{formatProjectStatus(task.status)}</Pill>
          </div>
        </div>
      </article>
    );
  }

  function renderNoteEditorForm() {
    if (!noteEditor) {
      return null;
    }

    return (
      <form onSubmit={saveNote} className="space-y-5 border border-border-subtle rounded-xl px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="ui-card-meta">{noteEditor.mode === 'add' ? 'New note' : `Edit note ${noteEditor.noteId}`}</p>
          <button type="button" onClick={() => setNoteEditor(null)} className={ACTION_BUTTON_CLASS}>Cancel</button>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="space-y-1.5">
            <label className="ui-card-meta">Title</label>
            <input
              value={noteForm.title}
              onChange={(event) => setNoteForm((current) => ({ ...current, title: event.target.value }))}
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-1.5">
            <label className="ui-card-meta">Kind</label>
            <select
              value={noteForm.kind}
              onChange={(event) => setNoteForm((current) => ({ ...current, kind: event.target.value }))}
              className={SELECT_CLASS}
            >
              {PROJECT_NOTE_KINDS.map((kind) => (
                <option key={kind} value={kind}>{formatProjectStatus(kind)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="ui-card-meta">Body</label>
          <textarea
            value={noteForm.body}
            onChange={(event) => setNoteForm((current) => ({ ...current, body: event.target.value }))}
            className={TEXTAREA_CLASS}
          />
        </div>

        {noteError && <p className="text-[12px] text-danger">{noteError}</p>}

        <div className="flex items-center gap-3">
          <ToolbarButton type="submit" disabled={noteBusy}>{noteBusy ? 'Saving…' : 'Save note'}</ToolbarButton>
        </div>
      </form>
    );
  }

  function renderFileCard(file: ProjectFile) {
    return (
      <article key={file.id} className="py-4 flex items-start justify-between gap-4">
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
        <button type="button" onClick={() => { void deleteFile(file); }} className="text-[12px] text-danger hover:text-danger/75 transition-colors disabled:opacity-40" disabled={fileBusy}>
          Delete
        </button>
      </article>
    );
  }

  return (
    <div className="min-w-0 space-y-10 px-4 py-3">
      <section className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="font-mono text-secondary">{record.id}</span>
          <span className="text-dim">updated {timeAgo(record.updatedAt)}</span>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3 min-w-0">
              <h2 className="max-w-4xl text-[26px] leading-[1.2] font-semibold tracking-tight text-primary">
                {record.title}
              </h2>
              <p className="max-w-4xl text-[15px] leading-relaxed text-secondary">
                {record.description}
              </p>
            </div>
            <ToolbarButton onClick={() => { void startConversationFromProject(); }} disabled={conversationBusy || deleteBusy}>
              {conversationBusy ? 'Starting…' : 'Start conversation'}
            </ToolbarButton>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Pill tone={hasMeaningfulBlockers(record.blockers) ? 'warning' : 'teal'}>
              {formatProjectStatus(record.status)}
            </Pill>
            <span className="ui-card-meta">{milestones.length} {milestones.length === 1 ? 'milestone' : 'milestones'}</span>
            <span className="ui-card-meta">{project.taskCount} {project.taskCount === 1 ? 'task' : 'tasks'}</span>
            <span className="ui-card-meta">{project.noteCount} {project.noteCount === 1 ? 'note' : 'notes'}</span>
            <span className="ui-card-meta">{project.attachmentCount} attachments</span>
            <span className="ui-card-meta">{project.artifactCount} artifacts</span>
            <span className="ui-card-meta">{project.linkedConversations.length} {project.linkedConversations.length === 1 ? 'conversation' : 'conversations'}</span>
          </div>
          {deleteError && <p className="text-[12px] text-danger">{deleteError}</p>}
        </div>
      </section>

      <DetailSection
        id="project-overview"
        title="Overview"
        actions={(
          <>
            <button
              type="button"
              onClick={() => { void toggleRawProject(); }}
              className={ACTION_BUTTON_CLASS}
              disabled={deleteBusy}
            >
              {rawProjectOpen ? 'Hide raw YAML' : 'Raw YAML'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingProject((value) => !value);
                setProjectError(null);
              }}
              className={ACTION_BUTTON_CLASS}
              disabled={deleteBusy}
            >
              {editingProject ? 'Cancel' : 'Edit project'}
            </button>
            <button
              type="button"
              onClick={() => { void deleteProject(); }}
              className="text-[12px] text-danger hover:text-danger/75 transition-colors disabled:opacity-40"
              disabled={deleteBusy}
            >
              {deleteBusy ? 'Deleting…' : 'Delete project'}
            </button>
          </>
        )}
      >
        {editingProject ? (
          <form onSubmit={handleProjectSave} className="max-w-4xl space-y-6 border-t border-border-subtle pt-6">
            <div className="space-y-1.5">
              <label className="ui-card-meta">Title</label>
              <input
                value={projectForm.title}
                onChange={(event) => setProjectForm((current) => ({ ...current, title: event.target.value }))}
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-1.5">
              <label className="ui-card-meta">Description</label>
              <textarea
                value={projectForm.description}
                onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))}
                className={TEXTAREA_CLASS}
              />
            </div>

            <div className="space-y-1.5">
              <label className="ui-card-meta">Repo root</label>
              <input
                value={projectForm.repoRoot}
                onChange={(event) => setProjectForm((current) => ({ ...current, repoRoot: event.target.value }))}
                className={INPUT_CLASS}
                placeholder="Optional. Absolute path or a path relative to the personal-agent repo."
              />
            </div>

            <div className="space-y-1.5">
              <label className="ui-card-meta">Summary</label>
              <textarea
                value={projectForm.summary}
                onChange={(event) => setProjectForm((current) => ({ ...current, summary: event.target.value }))}
                className={TEXTAREA_CLASS}
              />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <div className="space-y-1.5">
                <label className="ui-card-meta">Status</label>
                <select
                  value={projectForm.status}
                  onChange={(event) => setProjectForm((current) => ({ ...current, status: event.target.value }))}
                  className={SELECT_CLASS}
                >
                  {PROJECT_STATUSES.map((status) => (
                    <option key={status} value={status}>{formatProjectStatus(status)}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="ui-card-meta">Current focus</label>
                <input
                  value={projectForm.currentFocus}
                  onChange={(event) => setProjectForm((current) => ({ ...current, currentFocus: event.target.value }))}
                  className={INPUT_CLASS}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <div className="space-y-1.5">
                <label className="ui-card-meta">Blockers (one per line)</label>
                <textarea
                  value={projectForm.blockers}
                  onChange={(event) => setProjectForm((current) => ({ ...current, blockers: event.target.value }))}
                  className={TEXTAREA_CLASS}
                />
              </div>

              <div className="space-y-1.5">
                <label className="ui-card-meta">Recent progress (one per line)</label>
                <textarea
                  value={projectForm.recentProgress}
                  onChange={(event) => setProjectForm((current) => ({ ...current, recentProgress: event.target.value }))}
                  className={TEXTAREA_CLASS}
                />
              </div>
            </div>

            {projectError && <p className="text-[12px] text-danger">{projectError}</p>}

            <div className="flex items-center gap-3">
              <ToolbarButton type="submit" disabled={projectBusy}>{projectBusy ? 'Saving…' : 'Save project'}</ToolbarButton>
              <button type="button" onClick={() => setEditingProject(false)} className="text-[13px] text-secondary hover:text-primary transition-colors">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-6 max-w-4xl">
            <p className="ui-card-body">{record.summary}</p>

            {record.repoRoot && (
              <div className="space-y-1.5">
                <p className="ui-card-meta">Repo root</p>
                <p className="ui-card-body font-mono break-all">{record.repoRoot}</p>
              </div>
            )}

            {record.currentFocus && (
              <div className="space-y-1.5">
                <p className="ui-card-meta">Current focus</p>
                <p className="ui-card-body">{record.currentFocus}</p>
              </div>
            )}

            {blockers.length > 0 && (
              <div className="space-y-2">
                <p className="ui-card-meta">Blockers</p>
                <ul className="space-y-1.5">
                  {blockers.map((blocker) => (
                    <li key={blocker} className="flex items-start gap-2 text-[14px] leading-relaxed text-warning">
                      <span className="mt-[2px] shrink-0">⚠</span>
                      <span>{blocker}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {recentProgress.length > 0 && (
              <div className="space-y-2">
                <p className="ui-card-meta">Recent progress</p>
                <ul className="space-y-1.5">
                  {recentProgress.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[14px] leading-relaxed text-secondary">
                      <span className="mt-[2px] shrink-0 text-success">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {rawProjectOpen && (
          <form onSubmit={saveRawProject} className="max-w-5xl space-y-4 border-t border-border-subtle pt-6">
            <p className="ui-card-meta">PROJECT.yaml</p>
            <textarea
              value={rawProjectContent}
              onChange={(event) => setRawProjectContent(event.target.value)}
              className={`${INPUT_CLASS} min-h-[20rem] resize-y font-mono text-[12px] leading-[1.6]`}
              spellCheck={false}
            />
            {rawProjectError && <p className="text-[12px] text-danger">{rawProjectError}</p>}
            <div className="flex items-center gap-3">
              <ToolbarButton type="submit" disabled={rawProjectBusy}>{rawProjectBusy ? 'Saving…' : 'Save YAML'}</ToolbarButton>
            </div>
          </form>
        )}
      </DetailSection>

      <DetailSection
        id="project-milestones"
        title="Milestones"
        meta={`${done}/${total} complete · ${pct}%`}
        actions={(
          <>
            <button type="button" onClick={() => openTaskAdd()} className={ACTION_BUTTON_CLASS} disabled={taskBusy}>
              + Add task
            </button>
            <button type="button" onClick={openMilestoneAdd} className={ACTION_BUTTON_CLASS} disabled={milestoneBusy}>
              + Add milestone
            </button>
          </>
        )}
      >
        <div className="max-w-5xl space-y-5">
          <div className="h-1 rounded-full bg-base overflow-hidden">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>

          {milestoneEditor && milestoneEditor.mode === 'add' && (
            <form onSubmit={saveMilestone} className="space-y-5 border border-border-subtle rounded-xl px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <p className="ui-card-meta">New milestone</p>
                <button type="button" onClick={() => setMilestoneEditor(null)} className={ACTION_BUTTON_CLASS}>Cancel</button>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_15rem]">
                <div className="space-y-1.5">
                  <label className="ui-card-meta">Title</label>
                  <input
                    value={milestoneForm.title}
                    onChange={(event) => setMilestoneForm((current) => ({ ...current, title: event.target.value }))}
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="ui-card-meta">Status</label>
                  <select
                    value={milestoneForm.status}
                    onChange={(event) => setMilestoneForm((current) => ({ ...current, status: event.target.value }))}
                    className={SELECT_CLASS}
                  >
                    {MILESTONE_STATUSES.map((status) => (
                      <option key={status} value={status}>{formatProjectStatus(status)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="ui-card-meta">Summary</label>
                <textarea
                  value={milestoneForm.summary}
                  onChange={(event) => setMilestoneForm((current) => ({ ...current, summary: event.target.value }))}
                  className={TEXTAREA_CLASS}
                />
              </div>

              <label className="flex items-center gap-2 text-[13px] text-secondary">
                <input
                  type="checkbox"
                  checked={milestoneForm.makeCurrent}
                  onChange={(event) => setMilestoneForm((current) => ({ ...current, makeCurrent: event.target.checked }))}
                />
                Set as current milestone
              </label>

              {milestoneError && <p className="text-[12px] text-danger">{milestoneError}</p>}

              <div className="flex items-center gap-3">
                <ToolbarButton type="submit" disabled={milestoneBusy}>{milestoneBusy ? 'Saving…' : 'Save milestone'}</ToolbarButton>
              </div>
            </form>
          )}

          {milestones.length === 0 && !milestoneEditor && (
            <EmptyState
              title="No milestones yet."
              body="Add milestones to define the durable plan. Tasks can then live inside each milestone instead of feeling disconnected from the roadmap."
              className="border border-dashed border-border-subtle rounded-xl max-w-3xl"
            />
          )}

          <div className="space-y-0 divide-y divide-border-subtle border-y border-border-subtle">
            {milestones.map((milestone, milestoneIndex) => {
              const isCurrent = currentMilestone?.id === milestone.id;
              const isEditing = milestoneEditor?.mode === 'edit' && milestoneEditor.milestoneId === milestone.id;
              const milestoneTasks = tasksByMilestone.get(milestone.id) ?? [];
              const taskEditorIsAnchoredHere = taskEditor != null && taskEditor.anchorMilestoneId === milestone.id;

              if (isEditing) {
                return (
                  <form key={milestone.id} onSubmit={saveMilestone} className="py-5 space-y-5" id={`project-milestone-${milestone.id}`}>
                    <p className="ui-card-meta font-mono">{milestone.id}</p>

                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_15rem]">
                      <div className="space-y-1.5">
                        <label className="ui-card-meta">Title</label>
                        <input
                          value={milestoneForm.title}
                          onChange={(event) => setMilestoneForm((current) => ({ ...current, title: event.target.value }))}
                          className={INPUT_CLASS}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="ui-card-meta">Status</label>
                        <select
                          value={milestoneForm.status}
                          onChange={(event) => setMilestoneForm((current) => ({ ...current, status: event.target.value }))}
                          className={SELECT_CLASS}
                        >
                          {MILESTONE_STATUSES.map((status) => (
                            <option key={status} value={status}>{formatProjectStatus(status)}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="ui-card-meta">Summary</label>
                      <textarea
                        value={milestoneForm.summary}
                        onChange={(event) => setMilestoneForm((current) => ({ ...current, summary: event.target.value }))}
                        className={TEXTAREA_CLASS}
                      />
                    </div>

                    <label className="flex items-center gap-2 text-[13px] text-secondary">
                      <input
                        type="checkbox"
                        checked={milestoneForm.makeCurrent}
                        onChange={(event) => setMilestoneForm((current) => ({ ...current, makeCurrent: event.target.checked }))}
                      />
                      Set as current milestone
                    </label>

                    {milestoneError && <p className="text-[12px] text-danger">{milestoneError}</p>}

                    <div className="flex items-center gap-3">
                      <ToolbarButton type="submit" disabled={milestoneBusy}>{milestoneBusy ? 'Saving…' : 'Save milestone'}</ToolbarButton>
                      <button type="button" onClick={() => setMilestoneEditor(null)} className="text-[13px] text-secondary hover:text-primary transition-colors">
                        Cancel
                      </button>
                    </div>
                  </form>
                );
              }

              return (
                <div key={milestone.id} className="py-4 space-y-4" id={`project-milestone-${milestone.id}`}>
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
                      <button type="button" onClick={() => { void moveMilestone(milestone.id, 'up'); }} className={ACTION_BUTTON_CLASS} disabled={milestoneBusy || milestoneIndex === 0}>
                        ↑
                      </button>
                      <button type="button" onClick={() => { void moveMilestone(milestone.id, 'down'); }} className={ACTION_BUTTON_CLASS} disabled={milestoneBusy || milestoneIndex === milestones.length - 1}>
                        ↓
                      </button>
                      {!isCurrent && (
                        <button type="button" onClick={() => { void makeMilestoneCurrent(milestone.id); }} className={ACTION_BUTTON_CLASS} disabled={milestoneBusy}>
                          Make current
                        </button>
                      )}
                      <button type="button" onClick={() => openMilestoneEdit(milestone)} className={ACTION_BUTTON_CLASS}>
                        Edit
                      </button>
                      <button type="button" onClick={() => { void deleteMilestone(milestone.id); }} className="text-[12px] text-danger hover:text-danger/75 transition-colors disabled:opacity-40" disabled={milestoneBusy}>
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="ml-5 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="ui-card-meta">State</span>
                      {MILESTONE_QUICK_STATUSES.map((status) => (
                        <button
                          key={`${milestone.id}-${status}`}
                          type="button"
                          onClick={() => { void setMilestoneStatus(milestone.id, status); }}
                          className={milestoneStatusButtonClass(milestone.status === status)}
                          disabled={milestoneBusy || milestone.status === status}
                        >
                          {formatProjectStatus(status)}
                        </button>
                      ))}
                    </div>

                    <div className="rounded-xl border border-border-subtle bg-base/40 px-4 py-4 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="ui-card-meta">Tasks for this milestone</p>
                          <p className="ui-card-meta mt-1">{milestoneTasks.length} {milestoneTasks.length === 1 ? 'task' : 'tasks'}</p>
                        </div>
                        <button type="button" onClick={() => openTaskAdd(milestone.id)} className={ACTION_BUTTON_CLASS} disabled={taskBusy}>
                          + Add task
                        </button>
                      </div>

                      {taskEditorIsAnchoredHere && renderTaskEditorForm()}

                      {milestoneTasks.length > 0 ? (
                        <div className="space-y-0 divide-y divide-border-subtle border-t border-border-subtle">
                          {milestoneTasks.map((task, taskIndex) => renderTaskCard(task, taskIndex, milestoneTasks.length))}
                        </div>
                      ) : !taskEditorIsAnchoredHere ? (
                        <p className="ui-card-meta">No tasks for this milestone yet.</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {(unassignedTasks.length > 0 || (taskEditor?.mode === 'add' && !taskEditor.anchorMilestoneId)) && (
            <div className="space-y-4 border-t border-border-subtle pt-4" id="project-unassigned-tasks">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="ui-card-meta">Unassigned tasks</p>
                  <p className="ui-card-meta mt-1">Tasks that are not tied to a milestone yet.</p>
                </div>
                <button type="button" onClick={() => openTaskAdd()} className={ACTION_BUTTON_CLASS} disabled={taskBusy}>
                  + Add task
                </button>
              </div>

              {taskEditor?.mode === 'add' && !taskEditor.anchorMilestoneId && renderTaskEditorForm()}

              {unassignedTasks.length > 0 ? (
                <div className="space-y-0 divide-y divide-border-subtle border-y border-border-subtle">
                  {unassignedTasks.map((task, taskIndex) => renderTaskCard(task, taskIndex, unassignedTasks.length))}
                </div>
              ) : null}
            </div>
          )}

          {milestoneError && !milestoneEditor && <p className="text-[12px] text-danger">{milestoneError}</p>}
          {taskError && !taskEditor && <p className="text-[12px] text-danger max-w-4xl">{taskError}</p>}
        </div>
      </DetailSection>

      <DetailSection
        id="project-brief"
        title="Project brief"
        meta={project.brief ? `updated ${timeAgo(project.brief.updatedAt)}` : 'No brief yet'}
        actions={(
          <>
            <button type="button" onClick={() => { void regenerateBrief(); }} className={ACTION_BUTTON_CLASS} disabled={briefBusy}>
              {briefBusy ? 'Regenerating…' : 'Regenerate brief'}
            </button>
            <button type="button" onClick={() => setBriefEditing((value) => !value)} className={ACTION_BUTTON_CLASS} disabled={briefBusy}>
              {briefEditing ? 'Cancel' : (project.brief ? 'Edit brief' : 'Write brief')}
            </button>
          </>
        )}
      >
        <div className="max-w-5xl space-y-4">
          {briefEditing ? (
            <form onSubmit={saveBrief} className="space-y-4 border border-border-subtle rounded-xl px-5 py-5">
              <textarea
                value={briefContent}
                onChange={(event) => setBriefContent(event.target.value)}
                className={`${INPUT_CLASS} min-h-[18rem] resize-y font-mono text-[13px] leading-[1.7]`}
                spellCheck={false}
              />
              {briefError && <p className="text-[12px] text-danger">{briefError}</p>}
              <div className="flex items-center gap-3">
                <ToolbarButton type="submit" disabled={briefBusy}>{briefBusy ? 'Saving…' : 'Save brief'}</ToolbarButton>
              </div>
            </form>
          ) : project.brief ? (
            <div className="ui-markdown max-w-none border-t border-border-subtle pt-4">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{project.brief.content}</ReactMarkdown>
            </div>
          ) : (
            <EmptyState
              title="No project brief yet."
              body="Write one manually or regenerate it from the current project state, notes, files, and linked conversations."
              className="border border-dashed border-border-subtle rounded-xl max-w-3xl"
            />
          )}
        </div>
      </DetailSection>

      <DetailSection
        id="project-conversations"
        title="Linked conversations"
        meta={`${project.linkedConversations.length} linked`}
      >
        <div className="max-w-5xl space-y-0 divide-y divide-border-subtle border-y border-border-subtle">
          {project.linkedConversations.length === 0 ? (
            <div className="py-4">
              <EmptyState
                title="No linked conversations yet."
                body="Start a conversation from this project or reference the project inside an existing conversation to make it the cross-conversation through line."
                className="border border-dashed border-border-subtle rounded-xl max-w-3xl"
              />
            </div>
          ) : project.linkedConversations.map((conversation: ProjectLinkedConversation) => (
            <article key={conversation.conversationId} className="py-4 space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1.5">
                  <a href={`/conversations/${encodeURIComponent(conversation.conversationId)}`} className="text-[15px] font-medium text-accent hover:text-accent/75 transition-colors">
                    {conversation.title}
                  </a>
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-dim">
                    <span className="font-mono">{conversation.conversationId}</span>
                    {conversation.lastActivityAt && <span>updated {timeAgo(conversation.lastActivityAt)}</span>}
                    {conversation.cwd && <span className="font-mono break-all">{conversation.cwd}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {conversation.isRunning && <Pill tone="accent">live</Pill>}
                  {conversation.needsAttention && <Pill tone="warning">attention</Pill>}
                </div>
              </div>
              {conversation.snippet && <p className="text-[13px] leading-relaxed text-secondary">{conversation.snippet}</p>}
            </article>
          ))}
        </div>
      </DetailSection>

      <DetailSection
        id="project-notes"
        title="Notes"
        meta={`${project.noteCount} notes`}
        actions={(
          <button type="button" onClick={openNoteAdd} className={ACTION_BUTTON_CLASS} disabled={noteBusy}>
            + Add note
          </button>
        )}
      >
        <div className="max-w-5xl space-y-5">
          {noteEditor?.mode === 'add' && renderNoteEditorForm()}

          {project.notes.length === 0 && !noteEditor ? (
            <EmptyState
              title="No notes yet."
              body="Append notes, decisions, questions, or checkpoints so the project keeps useful context between conversations."
              className="border border-dashed border-border-subtle rounded-xl max-w-3xl"
            />
          ) : (
            <div className="space-y-0 divide-y divide-border-subtle border-y border-border-subtle">
              {project.notes.map((note) => {
                const isEditing = noteEditor?.mode === 'edit' && noteEditor.noteId === note.id;
                if (isEditing) {
                  return (
                    <div key={note.id} id={`project-note-${note.id}`} className="py-4 scroll-mt-6">
                      {renderNoteEditorForm()}
                    </div>
                  );
                }

                return (
                  <article key={note.id} id={`project-note-${note.id}`} className="py-4 space-y-3 scroll-mt-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[15px] font-medium text-primary">{note.title}</p>
                          <Pill tone="muted">{formatProjectStatus(note.kind)}</Pill>
                          <span className="ui-card-meta">updated {timeAgo(note.updatedAt)}</span>
                        </div>
                        {note.body.length > 0 && (
                          <div className="ui-markdown max-w-none text-[14px]">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{note.body}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <button type="button" onClick={() => openNoteEdit(note)} className={ACTION_BUTTON_CLASS}>Edit</button>
                        <button type="button" onClick={() => { void deleteNote(note.id); }} className="text-[12px] text-danger hover:text-danger/75 transition-colors disabled:opacity-40" disabled={noteBusy}>Delete</button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {noteError && !noteEditor && <p className="text-[12px] text-danger">{noteError}</p>}
        </div>
      </DetailSection>

      <DetailSection
        id="project-files"
        title="Files"
        meta={`${project.attachmentCount} attachments · ${project.artifactCount} artifacts`}
      >
        <div className="max-w-5xl space-y-6">
          <form onSubmit={saveFile} className="space-y-5 border border-border-subtle rounded-xl px-5 py-5">
            <div className="grid gap-5 xl:grid-cols-[12rem_minmax(0,1fr)]">
              <div className="space-y-1.5">
                <label className="ui-card-meta">Kind</label>
                <select
                  value={fileUpload.kind}
                  onChange={(event) => setFileUpload((current) => ({ ...current, kind: event.target.value as 'attachment' | 'artifact' }))}
                  className={SELECT_CLASS}
                >
                  <option value="attachment">Attachment</option>
                  <option value="artifact">Artifact</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="ui-card-meta">File</label>
                <input
                  type="file"
                  onChange={(event) => setFileUpload((current) => ({ ...current, file: event.target.files?.[0] ?? null, title: current.title || event.target.files?.[0]?.name || '' }))}
                  className={INPUT_CLASS}
                />
              </div>
            </div>
            <div className="grid gap-5 xl:grid-cols-2">
              <div className="space-y-1.5">
                <label className="ui-card-meta">Title</label>
                <input
                  value={fileUpload.title}
                  onChange={(event) => setFileUpload((current) => ({ ...current, title: event.target.value }))}
                  className={INPUT_CLASS}
                />
              </div>
              <div className="space-y-1.5">
                <label className="ui-card-meta">Description</label>
                <input
                  value={fileUpload.description}
                  onChange={(event) => setFileUpload((current) => ({ ...current, description: event.target.value }))}
                  className={INPUT_CLASS}
                />
              </div>
            </div>
            {fileError && <p className="text-[12px] text-danger">{fileError}</p>}
            <div className="flex items-center gap-3">
              <ToolbarButton type="submit" disabled={fileBusy}>{fileBusy ? 'Uploading…' : 'Add file'}</ToolbarButton>
            </div>
          </form>

          <div className="space-y-5">
            <div className="space-y-0 divide-y divide-border-subtle border-y border-border-subtle">
              <div className="py-3"><p className="ui-card-meta">Attachments</p></div>
              {project.attachments.length > 0 ? project.attachments.map((file) => renderFileCard(file)) : (
                <div className="py-4"><p className="ui-card-meta">No attachments yet.</p></div>
              )}
            </div>
            <div className="space-y-0 divide-y divide-border-subtle border-y border-border-subtle">
              <div className="py-3"><p className="ui-card-meta">Artifacts</p></div>
              {project.artifacts.length > 0 ? project.artifacts.map((file) => renderFileCard(file)) : (
                <div className="py-4"><p className="ui-card-meta">No project artifacts yet.</p></div>
              )}
            </div>
          </div>
        </div>
      </DetailSection>

      <DetailSection
        id="project-timeline"
        title="Timeline"
        meta={`${project.timeline.length} events`}
      >
        <div className="max-w-5xl space-y-0 divide-y divide-border-subtle border-y border-border-subtle">
          {project.timeline.length === 0 ? (
            <div className="py-4"><p className="ui-card-meta">No timeline entries yet.</p></div>
          ) : project.timeline.map((entry) => (
            <article key={entry.id} className="py-4 flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {entry.href ? (
                    <a href={entry.href} className="text-[14px] font-medium text-accent hover:text-accent/75 transition-colors">
                      {entry.title}
                    </a>
                  ) : (
                    <p className="text-[14px] font-medium text-primary">{entry.title}</p>
                  )}
                  <Pill tone="muted">{formatProjectStatus(entry.kind)}</Pill>
                </div>
                {entry.description && <p className="text-[13px] leading-relaxed text-secondary">{entry.description}</p>}
              </div>
              <span className="ui-card-meta shrink-0">{timeAgo(entry.createdAt)}</span>
            </article>
          ))}
        </div>
      </DetailSection>
    </div>
  );
}
