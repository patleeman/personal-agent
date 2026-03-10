import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { usePolling } from '../hooks';
import { kindMeta, timeAgo } from '../utils';


export function InboxPage() {
  const { id: selectedId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { data: activity, loading, error, refetch } = usePolling(api.activity, 15_000);
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');
  const [markingAll, setMarkingAll] = useState(false);

  const unreadCount = activity?.filter(e => !e.read).length ?? 0;
  const visible = activity
    ? (filter === 'unread' ? activity.filter(e => !e.read) : activity)
    : [];

  // Switch to 'all' automatically if unread list becomes empty after marking
  useEffect(() => {
    if (filter === 'unread' && activity && unreadCount === 0 && activity.length > 0) {
      setFilter('all');
    }
  }, [filter, activity, unreadCount]);

  const markAllRead = useCallback(async () => {
    if (!activity) return;
    const unread = activity.filter(e => !e.read);
    if (unread.length === 0) return;
    setMarkingAll(true);
    try {
      await Promise.all(unread.map(e => api.markActivityRead(e.id)));
      await refetch();
    } finally {
      setMarkingAll(false);
    }
  }, [activity, refetch]);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-base/95 backdrop-blur-sm border-b border-border-subtle px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <h1 className="text-base font-semibold text-primary shrink-0">Inbox</h1>
          {/* Unread / All toggle */}
          {activity && (
            <div className="flex items-center gap-px bg-elevated rounded-lg p-0.5">
              <button
                onClick={() => setFilter('unread')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  filter === 'unread' ? 'bg-surface text-primary shadow-sm' : 'text-dim hover:text-secondary'
                }`}
              >
                Unread{unreadCount > 0 && <span className="ml-1 text-accent">{unreadCount}</span>}
              </button>
              <button
                onClick={() => setFilter('all')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  filter === 'all' ? 'bg-surface text-primary shadow-sm' : 'text-dim hover:text-secondary'
                }`}
              >
                All{activity.length > 0 && <span className="ml-1 opacity-50">{activity.length}</span>}
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={markingAll}
              className="text-[11px] text-dim hover:text-secondary transition-colors px-2 py-1 rounded hover:bg-surface disabled:opacity-40"
            >
              {markingAll ? 'Marking…' : 'Mark all read'}
            </button>
          )}
          <button onClick={refetch} className="text-xs text-secondary hover:text-primary transition-colors px-2 py-1 rounded hover:bg-surface">
            ↻
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-dim px-6 py-8">
          <span className="animate-pulse">●</span>
          <span>Loading activity…</span>
        </div>
      )}
      {error && <div className="px-6 py-8 text-sm text-danger/80">Failed to load activity: {error}</div>}
      {!loading && !error && activity?.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-2xl mb-3">📭</p>
          <p className="text-sm text-primary">No activity yet.</p>
          <p className="text-xs text-secondary mt-1">Activity is created when scheduled tasks run or deferred resumes fire.</p>
        </div>
      )}

      {!loading && activity && activity.length > 0 && filter === 'unread' && unreadCount === 0 && (
        <div className="py-16 text-center">
          <p className="text-2xl mb-3">✓</p>
          <p className="text-sm text-primary">All caught up.</p>
          <button onClick={() => setFilter('all')} className="text-xs text-accent hover:underline mt-1">
            View all {activity.length} notifications →
          </button>
        </div>
      )}

      {!loading && activity && visible.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-px">
            {visible.map((entry) => {
              const meta = kindMeta(entry.kind);
              const isSelected = entry.id === selectedId;
              return (
                <Link
                  key={entry.id}
                  to={`/inbox/${entry.id}`}
                  className={`flex items-start gap-4 px-4 py-3 -mx-2 rounded-lg transition-colors group ${
                    isSelected ? 'bg-surface' : 'hover:bg-surface'
                  }`}
                >
                  {/* Unread dot: solid if unread, hollow ring if read */}
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 transition-all ${
                    entry.read ? 'border border-border-default bg-transparent' : meta.dot
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] leading-snug ${entry.read ? 'text-secondary' : 'text-primary'}`}>
                      {entry.summary}
                    </p>
                    <p className="text-[11px] text-dim mt-0.5 font-mono">
                      <span className={meta.color}>{meta.label}</span>
                      <span className="opacity-40 mx-1.5">·</span>
                      {timeAgo(entry.createdAt)}
                    </p>
                  </div>
                  {!entry.read && (
                    <span className="shrink-0 self-center w-1.5 h-1.5 rounded-full bg-accent" />
                  )}
                </Link>
              );
            })}
          </div>


        </div>
      )}
    </div>
  );
}
