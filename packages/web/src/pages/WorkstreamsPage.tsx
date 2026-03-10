import { Link } from 'react-router-dom';
import { api } from '../api';
import { usePolling } from '../hooks';
import { stripMarkdownListMarker, timeAgo } from '../utils';

export function WorkstreamsPage() {
  const { data: workstreams, loading, error, refetch } = usePolling(api.workstreams, 15_000);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-base/95 backdrop-blur-sm border-b border-border-subtle px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-primary">Workstreams</h1>
          {workstreams && (
            <p className="text-xs text-secondary mt-0.5 font-mono">
              {workstreams.length} {workstreams.length === 1 ? 'workstream' : 'workstreams'}
            </p>
          )}
        </div>
        <button
          onClick={refetch}
          className="text-xs text-secondary hover:text-primary transition-colors px-2 py-1 rounded hover:bg-surface"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-dim py-8">
            <span className="animate-pulse">●</span>
            <span>Loading workstreams…</span>
          </div>
        )}

        {error && (
          <div className="py-8 text-sm text-danger/80">
            Failed to load workstreams: {error}
          </div>
        )}

        {!loading && !error && workstreams?.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-2xl mb-3">🗂</p>
            <p className="text-sm text-primary">No workstreams yet.</p>
            <p className="text-xs text-secondary mt-1">
              Workstreams group related artifacts, tasks, and activity.
            </p>
          </div>
        )}

        {!loading && workstreams && workstreams.length > 0 && (
          <div className="grid grid-cols-1 gap-3">
            {workstreams.map((ws) => {
              const status = stripMarkdownListMarker(ws.status);
              const blockers = stripMarkdownListMarker(ws.blockers);
              const isBlocked = blockers !== 'None';

              return (
                <Link
                  key={ws.id}
                  to={`/workstreams/${ws.id}`}
                  className="block p-4 rounded-xl bg-surface border border-border-subtle hover:border-border-default hover:bg-elevated transition-all group"
                >
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <span className="text-xs font-mono text-dim">{ws.id}</span>
                    <span className="text-2xs text-dim shrink-0">{timeAgo(ws.updatedAt)}</span>
                  </div>

                  <p className="text-sm font-medium text-primary group-hover:text-white leading-snug mb-3">
                    {ws.objective}
                  </p>

                  <div className="flex items-center gap-3">
                    <span className="text-xs text-secondary">{status}</span>
                    {isBlocked && (
                      <span className="text-xs text-warning">⚠ {blockers}</span>
                    )}
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
