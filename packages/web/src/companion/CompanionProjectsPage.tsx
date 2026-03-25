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
    <section className="pt-6 first:pt-0">
      <h2 className="px-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">{title}</h2>
      <div className="mt-3 border-y border-border-subtle">
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
            <div key={project.id} className="border-b border-border-subtle px-4 py-4 last:border-b-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[16px] font-medium leading-tight text-primary">{project.title}</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-secondary">{preview}</p>
                  <p className="mt-2 break-words text-[11px] text-dim">{meta.join(' · ')}</p>
                </div>
              </div>
            </div>
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
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">assistant companion</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-primary">Projects</h1>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-secondary">
            Read durable project state from the phone without leaving the companion surface.
          </p>
          <p className="mt-3 text-[12px] text-dim">
            {projects.length === 0
              ? 'No projects available.'
              : `${projects.length} project${projects.length === 1 ? '' : 's'} · ${archivedProjects.length} archived.`}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-6">
          {loading ? <p className="px-4 text-[13px] text-dim">Loading projects…</p> : null}
          {!loading && error ? <p className="px-4 text-[13px] text-danger">Unable to load projects: {error}</p> : null}
          {!loading && !error && projects.length === 0 ? (
            <div className="px-4 pt-6">
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
