import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { formatProjectStatus, isProjectArchived } from '../contextRailProject';
import type { ProjectDetail, ProjectFile, ProjectNote, ProjectTask } from '../types';
import {
  ProjectFileUploadForm,
  ProjectNoteEditorForm,
  ProjectRecordEditorForm,
  ProjectTaskEditorForm,
  ProjectTaskList,
} from './ProjectDetailForms';
import {
  ProjectActivityContent,
  ProjectDocumentContent,
  ProjectFilesContent,
  ProjectNodeLinksContent,
  ProjectNotesContent,
  ProjectRecordViewer,
} from './ProjectDetailSections';
import {
  buildActivityItems,
  emptyFileUploadState,
  emptyNoteForm,
  emptyTaskForm,
  noteFormFromNote,
  projectFormFromDetail,
  taskFormFromTask,
  type FileUploadState,
  type NoteFormState,
  type ProjectNoteEditorState,
  type ProjectTaskEditorState,
  type ProjectFormState,
  type TaskFormState,
} from './projectDetailState';
import { Pill, SectionLabel, ToolbarButton } from './ui';
import { timeAgo } from '../utils';

const ACTION_BUTTON_CLASS = 'text-[12px] text-accent hover:text-accent/70 transition-colors disabled:opacity-40';
const PROJECT_STATUSES = ['active', 'paused', 'done'];
const TASK_STATUSES = ['todo', 'doing', 'done'];
const PROJECT_NOTE_KINDS = ['note', 'decision', 'question', 'meeting', 'checkpoint'];

interface DetailSectionProps {
  id: string;
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  collapsedPreview?: React.ReactNode;
  resetKey?: string;
}

function previewLine(value: string): string | null {
  for (const rawLine of value.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      continue;
    }

    return trimmed
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .trim();
  }

  return null;
}

function createDefaultProjectDocument(title: string): string {
  return `# ${title.trim() || 'Project'}\n\n`;
}

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

function DetailSection({
  id,
  title,
  meta,
  actions,
  children,
  collapsible = false,
  defaultOpen = true,
  forceOpen = false,
  collapsedPreview,
  resetKey,
}: DetailSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = `${id}-content`;

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen, resetKey]);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
    }
  }, [forceOpen]);

  return (
    <section id={id} className="border-t border-border-subtle pt-8 space-y-5 scroll-mt-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <SectionLabel label={title} />
        <div className="flex items-center gap-3 flex-wrap">
          {meta && <div className="ui-card-meta">{meta}</div>}
          {actions}
          {collapsible && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className={ACTION_BUTTON_CLASS}
              aria-expanded={open}
              aria-controls={contentId}
            >
              {open ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
      </div>
      {open ? (
        <div id={contentId}>{children}</div>
      ) : collapsedPreview ? (
        <p id={contentId} className="max-w-4xl text-[13px] leading-relaxed text-secondary">
          {collapsedPreview}
        </p>
      ) : null}
    </section>
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
  const documentRecord = project.document ?? project.brief;
  const taskCount = project.taskCount ?? project.tasks.length;
  const noteCount = project.noteCount ?? project.notes.length;
  const fileCount = project.fileCount ?? project.files.length ?? ((project.attachments?.length ?? 0) + (project.artifacts?.length ?? 0));
  const taskDoneCount = project.tasks.filter((task) => task.status === 'done' || task.status === 'completed').length;
  const taskOpenCount = Math.max(0, project.tasks.length - taskDoneCount);
  const documentPreview = previewLine(documentRecord?.content ?? '')
    || record.summary.trim()
    || record.description.trim()
    || 'No project doc yet.';
  const tasksPreview = taskCount > 0
    ? `${taskOpenCount} open · ${taskDoneCount} done`
    : 'No tasks yet.';
  const activityPreview = project.timeline.length > 0
    ? `${project.timeline.length} recent ${project.timeline.length === 1 ? 'event' : 'events'}`
    : 'No activity yet.';
  const notesPreview = noteCount > 0
    ? `${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`
    : 'No notes yet.';
  const filesPreview = fileCount > 0
    ? `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`
    : 'No files yet.';
  const linksPreview = project.links && (project.links.outgoing.length > 0 || project.links.incoming.length > 0)
    ? `${project.links.outgoing.length} outgoing · ${project.links.incoming.length} backlinks`
    : 'No linked nodes yet.';
  const projectApiOptions = { profile: projectProfile };

  const [editingProject, setEditingProject] = useState(false);
  const [projectForm, setProjectForm] = useState<ProjectFormState>(() => projectFormFromDetail(project));
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  const [taskEditor, setTaskEditor] = useState<ProjectTaskEditorState | null>(null);
  const [taskForm, setTaskForm] = useState<TaskFormState>(() => emptyTaskForm());
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);

  const [documentEditing, setDocumentEditing] = useState(false);
  const [documentContent, setDocumentContent] = useState(documentRecord?.content ?? '');
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);

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

  useEffect(() => {
    setProjectForm(projectFormFromDetail(project));
    setDocumentContent(documentRecord?.content ?? '');
    setEditingProject(false);
    setTaskEditor(null);
    setNoteEditor(null);
    setDocumentEditing(false);
    setFileUpload(emptyFileUploadState());
    setProjectError(null);
    setTaskError(null);
    setDocumentError(null);
    setNoteError(null);
    setFileError(null);
    setArchiveError(null);
    setDeleteError(null);
    setRawProjectOpen(false);
    setRawProjectLoaded(false);
    setRawProjectContent('');
    setRawProjectError(null);
  }, [project]);

  function openProjectEditor() {
    setEditingProject(true);
    setProjectError(null);
  }

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

  async function handleProjectSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProjectBusy(true);
    setProjectError(null);

    try {
      await api.updateProject(record.id, {
        title: projectForm.title.trim(),
        repoRoot: projectForm.repoRoot.trim() || null,
        summary: projectForm.summary.trim(),
        status: projectForm.status,
      }, projectApiOptions);
      setEditingProject(false);
      onChanged?.();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectBusy(false);
    }
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

  async function saveDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDocumentBusy(true);
    setDocumentError(null);

    try {
      await api.saveProjectDocument(record.id, documentContent, projectApiOptions);
      setDocumentEditing(false);
      onChanged?.();
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : String(error));
    } finally {
      setDocumentBusy(false);
    }
  }

  async function regenerateDocument() {
    setDocumentBusy(true);
    setDocumentError(null);

    try {
      await api.regenerateProjectDocument(record.id, projectApiOptions);
      setDocumentEditing(false);
      onChanged?.();
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : String(error));
    } finally {
      setDocumentBusy(false);
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
    <div className="space-y-8" id="top">
      <section className="space-y-5">
        <div className="space-y-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={archived ? 'muted' : record.status === 'paused' ? 'warning' : record.status === 'done' ? 'success' : 'teal'}>
                  {formatProjectStatus(record.status)}
                </Pill>
                <span className="ui-card-meta font-mono">{record.id}</span>
                <span className="ui-card-meta">updated {timeAgo(record.updatedAt)}</span>
                {archived && record.archivedAt && <span className="ui-card-meta">archived {timeAgo(record.archivedAt)}</span>}
              </div>
              <div className="space-y-2">
                <h1 className="text-[32px] font-medium leading-tight tracking-tight text-primary">{record.title}</h1>
                {record.summary.trim() && <p className="max-w-4xl text-[15px] leading-relaxed text-secondary">{record.summary}</p>}
                {record.repoRoot && <p className="ui-card-meta font-mono break-all">{record.repoRoot}</p>}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ToolbarButton onClick={downloadProjectPackage} disabled={deleteBusy}>Export package</ToolbarButton>
              <ToolbarButton onClick={toggleArchive} disabled={archiveBusy || deleteBusy}>
                {archiveBusy ? (archived ? 'Restoring…' : 'Archiving…') : (archived ? 'Restore project' : 'Archive project')}
              </ToolbarButton>
              <ToolbarButton onClick={() => { void startConversationFromProject(); }} disabled={conversationBusy || deleteBusy || !canStartConversation}>
                {conversationBusy ? 'Starting…' : 'Start conversation'}
              </ToolbarButton>
            </div>
          </div>

          {!canStartConversation && activeProfile && (
            <p className="ui-card-meta max-w-4xl">
              Switch the active profile to <span className="font-mono text-primary">{projectProfile}</span> in Settings before starting a conversation from this project.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="ui-card-meta">{taskCount} {taskCount === 1 ? 'task' : 'tasks'}</span>
            <span className="ui-card-meta">{noteCount} {noteCount === 1 ? 'note' : 'notes'}</span>
            <span className="ui-card-meta">{fileCount} {fileCount === 1 ? 'file' : 'files'}</span>
            <span className="ui-card-meta">{project.linkedConversations.length} {project.linkedConversations.length === 1 ? 'conversation' : 'conversations'}</span>
          </div>

          {(archiveError || deleteError) && <p className="text-[12px] text-danger">{archiveError ?? deleteError}</p>}
        </div>
      </section>

      <DetailSection
        id="project-document"
        title="Project doc"
        collapsible
        defaultOpen
        forceOpen={documentEditing}
        collapsedPreview={documentPreview}
        resetKey={record.id}
        actions={(
          <>
            <button type="button" onClick={() => { void regenerateDocument(); }} className={ACTION_BUTTON_CLASS} disabled={documentBusy}>
              {documentBusy ? 'Regenerating…' : 'Regenerate'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDocumentError(null);
                if (!documentEditing && documentContent.trim().length === 0) {
                  setDocumentContent(documentRecord?.content ?? createDefaultProjectDocument(record.title));
                }
                setDocumentEditing((value) => !value);
              }}
              className={ACTION_BUTTON_CLASS}
              disabled={documentBusy}
            >
              {documentEditing ? 'Cancel' : (documentRecord ? 'Edit doc' : 'Write doc')}
            </button>
          </>
        )}
      >
        <ProjectDocumentContent
          document={documentRecord}
          editing={documentEditing}
          content={documentContent}
          busy={documentBusy}
          error={documentError}
          onChange={setDocumentContent}
          onSubmit={saveDocument}
        />
      </DetailSection>

      <DetailSection
        id="project-tasks"
        title="Tasks"
        meta={`${taskOpenCount} open · ${taskDoneCount} done`}
        collapsible
        defaultOpen
        forceOpen={taskEditor !== null}
        collapsedPreview={tasksPreview}
        resetKey={record.id}
        actions={(
          <button type="button" onClick={openTaskAdd} className={ACTION_BUTTON_CLASS} disabled={taskBusy}>
            + Add task
          </button>
        )}
      >
        <div className="max-w-5xl space-y-5">
          {taskEditor?.mode === 'add' && taskEditorForm}
          {project.tasks.length > 0 ? (
            <ProjectTaskList
              tasks={project.tasks}
              taskEditorTaskId={taskEditor?.mode === 'edit' ? taskEditor.taskId : null}
              taskEditorForm={taskEditorForm}
              busy={taskBusy}
              onMoveTask={(taskId, direction) => { void moveTask(taskId, direction); }}
              onEditTask={openTaskEdit}
              onDeleteTask={(taskId) => { void deleteTask(taskId); }}
            />
          ) : !taskEditor ? (
            <p className="ui-card-meta">No tasks yet.</p>
          ) : null}
          {taskError && !taskEditor && <p className="text-[12px] text-danger">{taskError}</p>}
        </div>
      </DetailSection>

      <DetailSection
        id="project-activity"
        title="Activity"
        meta={activityPreview}
        collapsible
        defaultOpen={false}
        collapsedPreview={activityPreview}
        resetKey={record.id}
      >
        <ProjectActivityContent items={activityItems} />
      </DetailSection>

      <DetailSection
        id="project-notes"
        title="Notes"
        meta={`${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`}
        collapsible
        defaultOpen={false}
        forceOpen={noteEditor !== null}
        collapsedPreview={notesPreview}
        resetKey={record.id}
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
        meta={`${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}
        collapsible
        defaultOpen={false}
        collapsedPreview={filesPreview}
        resetKey={record.id}
      >
        <ProjectFilesContent
          uploadForm={fileUploadForm}
          files={project.files}
          fileBusy={fileBusy}
          onDeleteFile={(file) => { void deleteFile(file); }}
        />
      </DetailSection>

      <DetailSection
        id="project-record"
        title="Record"
        collapsible
        defaultOpen={false}
        forceOpen={editingProject || rawProjectOpen}
        collapsedPreview={record.summary.trim() || 'Raw project metadata and YAML.'}
        resetKey={record.id}
        actions={(
          <>
            <button type="button" onClick={() => { void toggleRawProject(); }} className={ACTION_BUTTON_CLASS} disabled={deleteBusy}>
              {rawProjectOpen ? 'Hide raw YAML' : 'Raw YAML'}
            </button>
            <button type="button" onClick={openProjectEditor} className={ACTION_BUTTON_CLASS} disabled={deleteBusy}>
              {editingProject ? 'Editing…' : 'Edit project'}
            </button>
            <button type="button" onClick={() => { void deleteProject(); }} className="text-[12px] text-danger hover:text-danger/75 transition-colors disabled:opacity-40" disabled={deleteBusy}>
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
        id="project-links"
        title="Links"
        meta={linksPreview}
        collapsible
        defaultOpen={false}
        collapsedPreview={linksPreview}
        resetKey={record.id}
      >
        <ProjectNodeLinksContent links={project.links} />
      </DetailSection>
    </div>
  );
}
