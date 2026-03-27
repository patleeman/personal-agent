import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { formatProjectStatus, isProjectArchived, summarizeProjectPreview } from '../contextRailProject';
import { useApi } from '../hooks';
import { buildProjectsHref, readProjectView, VIEW_PROFILE_QUERY_PARAM } from '../projectWorkspaceState';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, ToolbarButton } from './ui';
import { timeAgo } from '../utils';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

type ProjectFilter = 'active' | 'archived' | 'all';

function getSelectedProjectId(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'projects' && parts[1] ? decodeURIComponent(parts[1]) : null;
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
          <div className="space-y-px">
            {filteredProjects.map((project) => {
              const archived = isProjectArchived(project);
              const dotClass = archived ? 'bg-border-default' : 'bg-teal';
              return (
                <ListLinkRow
                  key={`${project.profile ?? effectiveViewProfile ?? 'shared'}:${project.id}`}
                  to={buildProjectsHref(effectiveViewProfile ?? project.profile ?? 'shared', project.id)}
                  selected={project.id === selectedProjectId}
                  leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass}`} />}
                >
                  <p className="ui-row-title">{project.title}</p>
                  <p className="ui-row-summary">{summarizeProjectPreview(project)}</p>
                  <div className="ui-row-meta flex flex-wrap items-center gap-1.5">
                    <span>{formatProjectStatus(project.status)}</span>
                    <span className="opacity-40">·</span>
                    <span className="font-mono" title={project.id}>{project.id}</span>
                    <span className="opacity-40">·</span>
                    <span>{timeAgo(project.updatedAt)}</span>
                  </div>
                </ListLinkRow>
              );
            })}
          </div>
        )}

        {selectedProject && (
          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Sections</p>
            <div className="space-y-px">
              {[
                ['document', 'Doc', 'Main project note and plan'],
                ['tasks', 'Tasks', 'Flat project todo list'],
                ['activity', 'Activity', 'Tiny recent log'],
                ['notes', 'Notes', 'Project notes, decisions, and questions'],
                ['files', 'Files', 'All attached project files'],
              ].map(([view, label, summary]) => (
                <ListLinkRow
                  key={view}
                  to={buildProjectsHref(effectiveViewProfile ?? selectedProject.profile ?? 'shared', selectedProject.id, view === 'document' ? null : view)}
                  selected={selectedView === view}
                >
                  <p className="ui-row-title">{label}</p>
                  <p className="ui-row-summary">{summary}</p>
                </ListLinkRow>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
