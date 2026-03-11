import { useParams } from 'react-router-dom';
import { api } from '../api';
import { hasMeaningfulBlockers, normalizeWorkstreamText, summarizeWorkstreamPreview } from '../contextRailWorkstream';
import { usePolling } from '../hooks';
import { timeAgo } from '../utils';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, Pill, ToolbarButton } from '../components/ui';

export function WorkstreamsPage() {
  const { id: selectedId } = useParams<{ id?: string }>();
  const { data: workstreams, loading, error, refetch } = usePolling(api.workstreams, 15_000);

  return (
    <div className="flex flex-col h-full">
      <PageHeader actions={<ToolbarButton onClick={refetch}>↻ Refresh</ToolbarButton>}>
        <PageHeading
          title="Workstreams"
          meta={
            workstreams && (
              <>
                {workstreams.length} {workstreams.length === 1 ? 'workstream' : 'workstreams'}
              </>
            )
          }
        />
      </PageHeader>

      <div className="flex-1 px-6 py-4">
        {loading && <LoadingState label="Loading workstreams…" />}
        {error && <ErrorState message={`Failed to load workstreams: ${error}`} />}
        {!loading && !error && workstreams?.length === 0 && (
          <EmptyState
            icon="🗂"
            title="No workstreams yet."
            body="Workstreams group related artifacts, tasks, and activity."
          />
        )}

        {!loading && workstreams && workstreams.length > 0 && (
          <div className="space-y-px">
            {workstreams.map((workstream) => {
              const status = normalizeWorkstreamText(workstream.status);
              const blockers = normalizeWorkstreamText(workstream.blockers);
              const isBlocked = hasMeaningfulBlockers(workstream.blockers);
              const isSelected = workstream.id === selectedId;
              const preview = summarizeWorkstreamPreview(workstream.currentPlan, workstream.blockers);
              const dotClass = isBlocked ? 'bg-warning' : 'bg-teal';

              return (
                <ListLinkRow
                  key={workstream.id}
                  to={`/workstreams/${workstream.id}`}
                  selected={isSelected}
                  leading={<span className={`mt-2 w-2 h-2 rounded-full shrink-0 ${dotClass}`} />}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <p className="ui-card-title">{workstream.objective}</p>
                      <Pill tone={isBlocked ? 'warning' : 'teal'}>{status}</Pill>
                    </div>
                    <p className="ui-row-summary">{preview}</p>
                    <div className="flex items-center gap-2 flex-wrap ui-card-meta">
                      <span>{timeAgo(workstream.updatedAt)}</span>
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
