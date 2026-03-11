import { useParams } from 'react-router-dom';
import { api } from '../api';
import { hasMeaningfulBlockers, normalizeProjectText, summarizeProjectPreview } from '../contextRailProject';
import { usePolling } from '../hooks';
import { timeAgo } from '../utils';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, Pill, ToolbarButton } from '../components/ui';

export function ProjectsPage() {
  const { id: selectedId } = useParams<{ id?: string }>();
  const { data: projects, loading, error, refetch } = usePolling(api.projects, 15_000);

  return (
    <div className="flex flex-col h-full">
      <PageHeader actions={<ToolbarButton onClick={refetch}>↻ Refresh</ToolbarButton>}>
        <PageHeading
          title="Projects"
          meta={
            projects && (
              <>
                {projects.length} {projects.length === 1 ? 'project' : 'projects'}
              </>
            )
          }
        />
      </PageHeader>

      <div className="flex-1 px-6 py-4">
        {loading && <LoadingState label="Loading projects…" />}
        {error && <ErrorState message={`Failed to load projects: ${error}`} />}
        {!loading && !error && projects?.length === 0 && (
          <EmptyState
            icon="🗂"
            title="No projects yet."
            body="Projects capture the durable summary, plan, and tasks for ongoing work."
          />
        )}

        {!loading && projects && projects.length > 0 && (
          <div className="space-y-px">
            {projects.map((project) => {
              const status = normalizeProjectText(project.status);
              const blockers = normalizeProjectText(project.blockers);
              const isBlocked = hasMeaningfulBlockers(project.blockers);
              const isSelected = project.id === selectedId;
              const preview = summarizeProjectPreview(project.currentPlan, project.blockers);
              const dotClass = isBlocked ? 'bg-warning' : 'bg-teal';

              return (
                <ListLinkRow
                  key={project.id}
                  to={`/projects/${project.id}`}
                  selected={isSelected}
                  leading={<span className={`mt-2 w-2 h-2 rounded-full shrink-0 ${dotClass}`} />}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <p className="ui-card-title">{project.objective}</p>
                      <Pill tone={isBlocked ? 'warning' : 'teal'}>{status}</Pill>
                    </div>
                    <p className="ui-row-summary">{preview}</p>
                    <div className="flex items-center gap-2 flex-wrap ui-card-meta">
                      <span>{timeAgo(project.updatedAt)}</span>
                      {isBlocked && (
                        <>
                          <span className="opacity-40">·</span>
                          <span className="text-warning">{blockers}</span>
                        </>
                      )}
                    </div>
                  </div>
                </ListLinkRow>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
