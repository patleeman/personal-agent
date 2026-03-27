import { useMemo } from 'react';
import { api } from '../api';
import {
  formatProjectStatus,
  hasMeaningfulBlockers,
  isProjectArchived,
  summarizeProjectPreview,
} from '../contextRailProject';
import { useApi } from '../hooks';
import type { ProjectRecord } from '../types';
import { timeAgo } from '../utils';
import { BrowserRecordRow } from '../components/ui';
import { buildCompanionProjectPath } from './routes';

function sortCompanionProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return [...projects].sort((left, right) => {
    const archivedOrder = Number(isProjectArchived(left)) - Number(isProjectArchived(right));
    if (archivedOrder !== 0) {
      return archivedOrder;
    }

    return right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title);
  });
}

function ProjectsSection({
  title,
  projects,
}: {
  title: string;
  projects: ProjectRecord[];
}) {
  if (projects.length === 0) {
    return null;
  }

  return (
    <section className="pt-5 first:pt-0">
      <h2 className="px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-dim/70">{title}</h2>
      <div className="mt-2 space-y-2 px-4">
        {projects.map((project) => {
          const archived = isProjectArchived(project);
          const preview = summarizeProjectPreview(project);
          const blockers = project.blockers.filter((blocker) => blocker.trim().length > 0);
          const meta = [
            formatProjectStatus(project.status),
            archived && project.archivedAt ? `archived ${timeAgo(project.archivedAt)}` : `updated ${timeAgo(project.updatedAt)}`,
            !archived && hasMeaningfulBlockers(project.blockers) && blockers[0] ? `blocked: ${blockers[0]}` : null,
            `@${project.id}`,
          ].filter((value): value is string => Boolean(value));

          return (
            <BrowserRecordRow
              key={project.id}
              to={buildCompanionProjectPath(project.id)}
              label={archived ? 'Archived project' : 'Project'}
              aside={formatProjectStatus(project.status)}
              heading={project.title}
              summary={preview}
              meta={meta.join(' · ')}
              className="py-3.5"
              titleClassName="text-[15px]"
              summaryClassName="text-[13px]"
              metaClassName="text-[11px] break-words"
            />
          );
        })}
      </div>
    </section>
  );
}

export function CompanionProjectsPage() {
  const { data, loading, error } = useApi(api.projects, 'companion-projects');
  const projects = useMemo(() => sortCompanionProjects(data ?? []), [data]);
  const activeProjects = useMemo(
    () => projects.filter((project) => !isProjectArchived(project)),
    [projects],
  );
  const archivedProjects = useMemo(
    () => projects.filter((project) => isProjectArchived(project)),
    [projects],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border-subtle bg-base/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <h1 className="text-[22px] font-semibold tracking-tight text-primary">Projects</h1>
          <p className="mt-1 text-[11px] text-dim">
            {projects.length === 0
              ? 'No projects yet.'
              : `${projects.length} projects · ${archivedProjects.length} archived`}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-4">
          {loading ? <p className="px-4 text-[13px] text-dim">Loading projects…</p> : null}
          {!loading && error ? <p className="px-4 text-[13px] text-danger">Unable to load projects: {error}</p> : null}
          {!loading && !error && projects.length === 0 ? (
            <div className="px-4 pt-5">
              <p className="text-[15px] text-primary">No projects yet.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                Create or sync a project in the main workspace and it will appear here automatically.
              </p>
            </div>
          ) : null}
          {!loading && !error && projects.length > 0 ? (
            <>
              <ProjectsSection title="Active" projects={activeProjects} />
              <ProjectsSection title="Archived" projects={archivedProjects} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
