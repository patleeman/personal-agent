import { Link } from 'react-router-dom';
import { api } from '../api';
import { usePolling } from '../hooks';
import { kindMeta, timeAgo } from '../utils';

export function InboxPage() {
  const { data: activity, loading, error, refetch } = usePolling(api.activity, 15_000);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-base/95 backdrop-blur-sm border-b border-border-subtle px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-primary">Inbox</h1>
          {activity && (
            <p className="text-xs text-secondary mt-0.5 font-mono">
              {activity.length} {activity.length === 1 ? 'item' : 'items'}
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
            <span>Loading activity…</span>
          </div>
        )}
        {error && <div className="py-8 text-sm text-danger/80">Failed to load activity: {error}</div>}
        {!loading && !error && activity?.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-2xl mb-3">📭</p>
            <p className="text-sm text-primary">No activity yet.</p>
            <p className="text-xs text-secondary mt-1">Activity is created when scheduled tasks run or deferred resumes fire.</p>
          </div>
        )}

        {!loading && activity && activity.length > 0 && (
          <div className="space-y-px">
            {activity.map((entry) => {
              const meta = kindMeta(entry.kind);
              return (
                <Link
                  key={entry.id}
                  to={`/inbox/${entry.id}`}
                  className="flex items-start gap-4 px-4 py-3 -mx-2 rounded-lg hover:bg-surface transition-colors group"
                >
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-primary leading-snug">{entry.summary}</p>
                    <p className="text-[11px] text-dim mt-0.5 font-mono">
                      <span className={meta.color}>{meta.label}</span>
                      <span className="opacity-40 mx-1.5">·</span>
                      {timeAgo(entry.createdAt)}
                    </p>
                  </div>
                  <span className="text-dim group-hover:text-secondary transition-colors text-sm mt-0.5">→</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
