import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  formatProjectStatus,
  getPlanProgress,
  hasMeaningfulBlockers,
  isProjectArchived,
  pickCurrentMilestone,
} from '../contextRailProject';
import type { ProjectDetail, ProjectFile, ProjectMilestone, ProjectNote, ProjectTask } from '../types';
import { createEmptyProjectDocument, parseProjectDocument } from '../projectDocument';
import { timeAgo } from '../utils';
import {
  ProjectFileUploadForm,
  ProjectMilestoneEditorForm,
  ProjectMilestoneRow,
  ProjectNoteEditorForm,
  ProjectRecordEditorForm,
  ProjectTaskEditorForm,
  ProjectTaskList,
} from './ProjectDetailForms';
import {
  ProjectActivityContent,
  ProjectCompletionContent,
  ProjectFilesContent,
  ProjectHandoffDocContent,
  ProjectNotesContent,
  ProjectPlanOverview,
  ProjectRecordViewer,
  ProjectRequirementsContent,
} from './ProjectDetailSections';
import {
  buildActivityItems,
  buildTasksByMilestone,
  emptyFileUploadState,
  emptyMilestoneForm,
  emptyNoteForm,
  emptyTaskForm,
  milestoneFormFromMilestone,
  noteFormFromNote,
  projectFormFromDetail,
  type FileUploadState,
  type MilestoneFormState,
  type NoteFormState,
  type ProjectFormState,
  type ProjectMilestoneEditorState,
  type ProjectNoteEditorState,
  type ProjectTaskEditorState,
  splitLines,
  taskFormFromTask,
  type TaskFormState,
  UNASSIGNED_TASK_KEY,
} from './projectDetailState';
import { EmptyState, Pill, SectionLabel, ToolbarButton } from './ui';

const ACTION_BUTTON_CLASS = 'text-[12px] text-accent hover:text-accent/70 transition-colors disabled:opacity-40';

const PROJECT_STATUSES = ['created', 'in_progress', 'blocked', 'completed', 'cancelled'];
const MILESTONE_STATUSES = ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'];
const MILESTONE_QUICK_STATUSES = ['pending', 'in_progress', 'blocked', 'completed'];
const TASK_STATUSES = ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'];
const PROJECT_NOTE_KINDS = ['note', 'decision', 'question', 'meeting', 'checkpoint'];

interface DetailSectionProps {
  id: string;
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
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
  const archived = isProjectArchived(record);
  const milestones = record.plan.milestones;
  const currentMilestone = pickCurrentMilestone(record.plan);
  const { done, total, pct } = getPlanProgress(milestones);
  const tasksByMilestone = useMemo(() => buildTasksByMilestone(project.tasks), [project.tasks]);
  const unassignedTasks = tasksByMilestone.get(UNASSIGNED_TASK_KEY) ?? [];

  const [editingProject, setEditingProject] = useState(false);
  const [projectForm, setProjectForm] = useState<ProjectFormState>(() => projectFormFromDetail(project));
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  const [milestoneEditor, setMilestoneEditor] = useState<ProjectMilestoneEditorState | null>(null);
  const [milestoneForm, setMilestoneForm] = useState<MilestoneFormState>(() => emptyMilestoneForm());
  const [milestoneBusy, setMilestoneBusy] = useState(false);
  const [milestoneError, setMilestoneError] = useState<string | null>(null);

  const [taskEditor, setTaskEditor] = useState<ProjectTaskEditorState | null>(null);
  const [taskForm, setTaskForm] = useState<TaskFormState>(() => emptyTaskForm());
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);

  const [briefEditing, setBriefEditing] = useState(false);
  const [briefContent, setBriefContent] = useState(project.brief?.content ?? '');
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const [noteEditor, setNoteEditor] = useState<ProjectNoteEditorState | null>(null);
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

  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const projectDocumentSource = briefEditing ? briefContent : (project.brief?.content ?? '');
  const projectDocument = useMemo(() => parseProjectDocument(projectDocumentSource), [projectDocumentSource]);
  const goal = record.requirements.goal.trim();
  const acceptanceCriteria = record.requirements.acceptanceCriteria.filter((item) => item.trim().length > 0);
  const requirementsFallbackContent = projectDocument.requirements.trim();
  const planContent = (record.planSummary ?? '').trim() || projectDocument.plan.trim();
  const completionSummaryContent = (record.completionSummary ?? '').trim() || projectDocument.completionSummary.trim();
  const activityItems = useMemo(() => buildActivityItems(project), [project]);
  const topLevelError = archiveError ?? deleteError;

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
    setArchiveError(null);
    setDeleteError(null);
    if (!rawProjectOpen) {
      setRawProjectContent('');
    }
  }, [project, rawProjectOpen]);

  function openProjectEditor() {
    setEditingProject(true);
    setProjectError(null);
    document.getElementById('project-record')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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
        goal: projectForm.goal,
        acceptanceCriteria: splitLines(projectForm.acceptanceCriteria),
        planSummary: projectForm.planSummary.trim() || null,
        completionSummary: projectForm.completionSummary.trim() || null,
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

  async function toggleArchivedState(nextArchived: boolean) {
    const confirmationMessage = nextArchived
      ? (record.status === 'completed' || record.status === 'cancelled'
          ? `Archive project ${record.id}? It will move out of the active project list but remain available.`
          : `Archive project ${record.id}? It is still marked ${formatProjectStatus(record.status)}.`)
      : `Restore project ${record.id} to the active project list?`;

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    setArchiveBusy(true);
    setArchiveError(null);

    try {
      if (nextArchived) {
        await api.archiveProject(record.id);
      } else {
        await api.unarchiveProject(record.id);
      }
      onChanged?.();
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : String(error));
    } finally {
      setArchiveBusy(false);
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

  function downloadProjectPackage() {
    const link = document.createElement('a');
    link.href = `/api/projects/${encodeURIComponent(record.id)}/package`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  const taskEditorForm = taskEditor ? (
    <ProjectTaskEditorForm
      editor={taskEditor}
      value={taskForm}
      milestones={milestones}
      statuses={TASK_STATUSES}
      error={taskError}
      busy={taskBusy}
      onChange={(patch) => setTaskForm((current) => ({ ...current, ...patch }))}
      onCancel={() => setTaskEditor(null)}
      onSubmit={saveTask}
    />
  ) : null;

  const milestoneEditorForm = milestoneEditor ? (
    <ProjectMilestoneEditorForm
      editor={milestoneEditor}
      value={milestoneForm}
      statuses={MILESTONE_STATUSES}
      busy={milestoneBusy}
      error={milestoneError}
      onChange={(patch) => setMilestoneForm((current) => ({ ...current, ...patch }))}
      onCancel={() => setMilestoneEditor(null)}
      onSubmit={saveMilestone}
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

  const fileUploadForm = (
    <ProjectFileUploadForm
      value={fileUpload}
      error={fileError}
      busy={fileBusy}
      onChange={(patch) => setFileUpload((current) => ({ ...current, ...patch }))}
      onSubmit={saveFile}
    />
  );

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
            <div className="flex items-center gap-2">
              <ToolbarButton onClick={downloadProjectPackage} disabled={deleteBusy}>
                Export package
              </ToolbarButton>
              <ToolbarButton onClick={() => { void toggleArchivedState(!archived); }} disabled={archiveBusy || deleteBusy}>
                {archiveBusy ? (archived ? 'Restoring…' : 'Archiving…') : (archived ? 'Restore project' : 'Archive project')}
              </ToolbarButton>
              <ToolbarButton onClick={() => { void startConversationFromProject(); }} disabled={conversationBusy || deleteBusy}>
                {conversationBusy ? 'Starting…' : 'Start conversation'}
              </ToolbarButton>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Pill tone={archived ? 'muted' : hasMeaningfulBlockers(record.blockers) ? 'warning' : 'teal'}>
              {formatProjectStatus(record.status)}
            </Pill>
            {archived && record.archivedAt && <Pill tone="muted">archived {timeAgo(record.archivedAt)}</Pill>}
            <span className="ui-card-meta">{milestones.length} {milestones.length === 1 ? 'milestone' : 'milestones'}</span>
            <span className="ui-card-meta">{project.taskCount} {project.taskCount === 1 ? 'task' : 'tasks'}</span>
            <span className="ui-card-meta">{project.noteCount} {project.noteCount === 1 ? 'note' : 'notes'}</span>
            <span className="ui-card-meta">{project.attachmentCount} attachments</span>
            <span className="ui-card-meta">{project.artifactCount} artifacts</span>
            <span className="ui-card-meta">{project.linkedConversations.length} {project.linkedConversations.length === 1 ? 'conversation' : 'conversations'}</span>
          </div>
          {topLevelError && <p className="text-[12px] text-danger">{topLevelError}</p>}
        </div>
      </section>

      <DetailSection
        id="project-requirements"
        title="Requirements"
        actions={<button type="button" onClick={openProjectEditor} className={ACTION_BUTTON_CLASS}>Edit fields</button>}
      >
        <ProjectRequirementsContent
          goal={goal}
          fallbackContent={requirementsFallbackContent}
          acceptanceCriteria={acceptanceCriteria}
        />
      </DetailSection>

      <DetailSection
        id="project-plan"
        title="Plan"
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
        <div className="max-w-5xl space-y-6">
          <ProjectPlanOverview
            planContent={planContent}
            currentFocus={record.currentFocus ?? ''}
            blockers={blockers}
            recentProgress={recentProgress}
            pct={pct}
          />

          {milestoneEditor?.mode === 'add' && milestoneEditorForm}

          {milestones.length === 0 && !milestoneEditor && (
            <EmptyState
              title="No milestones yet."
              body="Add milestones to break the work into clear chunks. Tasks can then live inside each chunk instead of floating around the project."
              className="max-w-3xl py-8"
            />
          )}

          <div className="space-y-0 divide-y divide-border-subtle border-y border-border-subtle">
            {milestones.map((milestone, milestoneIndex) => {
              const isCurrent = currentMilestone?.id === milestone.id;
              const isEditing = milestoneEditor?.mode === 'edit' && milestoneEditor.milestoneId === milestone.id;
              const milestoneTasks = tasksByMilestone.get(milestone.id) ?? [];

              if (isEditing) {
                return (
                  <div key={milestone.id} className="py-5" id={`project-milestone-${milestone.id}`}>
                    <ProjectMilestoneEditorForm
                      editor={milestoneEditor}
                      value={milestoneForm}
                      statuses={MILESTONE_STATUSES}
                      busy={milestoneBusy}
                      error={milestoneError}
                      onChange={(patch) => setMilestoneForm((current) => ({ ...current, ...patch }))}
                      onCancel={() => setMilestoneEditor(null)}
                      onSubmit={saveMilestone}
                      showDivider={false}
                    />
                  </div>
                );
              }

              return (
                <ProjectMilestoneRow
                  key={milestone.id}
                  milestone={milestone}
                  isCurrent={isCurrent}
                  milestoneIndex={milestoneIndex}
                  milestoneCount={milestones.length}
                  busy={milestoneBusy}
                  quickStatuses={MILESTONE_QUICK_STATUSES}
                  taskBusy={taskBusy}
                  milestoneTasks={milestoneTasks}
                  taskEditor={taskEditor}
                  taskEditorForm={taskEditorForm}
                  onMove={(direction) => { void moveMilestone(milestone.id, direction); }}
                  onMakeCurrent={() => { void makeMilestoneCurrent(milestone.id); }}
                  onEdit={() => openMilestoneEdit(milestone)}
                  onDelete={() => { void deleteMilestone(milestone.id); }}
                  onSetStatus={(status) => { void setMilestoneStatus(milestone.id, status); }}
                  onOpenTaskAdd={() => openTaskAdd(milestone.id)}
                  onMoveTask={(taskId, direction) => { void moveTask(taskId, direction); }}
                  onEditTask={openTaskEdit}
                  onDeleteTask={(taskId) => { void deleteTask(taskId); }}
                />
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

              {taskEditor?.mode === 'add' && !taskEditor.anchorMilestoneId && taskEditorForm}

              {unassignedTasks.length > 0 ? (
                <ProjectTaskList
                  tasks={unassignedTasks}
                  taskEditorTaskId={taskEditor?.mode === 'edit' ? taskEditor.taskId : null}
                  taskEditorForm={taskEditorForm}
                  busy={taskBusy}
                  onMoveTask={(taskId, direction) => { void moveTask(taskId, direction); }}
                  onEditTask={openTaskEdit}
                  onDeleteTask={(taskId) => { void deleteTask(taskId); }}
                />
              ) : null}
            </div>
          )}

          {milestoneError && !milestoneEditor && <p className="text-[12px] text-danger">{milestoneError}</p>}
          {taskError && !taskEditor && <p className="text-[12px] text-danger max-w-4xl">{taskError}</p>}
        </div>
      </DetailSection>

      <DetailSection
        id="project-completion"
        title="Completion summary"
        meta={record.status === 'completed' ? 'project completed' : formatProjectStatus(record.status)}
        actions={<button type="button" onClick={openProjectEditor} className={ACTION_BUTTON_CLASS}>Edit fields</button>}
      >
        <ProjectCompletionContent status={record.status} content={completionSummaryContent} />
      </DetailSection>

      <DetailSection
        id="project-timeline"
        title="Timeline"
        meta={`${activityItems.length} ${activityItems.length === 1 ? 'event' : 'events'}`}
      >
        <ProjectActivityContent items={activityItems} />
      </DetailSection>

      <DetailSection
        id="project-handoff"
        title="Handoff doc"
        meta={project.brief ? `updated ${timeAgo(project.brief.updatedAt)}` : 'No handoff doc yet'}
        actions={(
          <>
            <button type="button" onClick={() => { void regenerateBrief(); }} className={ACTION_BUTTON_CLASS} disabled={briefBusy}>
              {briefBusy ? 'Regenerating…' : 'Regenerate doc'}
            </button>
            <button
              type="button"
              onClick={() => {
                setBriefError(null);
                if (!briefEditing && briefContent.trim().length === 0) {
                  setBriefContent(project.brief?.content ?? createEmptyProjectDocument(record.title));
                }
                setBriefEditing((value) => !value);
              }}
              className={ACTION_BUTTON_CLASS}
              disabled={briefBusy}
            >
              {briefEditing ? 'Cancel' : (project.brief ? 'Edit doc' : 'Write doc')}
            </button>
          </>
        )}
      >
        <ProjectHandoffDocContent
          brief={project.brief}
          editing={briefEditing}
          content={briefContent}
          busy={briefBusy}
          error={briefError}
          onChange={setBriefContent}
          onSubmit={saveBrief}
        />
      </DetailSection>

      <DetailSection
        id="project-record"
        title="Project record"
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
          <ProjectRecordEditorForm
            value={projectForm}
            statuses={PROJECT_STATUSES}
            busy={projectBusy}
            error={projectError}
            onChange={(patch) => setProjectForm((current) => ({ ...current, ...patch }))}
            onSubmit={handleProjectSave}
            onCancel={() => setEditingProject(false)}
          />
        ) : (
          <ProjectRecordViewer
            repoRoot={record.repoRoot}
            summary={record.summary}
            rawProjectOpen={false}
            rawProjectContent={rawProjectContent}
            rawProjectBusy={rawProjectBusy}
            rawProjectError={rawProjectError}
            onRawProjectContentChange={setRawProjectContent}
            onRawProjectSubmit={saveRawProject}
          />
        )}

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
        <ProjectNotesContent
          notes={project.notes}
          noteEditor={noteEditor}
          noteEditorForm={noteEditorForm}
          noteBusy={noteBusy}
          noteError={noteError}
          onEditNote={openNoteEdit}
          onDeleteNote={(noteId) => { void deleteNote(noteId); }}
        />
      </DetailSection>

      <DetailSection
        id="project-files"
        title="Files"
        meta={`${project.attachmentCount} attachments · ${project.artifactCount} artifacts`}
      >
        <ProjectFilesContent
          uploadForm={fileUploadForm}
          attachments={project.attachments}
          artifacts={project.artifacts}
          fileBusy={fileBusy}
          onDeleteFile={(file) => { void deleteFile(file); }}
        />
      </DetailSection>

    </div>
  );
}
