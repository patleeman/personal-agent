import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { bucketProjectStatus, formatProjectStatus, isProjectArchived, summarizeProjectPreview } from '../contextRailProject';
import { useApi } from '../hooks';
import { useAppData } from '../contexts';
import { emitProjectsChanged, PROJECTS_CHANGED_EVENT } from '../projectEvents';
import { useReloadState } from '../reloadState';
import { EmptyState, ErrorState, LoadingState, PageHeader, PageHeading, Pill, ToolbarButton, cx } from '../components/ui';
import { MentionTextarea } from '../components/MentionTextarea';
import { RichMarkdownEditor } from '../components/editor/RichMarkdownEditor';
import { ProjectDetailPanel } from '../components/ProjectDetailPanel';
import {
  buildProjectsHref,
  readCreateProjectState,
  VIEW_PROFILE_QUERY_PARAM,
} from '../projectWorkspaceState';
import { ensureOpenResourceShelfItem } from '../openResourceShelves';
import { timeAgo } from '../utils';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary focus:outline-none focus:border-accent/60';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[104px] resize-y leading-relaxed`;
const CREATE_PROJECT_TITLE_STORAGE_KEY = 'pa:reload:projects:create-title';
const CREATE_PROJECT_DOCUMENT_STORAGE_KEY = 'pa:reload:projects:create-document';
const CREATE_PROJECT_REPO_ROOT_STORAGE_KEY = 'pa:reload:projects:create-repo-root';
const CREATE_PROJECT_SUMMARY_STORAGE_KEY = 'pa:reload:projects:create-summary';
type ProjectFilter = 'active' | 'paused' | 'done' | 'archived' | 'all';

function summarizeRepoRoot(repoRoot: string | undefined): string | null {
  const normalized = repoRoot?.trim();
  if (!normalized) {
    return null;
  }

  const segments = normalized.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function toneForProjectStatus(status: string, archived: boolean): 'muted' | 'warning' | 'success' | 'teal' {
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

function taskCounts(tasks: Array<{ status: string }>): { open: number; done: number } {
  const done = tasks.filter((task) => task.status === 'done' || task.status === 'completed').length;
  return {
    open: Math.max(0, tasks.length - done),
    done,
  };
}

function matchesProjectFilter(
  project: {
    archivedAt?: string;
    status: string;
  },
  filter: ProjectFilter,
): boolean {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'archived') {
    return isProjectArchived(project);
  }

  if (isProjectArchived(project)) {
    return false;
  }

  const normalizedStatus = bucketProjectStatus(project.status);
  if (filter === 'done') {
    return normalizedStatus === 'done';
  }

  if (filter === 'paused') {
    return normalizedStatus === 'paused';
  }

  return normalizedStatus === 'active';
}

function CreateProjectPanel({
  profile,
  onCreated,
  onCancel,
}: {
  profile: string;
  onCreated: (projectId: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle, clearTitle] = useReloadState<string>({
    storageKey: CREATE_PROJECT_TITLE_STORAGE_KEY,
    initialValue: '',
    shouldPersist: (value) => value.length > 0,
  });
  const [documentContent, setDocumentContent, clearDocumentContent] = useReloadState<string>({
    storageKey: CREATE_PROJECT_DOCUMENT_STORAGE_KEY,
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
    clearDocumentContent();
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
        documentContent,
        repoRoot: repoRoot.trim() || undefined,
        summary: summary.trim() || undefined,
      }, { profile });
      clearTitle();
      clearDocumentContent();
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
    <div className="mx-auto w-full max-w-5xl rounded-3xl border border-border-subtle bg-base/70 px-6 py-6 shadow-sm">
      <div className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-[20px] font-semibold tracking-tight text-primary">New project</h2>
          <p className="ui-card-meta max-w-2xl">
            Create a durable project with a title, summary, repo root, and an optional starting document.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
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
            <label className="ui-card-meta" htmlFor="project-summary">Summary</label>
            <MentionTextarea
              id="project-summary"
              value={summary}
              onValueChange={setSummary}
              className={TEXTAREA_CLASS}
              placeholder="Short summary shown in project lists."
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
            <label className="ui-card-meta" htmlFor="project-document">Starting document</label>
            <RichMarkdownEditor
              value={documentContent}
              onChange={setDocumentContent}
              placeholder="Optional. Add the initial context or plan you want to keep with the project."
              variant="panel"
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
    </div>
  );
}

function ProjectDiagnosticsPanel({
  profile,
  invalidProjects,
}: {
  profile: string;
  invalidProjects: Array<{ projectId: string; profile?: string; path: string; error: string }>;
}) {
  if (invalidProjects.length === 0) {
    return null;
  }

  const validatorCommand = profile === 'all'
    ? null
    : `npm run validate:projects -- --profile ${profile}`;

  return (
    <div className="rounded-2xl border border-danger/25 bg-danger/5 px-4 py-4">
      <div className="space-y-1">
        <p className="text-[13px] text-danger">
          {invalidProjects.length} {invalidProjects.length === 1 ? 'project file could not be loaded.' : 'project files could not be loaded.'}
        </p>
        {validatorCommand ? (
          <p className="ui-card-meta">
            Fix the invalid YAML or run{' '}
            <span className="font-mono text-primary">{validatorCommand}</span>
            {' '}to inspect all project files for this profile.
          </p>
        ) : (
          <p className="ui-card-meta">Fix the invalid YAML in the listed profile before it will appear in the combined project view.</p>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {invalidProjects.map((issue) => (
          <div key={`${issue.profile ?? profile}:${issue.projectId}`} className="space-y-0.5">
            <p className="font-mono text-[12px] text-danger">{issue.projectId}</p>
            {issue.profile && <p className="ui-card-meta">profile {issue.profile}</p>}
            <p className="text-[12px] text-danger/85">{issue.error}</p>
            <p className="ui-card-meta break-all font-mono">{issue.path}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectsTable({
  projects,
  effectiveViewProfile,
}: {
  projects: Array<{
    id: string;
    title: string;
    summary: string;
    description: string;
    profile?: string;
    repoRoot?: string;
    updatedAt: string;
    archivedAt?: string;
    status: string;
    currentFocus?: string;
    requirements: { goal: string; acceptanceCriteria: string[] };
    plan: { tasks: Array<{ status: string }> };
    blockers: string[];
  }>;
  effectiveViewProfile: string | 'all' | undefined;
}) {
  const navigate = useNavigate();

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border-subtle bg-surface/10">
      <table className="min-w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-base/95 backdrop-blur">
          <tr className="border-b border-border-subtle text-[10px] uppercase tracking-[0.14em] text-dim">
            <th className="px-4 py-2.5 font-medium">Project</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 font-medium">Current focus</th>
            <th className="px-3 py-2.5 font-medium">Tasks</th>
            <th className="px-3 py-2.5 font-medium">Profile</th>
            <th className="px-4 py-2.5 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const archived = isProjectArchived(project);
            const projectHref = buildProjectsHref(effectiveViewProfile ?? project.profile ?? 'shared', project.id);
            const taskSummary = taskCounts(project.plan.tasks);
            const blockerCount = project.blockers.filter((blocker) => blocker.trim().length > 0).length;
            const repoLabel = summarizeRepoRoot(project.repoRoot);
            const currentFocus = project.currentFocus?.trim()
              || project.requirements.goal.trim()
              || '—';

            return (
              <tr
                key={`${project.profile ?? effectiveViewProfile ?? 'shared'}:${project.id}`}
                className="cursor-pointer border-b border-border-subtle align-top transition-colors hover:bg-surface/35"
                tabIndex={0}
                onClick={() => navigate(projectHref)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(projectHref);
                  }
                }}
              >
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={projectHref}
                        className="text-[14px] font-medium text-primary transition-colors hover:text-accent"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {project.title}
                      </Link>
                      {archived && <span className="ui-card-meta">archived</span>}
                    </div>
                    <p className="max-w-2xl text-[12px] leading-relaxed text-secondary">{summarizeProjectPreview(project)}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
                      <span className="font-mono">{project.id}</span>
                      {repoLabel && (
                        <>
                          <span className="opacity-40">·</span>
                          <span>{repoLabel}</span>
                        </>
                      )}
                      {blockerCount > 0 && (
                        <>
                          <span className="opacity-40">·</span>
                          <span>{blockerCount} {blockerCount === 1 ? 'blocker' : 'blockers'}</span>
                        </>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <Pill tone={toneForProjectStatus(project.status, archived)}>
                    {formatProjectStatus(project.status)}
                  </Pill>
                </td>
                <td className="px-3 py-3 text-[12px] leading-relaxed text-secondary">{currentFocus}</td>
                <td className="px-3 py-3">
                  <div className="text-[12px] text-primary">{taskSummary.open} open</div>
                  <div className="mt-0.5 text-[11px] text-dim">{taskSummary.done} done</div>
                </td>
                <td className="px-3 py-3 text-[12px] text-secondary">{project.profile ?? effectiveViewProfile ?? 'shared'}</td>
                <td className="px-4 py-3 text-[12px] text-secondary">{timeAgo(project.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: selectedId } = useParams<{ id?: string }>();
  const { data: profileState, error: profilesError } = useApi(api.profiles);
  const requestedViewProfile = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const value = params.get(VIEW_PROFILE_QUERY_PARAM)?.trim();
    return value && value.length > 0 ? value : null;
  }, [location.search]);
  const effectiveViewProfile = useMemo(() => {
    if (requestedViewProfile === 'all') {
      return 'all' as const;
    }

    if (!profileState) {
      return undefined;
    }

    if (requestedViewProfile && profileState.profiles.includes(requestedViewProfile)) {
      return requestedViewProfile;
    }

    return profileState.currentProfile;
  }, [profileState, requestedViewProfile]);
  const projectsFetcher = useCallback(
    () => api.projects(effectiveViewProfile ? { profile: effectiveViewProfile } : undefined),
    [effectiveViewProfile],
  );
  const diagnosticsFetcher = useCallback(
    () => api.projectDiagnostics(effectiveViewProfile ? { profile: effectiveViewProfile } : undefined),
    [effectiveViewProfile],
  );
  const { data, loading, error } = useApi(projectsFetcher, effectiveViewProfile ? `projects:${effectiveViewProfile}` : 'projects');
  const {
    data: diagnostics,
    loading: diagnosticsLoading,
    error: diagnosticsError,
  } = useApi(diagnosticsFetcher, effectiveViewProfile ? `project-diagnostics:${effectiveViewProfile}` : 'project-diagnostics');
  const projectDetailApi = useApi(
    () => selectedId ? api.projectById(selectedId, effectiveViewProfile && effectiveViewProfile !== 'all' ? { profile: effectiveViewProfile } : undefined) : Promise.resolve(null),
    `project-workspace:${selectedId ?? 'none'}:${effectiveViewProfile ?? ''}`,
  );
  const { projects: projectSnapshot, setProjects } = useAppData();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ProjectFilter>('active');

  const currentProfile = profileState?.currentProfile ?? null;
  const createProfile = requestedViewProfile && requestedViewProfile !== 'all'
    ? requestedViewProfile
    : currentProfile;
  const usingCurrentProfileSnapshot = Boolean(
    currentProfile
    && effectiveViewProfile
    && effectiveViewProfile !== 'all'
    && effectiveViewProfile === currentProfile,
  );
  const projects = usingCurrentProfileSnapshot ? (projectSnapshot ?? data ?? null) : data ?? null;
  const invalidProjects = diagnostics?.invalidProjects ?? [];
  const isLoading = (usingCurrentProfileSnapshot ? projectSnapshot === null : data === null) && loading;
  const visibleError = (usingCurrentProfileSnapshot ? projectSnapshot === null : data === null) ? error : null;
  const showCreateForm = useMemo(() => !selectedId && readCreateProjectState(location.search), [location.search, selectedId]);

  const filteredProjects = useMemo(() => {
    const items = projects ?? [];
    const normalizedQuery = query.trim().toLowerCase();

    return [...items]
      .filter((project) => matchesProjectFilter(project, filter))
      .filter((project) => {
        if (!normalizedQuery) {
          return true;
        }

        return [
          project.id,
          project.title,
          project.summary,
          project.description,
          project.currentFocus ?? '',
          project.repoRoot ?? '',
        ].join('\n').toLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [filter, projects, query]);

  const refreshProjects = useCallback(async () => {
    const [nextProjects] = await Promise.all([
      projectsFetcher(),
      diagnosticsFetcher(),
      selectedId ? projectDetailApi.refetch({ resetLoading: false }) : Promise.resolve(null),
    ]);

    if (nextProjects && usingCurrentProfileSnapshot) {
      setProjects(nextProjects);
    }

    return nextProjects;
  }, [diagnosticsFetcher, projectDetailApi, projectsFetcher, selectedId, setProjects, usingCurrentProfileSnapshot]);

  useEffect(() => {
    function handleProjectsChanged() {
      void refreshProjects();
    }

    window.addEventListener(PROJECTS_CHANGED_EVENT, handleProjectsChanged);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, handleProjectsChanged);
  }, [refreshProjects]);

  useEffect(() => {
    if (!selectedId || !projects) {
      return;
    }

    if (projects.some((project) => project.id === selectedId)) {
      return;
    }

    navigate(effectiveViewProfile ? buildProjectsHref(effectiveViewProfile) : '/projects', { replace: true });
  }, [effectiveViewProfile, navigate, projects, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    ensureOpenResourceShelfItem('project', selectedId);
  }, [selectedId]);

  function openCreateForm() {
    if (!createProfile) {
      return;
    }

    navigate(buildProjectsHref(createProfile, undefined, null, true));
  }

  function closeCreateForm() {
    navigate(createProfile ? buildProjectsHref(createProfile) : (effectiveViewProfile ? buildProjectsHref(effectiveViewProfile) : '/projects'));
  }

  function handleCreated(projectId: string) {
    navigate(createProfile ? buildProjectsHref(createProfile, projectId) : `/projects/${projectId}`);
  }

  return (
    <div className="min-h-0 flex h-full flex-col overflow-hidden">
      {showCreateForm && createProfile ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
            <PageHeader
              actions={<ToolbarButton onClick={closeCreateForm}>Back to projects</ToolbarButton>}
            >
              <PageHeading
                title="Projects"
                meta="Create a new project and keep the durable document, tasks, notes, and files together."
              />
            </PageHeader>
            <CreateProjectPanel
              profile={createProfile}
              onCreated={handleCreated}
              onCancel={closeCreateForm}
            />
          </div>
        </div>
      ) : selectedId ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {projectDetailApi.loading && !projectDetailApi.data ? (
            <LoadingState label="Loading project…" className="h-full justify-center" />
          ) : projectDetailApi.error || !projectDetailApi.data ? (
            <ErrorState message={`Failed to load project: ${projectDetailApi.error ?? 'Project not found.'}`} />
          ) : (
            <div className="mx-auto w-full max-w-[1440px]">
              <ProjectDetailPanel
                project={projectDetailApi.data}
                activeProfile={profileState?.currentProfile}
                onChanged={() => {
                  void projectDetailApi.refetch({ resetLoading: false });
                  void refreshProjects();
                  emitProjectsChanged();
                }}
                onDeleted={() => {
                  navigate(effectiveViewProfile ? buildProjectsHref(effectiveViewProfile) : '/projects');
                  emitProjectsChanged();
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
            <PageHeader
              actions={(
                <>
                  <ToolbarButton onClick={openCreateForm} disabled={!createProfile}>New project</ToolbarButton>
                  <ToolbarButton onClick={() => { void refreshProjects(); }}>Refresh</ToolbarButton>
                </>
              )}
            >
              <PageHeading
                title="Projects"
                meta="Browse durable projects, then open one into the main workspace and the left sidebar shelf."
              />
            </PageHeader>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {(['active', 'paused', 'done', 'archived', 'all'] as ProjectFilter[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    className={cx(
                      'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                      filter === value
                        ? 'border-border-default bg-surface text-primary'
                        : 'border-border-subtle bg-transparent text-secondary hover:text-primary',
                    )}
                  >
                    {value === 'all' ? 'All' : value === 'done' ? 'Done' : value === 'paused' ? 'Paused' : value === 'archived' ? 'Archived' : 'Active'}
                  </button>
                ))}
              </div>

              <div className="flex w-full flex-col gap-3 sm:flex-row xl:w-auto xl:items-center">
                {profileState && (
                  <select
                    value={effectiveViewProfile ?? profileState.currentProfile}
                    onChange={(event) => navigate(buildProjectsHref(event.target.value === 'all' ? 'all' : event.target.value))}
                    className="rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary focus:outline-none focus:border-accent/60"
                  >
                    <option value="all">All profiles</option>
                    {profileState.profiles.map((profile) => (
                      <option key={profile} value={profile}>{profile}</option>
                    ))}
                  </select>
                )}

                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search projects"
                  className="w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60 sm:w-[20rem]"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>

            {profilesError && <p className="text-[12px] text-danger/80">Failed to load profiles: {profilesError}</p>}
            {diagnosticsError && <p className="text-[12px] text-danger/80">Failed to load project diagnostics: {diagnosticsError}</p>}

            {!isLoading && !visibleError && invalidProjects.length > 0 && diagnostics && (
              <ProjectDiagnosticsPanel profile={diagnostics.profile} invalidProjects={invalidProjects} />
            )}

            {isLoading ? <LoadingState label="Loading projects…" className="h-full" /> : null}
            {visibleError ? <ErrorState message={`Failed to load projects: ${visibleError}`} /> : null}

            {!isLoading && !visibleError && !diagnosticsLoading && projects?.length === 0 && invalidProjects.length === 0 ? (
              <EmptyState
                className="min-h-[18rem]"
                title="No projects yet"
                body={effectiveViewProfile === 'all'
                  ? 'No projects exist in any profile yet.'
                  : `Projects track ongoing work, milestones, and tasks for profile ${effectiveViewProfile ?? currentProfile ?? 'current'}.`}
                action={<ToolbarButton onClick={openCreateForm}>Create project</ToolbarButton>}
              />
            ) : null}

            {!isLoading && !visibleError && projects && filteredProjects.length > 0 ? (
              <ProjectsTable projects={filteredProjects} effectiveViewProfile={effectiveViewProfile} />
            ) : null}

            {!isLoading && !visibleError && projects && filteredProjects.length === 0 && projects.length > 0 ? (
              <EmptyState
                className="min-h-[18rem]"
                title="No matching projects"
                body="Try a broader search or another filter."
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
