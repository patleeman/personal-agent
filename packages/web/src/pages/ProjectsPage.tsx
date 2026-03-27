import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { isProjectArchived } from '../contextRailProject';
import { useApi } from '../hooks';
import { useAppData } from '../contexts';
import { emitProjectsChanged, PROJECTS_CHANGED_EVENT } from '../projectEvents';
import { useReloadState } from '../reloadState';
import { EmptyState, ErrorState, LoadingState, PageHeader, PageHeading, ToolbarButton } from '../components/ui';
import { MentionTextarea } from '../components/MentionTextarea';
import { ProjectDetailPanel } from '../components/ProjectDetailPanel';
import { buildProjectsHref, projectViewToSectionId, readProjectView, VIEW_PROFILE_QUERY_PARAM } from '../projectWorkspaceState';

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
    <div className="min-w-0 rounded-2xl border border-border-subtle bg-base/70 px-4 py-4 shadow-sm">
      <div className="space-y-5">
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
    <div className="space-y-3 rounded-2xl border border-border-subtle bg-base/70 px-4 py-4 shadow-sm">
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
    return {
      all: items.length,
      archived,
    };
  }, [projects]);
  const selectedView = useMemo(() => readProjectView(location.search), [location.search]);

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
    if (!selectedId || !projectDetailApi.data || showCreateForm) {
      return;
    }

    const targetId = projectViewToSectionId(selectedView);
    if (!targetId) {
      return;
    }

    const handle = window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
    });

    return () => window.cancelAnimationFrame(handle);
  }, [projectDetailApi.data, selectedId, selectedView, showCreateForm]);

  function setViewProfile(nextProfile: string | 'all') {
    setShowCreateForm(false);
    navigate(buildProjectsHref(nextProfile, selectedId, selectedView === 'overview' ? null : selectedView));
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
              {showCreateForm ? 'Close new project' : 'New project'}
            </ToolbarButton>
            <ToolbarButton onClick={() => { void refreshProjects(); }}>Refresh</ToolbarButton>
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

      <div className="min-h-0 flex-1 px-6 py-4">
        <div className="flex h-full min-h-0 flex-col gap-4">
          {profilesError && <p className="text-[12px] text-danger/80">Failed to load profiles: {profilesError}</p>}

          {profileState && (
            <div className="flex flex-wrap items-center gap-3">
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
              <p className="ui-card-meta">Use the right rail to browse projects and jump between logical project sections.</p>
            </div>
          )}

          {isLoading && <LoadingState label="Loading projects…" />}
          {visibleError && <ErrorState message={`Failed to load projects: ${visibleError}`} />}
          {diagnosticsError && <p className="text-[12px] text-danger/80">Failed to load project diagnostics: {diagnosticsError}</p>}

          {!isLoading && !visibleError && invalidProjects.length > 0 && diagnostics && (
            <ProjectDiagnosticsPanel profile={diagnostics.profile} invalidProjects={invalidProjects} />
          )}

          <div className="min-h-0 flex-1 overflow-hidden">
            {showCreateForm && effectiveViewProfile && effectiveViewProfile !== 'all' ? (
              <div className="h-full overflow-y-auto">
                <CreateProjectPanel
                  profile={effectiveViewProfile}
                  onCreated={handleCreated}
                  onCancel={() => setShowCreateForm(false)}
                />
              </div>
            ) : selectedId ? (
              projectDetailApi.loading && !projectDetailApi.data ? (
                <LoadingState label="Loading project…" className="h-full justify-center" />
              ) : projectDetailApi.error || !projectDetailApi.data ? (
                <ErrorState message={`Failed to load project: ${projectDetailApi.error ?? 'Project not found.'}`} />
              ) : (
                <div className="h-full overflow-y-auto pr-1">
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
              )
            ) : !diagnosticsLoading && projects?.length === 0 && invalidProjects.length === 0 ? (
              <EmptyState
                className="h-full"
                title="No projects yet"
                body={effectiveViewProfile === 'all'
                  ? 'No projects exist in any profile yet.'
                  : `Projects track ongoing work, milestones, and tasks for profile ${effectiveViewProfile ?? currentProfile ?? 'current'}.`}
                action={<ToolbarButton onClick={openCreateForm}>Create project</ToolbarButton>}
              />
            ) : (
              <EmptyState
                className="h-full"
                title="Select a project"
                body="Use the right rail to browse projects and open the selected project in the main workspace."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

