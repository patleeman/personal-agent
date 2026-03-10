import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { usePolling } from '../hooks';
import { kindMeta, timeAgo } from '../utils';
import type { ActivityEntry } from '../types';

function InboxItemDetail({ entry, onRead }: { entry: ActivityEntry; onRead: () => void }) {
  // Mark as read when detail opens
  useEffect(() => {
    if (!entry.read) {
      void api.markActivityRead(entry.id).then(onRead);
    }
  }, [entry.id, entry.read, onRead]);

  const meta = kindMeta(entry.kind);

  return (
    <div className="border-t border-border-subtle px-6 py-5 space-y-4">
      <div className="flex items-start gap-3">
        <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
        <div>
          <p className="text-[13px] font-medium text-primary leading-snug">{entry.summary}</p>
          <p className="text-[11px] text-dim mt-1 font-mono">
            <span className={meta.color}>{meta.label}</span>
            <span className="opacity-40 mx-1.5">·</span>
            {timeAgo(entry.createdAt)}
          </p>
        </div>
      </div>

      {entry.details && (
        <div className="bg-surface rounded-lg px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-dim mb-2">Details</p>
          <pre className="text-[12px] text-secondary font-mono whitespace-pre-wrap leading-relaxed">{entry.details}</pre>
        </div>
      )}

      {entry.relatedConversationIds && entry.relatedConversationIds.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-dim mb-2">Sessions</p>
          <div className="space-y-1">
            {entry.relatedConversationIds.map(cid => (
              <Link key={cid} to={`/conversations/${cid}`}
                className="block text-[12px] font-mono text-accent hover:underline truncate">
                {cid}
              </Link>
            ))}
          </div>
        </div>
      )}

      {entry.relatedWorkstreamIds && entry.relatedWorkstreamIds.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-dim mb-2">Workstreams</p>
          <div className="space-y-1">
            {entry.relatedWorkstreamIds.map(wsId => (
              <Link key={wsId} to={`/workstreams/${wsId}`}
                className="block text-[12px] font-mono text-accent hover:underline truncate">
                {wsId}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function InboxPage() {
  const { id: selectedId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { data: activity, loading, error, refetch } = usePolling(api.activity, 15_000);

  const selected = activity?.find(e => e.id === selectedId);
  const unreadCount = activity?.filter(e => !e.read).length ?? 0;

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-base/95 backdrop-blur-sm border-b border-border-subtle px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-primary">Inbox</h1>
          {activity && (
            <p className="text-xs text-secondary mt-0.5 font-mono">
              {activity.length} {activity.length === 1 ? 'item' : 'items'}
              {unreadCount > 0 && <span className="ml-2 text-accent font-semibold">· {unreadCount} unread</span>}
            </p>
          )}
        </div>
        <button onClick={refetch} className="text-xs text-secondary hover:text-primary transition-colors px-2 py-1 rounded hover:bg-surface">
          ↻ Refresh
        </button>
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

      {!loading && activity && activity.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-px">
            {activity.map((entry) => {
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

          {/* Inline detail panel */}
          {selected && (
            <InboxItemDetail
              entry={selected}
              onRead={refetch}
            />
          )}
        </div>
      )}
    </div>
  );
}
