import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { formatProjectStatus, isProjectArchived, summarizeProjectPreview } from '../contextRailProject';
import { useApi } from '../hooks';
import { buildProjectsHref, readProjectView, VIEW_PROFILE_QUERY_PARAM } from '../projectWorkspaceState';
import { BrowserRecordRow, EmptyState, ErrorState, LoadingState, ToolbarButton } from './ui';
import { timeAgo } from '../utils';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

type ProjectFilter = 'active' | 'archived' | 'all';

function getSelectedProjectId(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'projects' && parts[1] ? decodeURIComponent(parts[1]) : null;
}

function formatRailStatusLabel(status: string | undefined): string {
  const label = formatProjectStatus(status);
  return label.replace(/\b\w/g, (match) => match.toUpperCase());
}

function summarizeRepoRoot(repoRoot: string | undefined): string | null {
  const normalized = repoRoot?.trim();
  if (!normalized) {
    return null;
  }

  const segments = normalized.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.at(-1) ?? normalized;
}

export function ProjectsBrowserRail() {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ProjectFilter>('active');
  const { data: profileState } = useApi(api.profiles);
  const selectedProjectId = useMemo(() => getSelectedProjectId(location.pathname), [location.pathname]);
  const selectedView = useMemo(() => readProjectView(location.search), [location.search]);
  const requestedViewProfile = useMemo(() => new URLSearchParams(location.search).get(VIEW_PROFILE_QUERY_PARAM)?.trim() || null, [location.search]);
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
  const { data, loading, error, refreshing, refetch } = useApi(
    () => api.projects(effectiveViewProfile ? { profile: effectiveViewProfile } : undefined),
    effectiveViewProfile ? `rail-projects:${effectiveViewProfile}` : 'rail-projects',
  );

  const filteredProjects = useMemo(() => {
    const items = data ?? [];
    const normalizedQuery = query.trim().toLowerCase();

    return items.filter((project) => {
      if (filter === 'active' && isProjectArchived(project)) {
        return false;
      }
      if (filter === 'archived' && !isProjectArchived(project)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }

      const haystack = [project.id, project.title, project.description, project.summary].join('\n').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [data, filter, query]);

  const selectedProject = (data ?? []).find((project) => project.id === selectedProjectId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-border-subtle px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-card-title">Projects</p>
            <p className="ui-card-meta mt-1">Browse projects and jump between project sections.</p>
          </div>
          <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻'}
          </ToolbarButton>
        </div>

        {profileState && (
          <select
            value={effectiveViewProfile ?? profileState.currentProfile}
            onChange={(event) => navigate(buildProjectsHref(event.target.value === 'all' ? 'all' : event.target.value, selectedProjectId ?? undefined, selectedView === 'document' ? null : selectedView))}
            className={INPUT_CLASS}
          >
            <option value="all">All profiles</option>
            {profileState.profiles.map((profile) => (
              <option key={profile} value={profile}>{profile}</option>
            ))}
          </select>
        )}

        <div className="ui-segmented-control" role="group" aria-label="Project filter">
          {(['active', 'archived', 'all'] as ProjectFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={filter === value ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
            >
              {value === 'active' ? 'Active' : value === 'archived' ? 'Archived' : 'All'}
            </button>
          ))}
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search projects"
          className={INPUT_CLASS}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading && !data ? <LoadingState label="Loading projects…" className="px-0 py-0" /> : null}
        {error && !data ? <ErrorState message={`Unable to load projects: ${error}`} className="px-0 py-0" /> : null}

        {!loading && !error && filteredProjects.length === 0 ? (
          <EmptyState
            className="py-8"
            title={(data ?? []).length === 0 ? 'No projects yet' : 'No matches'}
            body={(data ?? []).length === 0 ? 'Create a project to start tracking durable work.' : 'Try a broader search or another filter.'}
          />
        ) : null}

        {!loading && !error && filteredProjects.length > 0 && (
          <div className="space-y-1">
            {filteredProjects.map((project) => {
              const archived = isProjectArchived(project);
              const blockerCount = project.blockers.filter((blocker) => blocker.trim().length > 0).length;
              const repoLabel = summarizeRepoRoot(project.repoRoot);
              const milestoneCount = project.plan.milestones.length;
              const taskCount = project.plan.tasks.length;
              return (
                <BrowserRecordRow
                  key={`${project.profile ?? effectiveViewProfile ?? 'shared'}:${project.id}`}
                  to={buildProjectsHref(effectiveViewProfile ?? project.profile ?? 'shared', project.id)}
                  selected={project.id === selectedProjectId}
                  label={archived ? 'Archived project' : 'Project'}
                  aside={formatRailStatusLabel(project.status)}
                  heading={project.title}
                  summary={summarizeProjectPreview(project)}
                  meta={(
                    <>
                      <span className="font-mono" title={project.id}>{project.id}</span>
                      {effectiveViewProfile === 'all' && project.profile && (
                        <>
                          <span className="opacity-40">·</span>
                          <span>{project.profile}</span>
                        </>
                      )}
                      {repoLabel && (
                        <>
                          <span className="opacity-40">·</span>
                          <span>{repoLabel}</span>
                        </>
                      )}
                      {milestoneCount > 0 && (
                        <>
                          <span className="opacity-40">·</span>
                          <span>{milestoneCount} {milestoneCount === 1 ? 'milestone' : 'milestones'}</span>
                        </>
                      )}
                      {taskCount > 0 && (
                        <>
                          <span className="opacity-40">·</span>
                          <span>{taskCount} {taskCount === 1 ? 'task' : 'tasks'}</span>
                        </>
                      )}
                      {blockerCount > 0 && (
                        <>
                          <span className="opacity-40">·</span>
                          <span>{blockerCount} {blockerCount === 1 ? 'blocker' : 'blockers'}</span>
                        </>
                      )}
                      <span className="opacity-40">·</span>
                      <span>{timeAgo(project.updatedAt)}</span>
                    </>
                  )}
                />
              );
            })}
          </div>
        )}

        {selectedProject && (
          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Sections</p>
            <div className="space-y-1">
              {[
                ['document', 'Doc', 'Main project note and plan', 'Overview'],
                ['tasks', 'Tasks', 'Flat project todo list', 'Execution'],
                ['activity', 'Activity', 'Tiny recent log', 'History'],
                ['notes', 'Notes', 'Project notes, decisions, and questions', 'Knowledge'],
                ['files', 'Files', 'All attached project files', 'Artifacts'],
              ].map(([view, label, summary, meta]) => (
                <BrowserRecordRow
                  key={view}
                  to={buildProjectsHref(effectiveViewProfile ?? selectedProject.profile ?? 'shared', selectedProject.id, view === 'document' ? null : view)}
                  selected={selectedView === view}
                  label={meta}
                  heading={label}
                  summary={summary}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
