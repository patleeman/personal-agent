import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import {
  formatProjectStatus,
  hasMeaningfulBlockers,
  isProjectArchived,
  summarizeProjectPreview,
} from '../contextRailProject';
import { useApi } from '../hooks';
import { useAppData } from '../contexts';
import { emitProjectsChanged, PROJECTS_CHANGED_EVENT } from '../projectEvents';
import { useReloadState } from '../reloadState';
import { timeAgo } from '../utils';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, ToolbarButton } from '../components/ui';
import { MentionTextarea } from '../components/MentionTextarea';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary focus:outline-none focus:border-accent/60';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[104px] resize-y leading-relaxed`;
const CREATE_PROJECT_OPEN_STORAGE_KEY = 'pa:reload:projects:create-open';
const CREATE_PROJECT_TITLE_STORAGE_KEY = 'pa:reload:projects:create-title';
const CREATE_PROJECT_DESCRIPTION_STORAGE_KEY = 'pa:reload:projects:create-description';
const CREATE_PROJECT_REPO_ROOT_STORAGE_KEY = 'pa:reload:projects:create-repo-root';
const CREATE_PROJECT_SUMMARY_STORAGE_KEY = 'pa:reload:projects:create-summary';
const CREATE_PROJECT_GOAL_STORAGE_KEY = 'pa:reload:projects:create-goal';
const CREATE_PROJECT_ACCEPTANCE_CRITERIA_STORAGE_KEY = 'pa:reload:projects:create-acceptance-criteria';
const CREATE_PROJECT_PLAN_SUMMARY_STORAGE_KEY = 'pa:reload:projects:create-plan-summary';
const VIEW_PROFILE_QUERY_PARAM = 'viewProfile';

type ProjectListFilter = 'active' | 'archived' | 'all';

const PROJECT_FILTER_OPTIONS: Array<{ value: ProjectListFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

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
  const [goal, setGoal, clearGoal] = useReloadState<string>({
    storageKey: CREATE_PROJECT_GOAL_STORAGE_KEY,
    initialValue: '',
    shouldPersist: (value) => value.length > 0,
  });
  const [acceptanceCriteria, setAcceptanceCriteria, clearAcceptanceCriteria] = useReloadState<string>({
    storageKey: CREATE_PROJECT_ACCEPTANCE_CRITERIA_STORAGE_KEY,
    initialValue: '',
    shouldPersist: (value) => value.length > 0,
  });
  const [planSummary, setPlanSummary, clearPlanSummary] = useReloadState<string>({
    storageKey: CREATE_PROJECT_PLAN_SUMMARY_STORAGE_KEY,
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
    clearGoal();
    clearAcceptanceCriteria();
    clearPlanSummary();
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
        goal: goal.trim() || undefined,
        acceptanceCriteria: acceptanceCriteria
          .split('\n')
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
        planSummary: planSummary.trim() || undefined,
      }, { profile });
      clearTitle();
      clearDescription();
      clearRepoRoot();
      clearSummary();
      clearGoal();
      clearAcceptanceCriteria();
      clearPlanSummary();
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
          <MentionTextarea
            id="project-description"
            value={description}
            onValueChange={setDescription}
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
          <label className="ui-card-meta" htmlFor="project-summary">List summary</label>
          <MentionTextarea
            id="project-summary"
            value={summary}
            onValueChange={setSummary}
            className={TEXTAREA_CLASS}
            placeholder="Optional. Used in project lists and compact previews."
          />
        </div>

        <div className="space-y-1.5">
          <label className="ui-card-meta" htmlFor="project-goal">Goal</label>
          <MentionTextarea
            id="project-goal"
            value={goal}
            onValueChange={setGoal}
            className={TEXTAREA_CLASS}
            placeholder="What should this project accomplish?"
          />
        </div>

        <div className="space-y-1.5">
          <label className="ui-card-meta" htmlFor="project-acceptance-criteria">Acceptance criteria (one per line)</label>
          <MentionTextarea
            id="project-acceptance-criteria"
            value={acceptanceCriteria}
            onValueChange={setAcceptanceCriteria}
            className={TEXTAREA_CLASS}
            placeholder="How will you know the project is done?"
          />
        </div>

        <div className="space-y-1.5">
          <label className="ui-card-meta" htmlFor="project-plan-summary">Plan summary</label>
          <MentionTextarea
            id="project-plan-summary"
            value={planSummary}
            onValueChange={setPlanSummary}
            className={TEXTAREA_CLASS}
            placeholder="Optional. Outline the intended approach before you create milestones and tasks."
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
  invalidProjects: Array<{ projectId: string; profile?: string; path: string; error: string }>;
}) {
  if (invalidProjects.length === 0) {
    return null;
  }

  const validatorCommand = profile === 'all'
    ? null
    : `npm run validate:projects -- --profile ${profile}`;

  return (
    <div className="space-y-3">
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

      <div className="space-y-3">
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

export function ProjectsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: selectedId } = useParams<{ id?: string }>();
  const createFormStorageKey = selectedId ? null : CREATE_PROJECT_OPEN_STORAGE_KEY;
  const [showCreateForm, setShowCreateForm] = useReloadState<boolean>({
    storageKey: createFormStorageKey,
    initialValue: false,
    shouldPersist: (value) => value,
  });
  const [filter, setFilter] = useState<ProjectListFilter>('active');
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
  const { projects: projectSnapshot, setProjects } = useAppData();

  const currentProfile = profileState?.currentProfile ?? null;
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
  const viewProfileLabel = effectiveViewProfile === 'all'
    ? 'all profiles'
    : effectiveViewProfile
      ? `profile ${effectiveViewProfile}`
      : 'projects';

  const projectCounts = useMemo(() => {
    const items = projects ?? [];
    const archived = items.filter((project) => isProjectArchived(project)).length;
    const active = items.length - archived;

    return {
      all: items.length,
      active,
      archived,
    };
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const items = projects ?? [];

    if (filter === 'archived') {
      return items.filter((project) => isProjectArchived(project));
    }

    if (filter === 'all') {
      return items;
    }

    return items.filter((project) => !isProjectArchived(project));
  }, [filter, projects]);

  const buildProjectsHref = useCallback((profile: string | 'all', projectId?: string) => {
    const params = new URLSearchParams();
    params.set(VIEW_PROFILE_QUERY_PARAM, profile);
    const search = `?${params.toString()}`;
    return projectId ? `/projects/${projectId}${search}` : `/projects${search}`;
  }, []);

  const refreshProjects = useCallback(async () => {
    const [nextProjects] = await Promise.all([
      projectsFetcher(),
      diagnosticsFetcher(),
    ]);

    if (nextProjects && usingCurrentProfileSnapshot) {
      setProjects(nextProjects);
    }

    return nextProjects;
  }, [diagnosticsFetcher, projectsFetcher, setProjects, usingCurrentProfileSnapshot]);

  useEffect(() => {
    function handleProjectsChanged() {
      void refreshProjects();
    }

    window.addEventListener(PROJECTS_CHANGED_EVENT, handleProjectsChanged);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, handleProjectsChanged);
  }, [refreshProjects]);

  function setViewProfile(nextProfile: string | 'all') {
    setShowCreateForm(false);
    navigate(buildProjectsHref(nextProfile));
  }

  function openCreateForm() {
    const createProfile = effectiveViewProfile && effectiveViewProfile !== 'all'
      ? effectiveViewProfile
      : currentProfile;

    if (!createProfile) {
      return;
    }

    navigate(buildProjectsHref(createProfile));
    setShowCreateForm(true);
  }

  function handleCreated(projectId: string) {
    const createProfile = effectiveViewProfile && effectiveViewProfile !== 'all'
      ? effectiveViewProfile
      : currentProfile;
    setShowCreateForm(false);
    navigate(createProfile ? buildProjectsHref(createProfile, projectId) : `/projects/${projectId}`);
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        className="flex-wrap items-start gap-y-3"
        actions={(
          <>
            <ToolbarButton onClick={() => {
              if (showCreateForm) {
                setShowCreateForm(false);
                return;
              }

              openCreateForm();
            }} disabled={!currentProfile && effectiveViewProfile !== 'all'}>
              {showCreateForm ? 'Close new project' : '+ New project'}
            </ToolbarButton>
            <ToolbarButton onClick={() => { void refreshProjects(); }}>↻ Refresh</ToolbarButton>
          </>
        )}
      >
        <PageHeading
          title="Projects"
          meta={projects
            ? `${projectCounts.all} ${projectCounts.all === 1 ? 'project' : 'projects'}${projectCounts.archived > 0 ? ` · ${projectCounts.archived} archived` : ''} · ${viewProfileLabel}`
            : `Browse durable work hubs across ${viewProfileLabel}.`}
        />
      </PageHeader>

      <div className="flex-1 px-6 py-4">
        {profilesError && <p className="mb-4 text-[12px] text-danger/80">Failed to load profiles: {profilesError}</p>}

        {(profileState || (projects && projects.length > 0) || filter !== 'active') && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {(projectCounts.archived > 0 || filter !== 'active') && (
              <div className="ui-segmented-control" role="group" aria-label="Project filter">
                {PROJECT_FILTER_OPTIONS.map((option) => {
                  const count = projectCounts[option.value];
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFilter(option.value)}
                      className={filter === option.value ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
                    >
                      {option.label}
                      <span className="ml-1 text-dim/70">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {profileState && (
              <label className="flex items-center gap-2">
                <span className="ui-card-meta">Profile</span>
                <select
                  value={effectiveViewProfile ?? profileState.currentProfile}
                  onChange={(event) => setViewProfile(event.target.value === 'all' ? 'all' : event.target.value)}
                  className={`${INPUT_CLASS} min-w-[12rem] py-1.5`}
                >
                  <option value="all">All profiles</option>
                  {profileState.profiles.map((profile) => (
                    <option key={profile} value={profile}>{profile}</option>
                  ))}
                </select>
              </label>
            )}

            {effectiveViewProfile === 'all' && projects && projects.length > 0 && (
              <p className="ui-card-meta">Selecting a project jumps into that project&apos;s profile view.</p>
            )}
          </div>
        )}

        {isLoading && <LoadingState label="Loading projects…" />}
        {visibleError && <ErrorState message={`Failed to load projects: ${visibleError}`} />}

        {!isLoading && !visibleError && !diagnosticsLoading && projects?.length === 0 && invalidProjects.length === 0 && !diagnosticsError && !showCreateForm && (
          <EmptyState
            title="No projects yet."
            body={effectiveViewProfile === 'all'
              ? 'No projects exist in any profile yet.'
              : `Projects track ongoing work, milestones, and tasks for profile ${effectiveViewProfile ?? currentProfile ?? 'current'}.`}
            action={<ToolbarButton onClick={openCreateForm}>Create project</ToolbarButton>}
          />
        )}

        {!isLoading && !visibleError && (showCreateForm || diagnosticsError !== null || invalidProjects.length > 0 || (projects && projects.length > 0)) && (
          <div className="space-y-6">
            {showCreateForm && effectiveViewProfile && effectiveViewProfile !== 'all' && (
              <CreateProjectPanel
                profile={effectiveViewProfile}
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
              <div className="space-y-4">
                {filteredProjects.length > 0 ? (
                  <div className="space-y-px">
                    {filteredProjects.map((project) => {
                      const status = formatProjectStatus(project.status);
                      const blockers = project.blockers.filter((blocker) => blocker.trim().length > 0);
                      const isBlocked = hasMeaningfulBlockers(project.blockers);
                      const archived = isProjectArchived(project);
                      const detailProfile = effectiveViewProfile === 'all' ? (project.profile ?? currentProfile ?? 'shared') : (effectiveViewProfile ?? currentProfile ?? 'shared');
                      const isSelected = project.id === selectedId && detailProfile === effectiveViewProfile;
                      const preview = summarizeProjectPreview(project);
                      const dotClass = archived ? 'bg-border-default' : isBlocked ? 'bg-warning' : 'bg-teal';

                      return (
                        <ListLinkRow
                          key={`${project.profile ?? detailProfile}:${project.id}`}
                          to={buildProjectsHref(detailProfile, project.id)}
                          selected={isSelected}
                          leading={<span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${dotClass}`} />}
                        >
                          <p className="ui-card-title">{project.title}</p>
                          <p className="ui-row-summary">{preview}</p>
                          <div className="flex items-center gap-1.5 flex-wrap ui-card-meta">
                            <span>{status}</span>
                            {effectiveViewProfile === 'all' && project.profile && (
                              <>
                                <span className="opacity-40">·</span>
                                <span>profile {project.profile}</span>
                              </>
                            )}
                            {archived && project.archivedAt && (
                              <>
                                <span className="opacity-40">·</span>
                                <span>archived {timeAgo(project.archivedAt)}</span>
                              </>
                            )}
                            <span className="opacity-40">·</span>
                            <span className="max-w-[18rem] truncate font-mono" title={project.id}>{project.id}</span>
                            <span className="opacity-40">·</span>
                            <span>{timeAgo(project.updatedAt)}</span>
                            {!archived && isBlocked && blockers[0] && (
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
                ) : (
                  <EmptyState
                    title={filter === 'archived' ? 'No archived projects yet.' : filter === 'active' ? 'No active projects.' : 'No projects match this filter.'}
                    body={filter === 'archived'
                      ? 'Archive completed or cancelled projects to move them out of the active list without deleting the history.'
                      : filter === 'active'
                        ? 'All current projects are archived. Switch to the archived filter to browse finished work.'
                        : 'Try another project filter.'}
                    action={filter === 'active' && projectCounts.archived > 0
                      ? <ToolbarButton onClick={() => setFilter('archived')}>View archived projects</ToolbarButton>
                      : filter !== 'all'
                        ? <ToolbarButton onClick={() => setFilter('all')}>Show all projects</ToolbarButton>
                        : undefined}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
