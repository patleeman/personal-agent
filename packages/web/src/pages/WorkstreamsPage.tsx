import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { usePolling } from '../hooks';
import { stripMarkdownListMarker, timeAgo } from '../utils';

export function WorkstreamsPage() {
  const { id: selectedId } = useParams<{ id?: string }>();
  const { data: workstreams, loading, error, refetch } = usePolling(api.workstreams, 15_000);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-base/95 backdrop-blur-sm border-b border-border-subtle px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-primary">Workstreams</h1>
          {workstreams && (
            <p className="text-xs text-secondary mt-0.5 font-mono">
              {workstreams.length} {workstreams.length === 1 ? 'workstream' : 'workstreams'}
            </p>
          )}
        </div>
        <button onClick={refetch} className="text-xs text-secondary hover:text-primary transition-colors px-2 py-1 rounded hover:bg-surface">
          ↻ Refresh
        </button>
      </div>

      <div className="flex-1 px-6 py-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-dim py-8">
            <span className="animate-pulse">●</span>
            <span>Loading workstreams…</span>
          </div>
        )}
        {error && <div className="py-8 text-sm text-danger/80">Failed to load workstreams: {error}</div>}
        {!loading && !error && workstreams?.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-2xl mb-3">🗂</p>
            <p className="text-sm text-primary">No workstreams yet.</p>
            <p className="text-xs text-secondary mt-1">Workstreams group related artifacts, tasks, and activity.</p>
          </div>
        )}

        {!loading && workstreams && workstreams.length > 0 && (
          <div className="space-y-px">
            {workstreams.map((ws) => {
              const status = stripMarkdownListMarker(ws.status);
              const blockers = stripMarkdownListMarker(ws.blockers);
              const isBlocked = blockers !== 'None';
              const isSelected = ws.id === selectedId;

              return (
                <Link
                  key={ws.id}
                  to={`/workstreams/${ws.id}`}
                  className={`flex items-start gap-4 px-4 py-3 -mx-2 rounded-lg transition-colors group ${
                    isSelected ? 'bg-surface' : 'hover:bg-surface'
                  }`}
                >
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${isBlocked ? 'bg-warning' : 'bg-teal'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-primary leading-snug">{ws.objective}</p>
                    <p className="text-[11px] text-dim mt-0.5 font-mono flex items-center gap-1.5 flex-wrap">
                      <span className="text-secondary">{status}</span>
                      {isBlocked && (
                        <>
                          <span className="opacity-40">·</span>
                          <span className="text-warning">⚠ {blockers}</span>
                        </>
                      )}
                      <span className="opacity-40">·</span>
                      <span>{timeAgo(ws.updatedAt)}</span>
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
