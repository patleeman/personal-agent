import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { formatProjectStatus, hasMeaningfulBlockers, summarizeProjectPreview } from '../contextRailProject';
import { useApi } from '../hooks';
import { useAppData } from '../contexts';
import { emitProjectsChanged, PROJECTS_CHANGED_EVENT } from '../projectEvents';
import { useReloadState } from '../reloadState';
import { timeAgo } from '../utils';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, ToolbarButton } from '../components/ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary focus:outline-none focus:border-accent/60';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[104px] resize-y leading-relaxed`;
const CREATE_PROJECT_OPEN_STORAGE_KEY = 'pa:reload:projects:create-open';
const CREATE_PROJECT_TITLE_STORAGE_KEY = 'pa:reload:projects:create-title';
const CREATE_PROJECT_DESCRIPTION_STORAGE_KEY = 'pa:reload:projects:create-description';
const CREATE_PROJECT_REPO_ROOT_STORAGE_KEY = 'pa:reload:projects:create-repo-root';
const CREATE_PROJECT_SUMMARY_STORAGE_KEY = 'pa:reload:projects:create-summary';

function CreateProjectPanel({
  onCreated,
  onCancel,
}: {
  onCreated: (projectId: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle, clearTitle] = useReloadState<string>({
    storageKey: CREATE_PROJECT_TITLE_STORAGE_KEY,
    initialValue: '',
    shouldPersist: (value) => value.length > 0,
  });
  const [description, setDescription, clearDescription] = useReloadState<string>({
    storageKey: CREATE_PROJECT_DESCRIPTION_STORAGE_KEY,
    initialValue: '',
    shouldPersist: (value) => value.length > 0,
  });
  const [repoRoot, setRepoRoot, clearRepoRoot] = useReloadState<string>({
    storageKey: CREATE_PROJECT_REPO_ROOT_STORAGE_KEY,
    initialValue: '',
    shouldPersist: (value) => value.length > 0,
  });
  const [summary, setSummary, clearSummary] = useReloadState<string>({
    storageKey: CREATE_PROJECT_SUMMARY_STORAGE_KEY,
    initialValue: '',
    shouldPersist: (value) => value.length > 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    clearTitle();
    clearDescription();
    clearRepoRoot();
    clearSummary();
    onCancel();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const detail = await api.createProject({
        title,
        description,
        repoRoot: repoRoot.trim() || undefined,
        summary: summary.trim() || undefined,
      });
      clearTitle();
      clearDescription();
      clearRepoRoot();
      clearSummary();
      emitProjectsChanged();
      onCreated(detail.project.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0 space-y-5 border-t border-border-subtle pt-5">
      <div className="space-y-1">
        <h2 className="text-[15px] font-medium text-primary">New project</h2>
        <p className="ui-card-meta max-w-2xl">
          Create a project from a short title and a longer description. The ID is auto-generated from the title.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-3xl space-y-5">
        <div className="space-y-1.5">
          <label className="ui-card-meta" htmlFor="project-title">Title</label>
          <input
            id="project-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={INPUT_CLASS}
            placeholder="Short project title"
          />
        </div>

        <div className="space-y-1.5">
          <label className="ui-card-meta" htmlFor="project-description">Description</label>
          <textarea
            id="project-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={TEXTAREA_CLASS}
            placeholder="Describe the project at a high level."
          />
        </div>

        <div className="space-y-1.5">
          <label className="ui-card-meta" htmlFor="project-repo-root">Repo root</label>
          <input
            id="project-repo-root"
            value={repoRoot}
            onChange={(event) => setRepoRoot(event.target.value)}
            className={INPUT_CLASS}
            placeholder="Optional. Absolute path or a path relative to the personal-agent repo."
          />
        </div>

        <div className="space-y-1.5">
          <label className="ui-card-meta" htmlFor="project-summary">Initial summary</label>
          <textarea
            id="project-summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            className={TEXTAREA_CLASS}
            placeholder="Optional. A current snapshot of the project state."
          />
        </div>

        {error && <p className="text-[12px] text-danger">{error}</p>}

        <div className="flex items-center gap-3">
          <ToolbarButton type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create project'}</ToolbarButton>
          <button type="button" onClick={handleCancel} className="text-[13px] text-secondary hover:text-primary transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function ProjectDiagnosticsPanel({
  profile,
  invalidProjects,
}: {
  profile: string;
  invalidProjects: Array<{ projectId: string; path: string; error: string }>;
}) {
  if (invalidProjects.length === 0) {
    return null;
  }

  const validatorCommand = `npm run validate:projects -- --profile ${profile}`;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-[13px] text-danger">
          {invalidProjects.length} {invalidProjects.length === 1 ? 'project file could not be loaded.' : 'project files could not be loaded.'}
        </p>
        <p className="ui-card-meta">
          Fix the invalid YAML or run{' '}
          <span className="font-mono text-primary">{validatorCommand}</span>
          {' '}to inspect all project files for this profile.
        </p>
      </div>

      <div className="space-y-3">
        {invalidProjects.map((issue) => (
          <div key={issue.projectId} className="space-y-0.5">
            <p className="font-mono text-[12px] text-danger">{issue.projectId}</p>
            <p className="text-[12px] text-danger/85">{issue.error}</p>
            <p className="ui-card-meta break-all font-mono">{issue.path}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { id: selectedId } = useParams<{ id?: string }>();
  const createFormStorageKey = selectedId ? null : CREATE_PROJECT_OPEN_STORAGE_KEY;
  const [showCreateForm, setShowCreateForm] = useReloadState<boolean>({
    storageKey: createFormStorageKey,
    initialValue: false,
    shouldPersist: (value) => value,
  });
  const { data, loading, error, refetch } = useApi(api.projects);
  const {
    data: diagnostics,
    loading: diagnosticsLoading,
    error: diagnosticsError,
    refetch: refetchDiagnostics,
  } = useApi(api.projectDiagnostics);
  const { projects: projectSnapshot, setProjects } = useAppData();

  const projects = projectSnapshot ?? data ?? null;
  const invalidProjects = diagnostics?.invalidProjects ?? [];
  const isLoading = projectSnapshot === null && loading;
  const visibleError = projectSnapshot === null ? error : null;

  const refreshProjects = useCallback(async () => {
    const [nextProjects] = await Promise.all([
      refetch(),
      refetchDiagnostics({ resetLoading: false }),
    ]);

    if (nextProjects) {
      setProjects(nextProjects);
    }

    return nextProjects;
  }, [refetch, refetchDiagnostics, setProjects]);

  useEffect(() => {
    function handleProjectsChanged() {
      void refreshProjects();
    }

    window.addEventListener(PROJECTS_CHANGED_EVENT, handleProjectsChanged);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, handleProjectsChanged);
  }, [refreshProjects]);

  function openCreateForm() {
    navigate('/projects');
    setShowCreateForm(true);
  }

  function handleCreated(projectId: string) {
    setShowCreateForm(false);
    navigate(`/projects/${projectId}`);
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        actions={(
          <>
            <ToolbarButton onClick={() => {
              if (showCreateForm) {
                setShowCreateForm(false);
                return;
              }

              openCreateForm();
            }}>
              {showCreateForm ? 'Close new project' : '+ New project'}
            </ToolbarButton>
            <ToolbarButton onClick={() => { void refreshProjects(); }}>↻ Refresh</ToolbarButton>
          </>
        )}
      >
        <PageHeading
          title="Projects"
          meta={(
            projects && (
              <>
                {projects.length} {projects.length === 1 ? 'project' : 'projects'}
              </>
            )
          )}
        />
      </PageHeader>

      <div className="flex-1 px-6 py-4">
        {isLoading && <LoadingState label="Loading projects…" />}
        {visibleError && <ErrorState message={`Failed to load projects: ${visibleError}`} />}

        {!isLoading && !visibleError && !diagnosticsLoading && projects?.length === 0 && invalidProjects.length === 0 && !diagnosticsError && !showCreateForm && (
          <EmptyState
            title="No projects yet."
            body="Projects track ongoing work, milestones, and tasks."
            action={<ToolbarButton onClick={openCreateForm}>Create project</ToolbarButton>}
          />
        )}

        {!isLoading && !visibleError && (showCreateForm || diagnosticsError !== null || invalidProjects.length > 0 || (projects && projects.length > 0)) && (
          <div className="space-y-6">
            {showCreateForm && (
              <CreateProjectPanel
                onCreated={handleCreated}
                onCancel={() => setShowCreateForm(false)}
              />
            )}

            {diagnosticsError && (
              <p className="text-[12px] text-danger/80">Failed to load project diagnostics: {diagnosticsError}</p>
            )}

            {diagnostics && invalidProjects.length > 0 && (
              <ProjectDiagnosticsPanel
                profile={diagnostics.profile}
                invalidProjects={invalidProjects}
              />
            )}

            {projects && projects.length > 0 && (
              <div className="space-y-px">
                {projects.map((project) => {
                  const status = formatProjectStatus(project.status);
                  const blockers = project.blockers.filter((blocker) => blocker.trim().length > 0);
                  const isBlocked = hasMeaningfulBlockers(project.blockers);
                  const isSelected = project.id === selectedId;
                  const preview = summarizeProjectPreview(project);
                  const dotClass = isBlocked ? 'bg-warning' : 'bg-teal';

                  return (
                    <ListLinkRow
                      key={project.id}
                      to={`/projects/${project.id}`}
                      selected={isSelected}
                      leading={<span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${dotClass}`} />}
                    >
                      <p className="ui-card-title">{project.title}</p>
                      <p className="ui-row-summary">{preview}</p>
                      <div className="flex items-center gap-1.5 flex-wrap ui-card-meta">
                        <span>{status}</span>
                        <span className="opacity-40">·</span>
                        <span className="max-w-[18rem] truncate font-mono" title={project.id}>{project.id}</span>
                        <span className="opacity-40">·</span>
                        <span>{timeAgo(project.updatedAt)}</span>
                        {isBlocked && blockers[0] && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="text-warning">{blockers[0]}</span>
                          </>
                        )}
                      </div>
                    </ListLinkRow>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
