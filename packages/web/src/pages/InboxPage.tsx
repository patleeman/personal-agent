import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useAppData, useSseConnection } from '../contexts';
import { kindMeta, timeAgo } from '../utils';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, ToolbarButton } from '../components/ui';

export function InboxPage() {
  const { id: selectedId } = useParams<{ id?: string }>();
  const { activity, setActivity } = useAppData();
  const { status: sseStatus } = useSseConnection();
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');
  const [markingAll, setMarkingAll] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const unreadCount = activity?.unreadCount ?? 0;
  const entries = activity?.entries ?? [];
  const visible = filter === 'unread' ? entries.filter((entry) => !entry.read) : entries;
  const isLoading = activity === null && (sseStatus === 'connecting' || sseStatus === 'reconnecting');
  const visibleError = activity === null && sseStatus === 'offline'
    ? refreshError ?? 'Live updates are offline. Use refresh to load the latest activity.'
    : refreshError;

  const refreshActivity = useCallback(async () => {
    try {
      const next = await api.activity();
      setActivity({
        entries: next,
        unreadCount: next.filter((entry) => !entry.read).length,
      });
      setRefreshError(null);
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRefreshError(message);
      return null;
    }
  }, [setActivity]);

  const markAllRead = useCallback(async () => {
    if (entries.length === 0) return;

    const unread = entries.filter((entry) => !entry.read);
    if (unread.length === 0) return;

    setMarkingAll(true);
    try {
      await Promise.all(unread.map((entry) => api.markActivityRead(entry.id)));
      await refreshActivity();
    } finally {
      setMarkingAll(false);
    }
  }, [entries, refreshActivity]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        actions={(
          <>
            {activity && (
              <div className="ui-segmented-control">
                <button
                  onClick={() => setFilter('unread')}
                  className={filter === 'unread' ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
                >
                  Unread{unreadCount > 0 && <span className="ml-1 text-accent">{unreadCount}</span>}
                </button>
                <button
                  onClick={() => setFilter('all')}
                  className={filter === 'all' ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
                >
                  All{entries.length > 0 && <span className="ml-1 opacity-50">{entries.length}</span>}
                </button>
              </div>
            )}
            {unreadCount > 0 && (
              <ToolbarButton
                onClick={markAllRead}
                disabled={markingAll}
                className="text-[11px]"
              >
                {markingAll ? 'Marking…' : 'Mark all read'}
              </ToolbarButton>
            )}
            <ToolbarButton onClick={() => { void refreshActivity(); }}>↻ Refresh</ToolbarButton>
          </>
        )}
      >
        <PageHeading
          title="Inbox"
          meta={activity && (
            <>
              {unreadCount} unread
              {' · '}
              {entries.length} {entries.length === 1 ? 'item' : 'items'}
            </>
          )}
        />
      </PageHeader>

      {isLoading && <LoadingState label="Loading activity…" className="px-6" />}
      {visibleError && <ErrorState message={`Failed to load activity: ${visibleError}`} className="px-6" />}

      {!isLoading && !visibleError && entries.length === 0 && (
        <EmptyState
          title="No activity yet."
          body="Activity appears here when scheduled tasks run or deferred resumes fire."
        />
      )}

      {!isLoading && entries.length > 0 && filter === 'unread' && unreadCount === 0 && (
        <EmptyState
          title="All caught up."
          action={(
            <button onClick={() => setFilter('all')} className="text-xs text-accent hover:underline">
              View all {entries.length} items →
            </button>
          )}
        />
      )}

      {!isLoading && visible.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-px">
            {visible.map((entry) => {
              const meta = kindMeta(entry.kind);
              const isSelected = entry.id === selectedId;
              const titleClass = entry.read ? 'ui-row-title text-secondary' : 'ui-row-title';
              const leadingClass = entry.read
                ? 'mt-1.5 w-2 h-2 rounded-full shrink-0 transition-all border border-border-default bg-transparent'
                : `mt-1.5 w-2 h-2 rounded-full shrink-0 transition-all ${meta.dot}`;

              return (
                <ListLinkRow
                  key={entry.id}
                  to={`/inbox/${entry.id}`}
                  selected={isSelected}
                  leading={<span className={leadingClass} />}
                  trailing={!entry.read && <span className="shrink-0 self-center w-1.5 h-1.5 rounded-full bg-accent" />}
                >
                  <p className={titleClass}>{entry.summary}</p>
                  <p className="ui-row-meta">
                    <span className={meta.color}>{meta.label}</span>
                    <span className="opacity-40 mx-1.5">·</span>
                    {timeAgo(entry.createdAt)}
                  </p>
                </ListLinkRow>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
