import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useAppData, useSseConnection } from '../contexts';
import { useConversations } from '../hooks/useConversations';
import { sessionNeedsAttention } from '../sessionIndicators';
import { kindMeta, timeAgo } from '../utils';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, ToolbarButton } from '../components/ui';
import type { ActivityEntry, SessionMeta } from '../types';

type InboxSurfaceItem =
  | {
      type: 'activity';
      key: string;
      sortAt: string;
      read: boolean;
      entry: ActivityEntry;
    }
  | {
      type: 'conversation';
      key: string;
      sortAt: string;
      read: false;
      session: SessionMeta;
    };

function buildConversationReason(session: SessionMeta): string {
  const parts: string[] = [];

  if ((session.attentionUnreadActivityCount ?? 0) > 0) {
    const count = session.attentionUnreadActivityCount ?? 0;
    parts.push(`${count} linked update${count === 1 ? '' : 's'}`);
  }

  if ((session.attentionUnreadMessageCount ?? 0) > 0) {
    const count = session.attentionUnreadMessageCount ?? 0;
    parts.push(`${count} new message${count === 1 ? '' : 's'}`);
  }

  return parts.join(' · ') || 'needs attention';
}

export function InboxPage() {
  const { id: selectedId } = useParams<{ id?: string }>();
  const { activity, setActivity } = useAppData();
  const { status: sseStatus } = useSseConnection();
  const { tabs, archivedSessions, openSession, loading: conversationsLoading, refetch: refetchSessions } = useConversations();
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');
  const [markingAll, setMarkingAll] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const standaloneActivities = useMemo(() => {
    const knownConversationIds = new Set([...tabs, ...archivedSessions].map((session) => session.id));
    return (activity?.entries ?? []).filter((entry) => {
      return !(entry.relatedConversationIds ?? []).some((conversationId) => knownConversationIds.has(conversationId));
    });
  }, [activity?.entries, archivedSessions, tabs]);

  const attentionConversations = useMemo(
    () => archivedSessions.filter((session) => sessionNeedsAttention(session)),
    [archivedSessions],
  );

  const allItems = useMemo<InboxSurfaceItem[]>(() => {
    const activityItems: InboxSurfaceItem[] = standaloneActivities.map((entry) => ({
      type: 'activity',
      key: `activity:${entry.id}`,
      sortAt: entry.createdAt,
      read: Boolean(entry.read),
      entry,
    }));

    const conversationItems: InboxSurfaceItem[] = attentionConversations.map((session) => ({
      type: 'conversation',
      key: `conversation:${session.id}`,
      sortAt: session.attentionUpdatedAt ?? session.lastActivityAt ?? session.timestamp,
      read: false,
      session,
    }));

    return [...conversationItems, ...activityItems]
      .sort((left, right) => right.sortAt.localeCompare(left.sortAt));
  }, [attentionConversations, standaloneActivities]);

  const unreadCount = useMemo(
    () => attentionConversations.length + standaloneActivities.filter((entry) => !entry.read).length,
    [attentionConversations.length, standaloneActivities],
  );
  const visible = useMemo(
    () => filter === 'unread' ? allItems.filter((item) => !item.read) : allItems,
    [allItems, filter],
  );
  const isLoading = (activity === null || conversationsLoading) && (sseStatus === 'connecting' || sseStatus === 'reconnecting');
  const visibleError = activity === null && sseStatus === 'offline'
    ? refreshError ?? 'Live updates are offline. Use refresh to load the latest inbox state.'
    : refreshError;

  const refreshInbox = useCallback(async () => {
    try {
      const [nextActivity] = await Promise.all([
        api.activity(),
        refetchSessions(),
      ]);
      setActivity({
        entries: nextActivity,
        unreadCount: nextActivity.filter((entry) => !entry.read).length,
      });
      setRefreshError(null);
      return nextActivity;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRefreshError(message);
      return null;
    }
  }, [refetchSessions, setActivity]);

  const markAllRead = useCallback(async () => {
    if (allItems.length === 0) return;

    const unreadActivities = standaloneActivities.filter((entry) => !entry.read);
    const unreadConversations = attentionConversations;

    if (unreadActivities.length === 0 && unreadConversations.length === 0) {
      return;
    }

    setMarkingAll(true);
    try {
      await Promise.all([
        ...unreadActivities.map((entry) => api.markActivityRead(entry.id)),
        ...unreadConversations.map((session) => api.markConversationAttentionRead(session.id)),
      ]);
      await refreshInbox();
    } finally {
      setMarkingAll(false);
    }
  }, [allItems.length, attentionConversations, refreshInbox, standaloneActivities]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        actions={(
          <>
            {(activity || archivedSessions.length > 0) && (
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
                  All{allItems.length > 0 && <span className="ml-1 opacity-50">{allItems.length}</span>}
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
            <ToolbarButton onClick={() => { void refreshInbox(); }}>↻ Refresh</ToolbarButton>
          </>
        )}
      >
        <PageHeading
          title="Inbox"
          meta={(
            <>
              {unreadCount} unread
              {' · '}
              {allItems.length} {allItems.length === 1 ? 'item' : 'items'}
            </>
          )}
        />
      </PageHeader>

      {isLoading && <LoadingState label="Loading inbox…" className="px-6" />}
      {visibleError && <ErrorState message={`Failed to load inbox: ${visibleError}`} className="px-6" />}

      {!isLoading && !visibleError && allItems.length === 0 && (
        <EmptyState
          title="No inbox items yet."
          body="Standalone background activity and archived conversations that need attention appear here."
        />
      )}

      {!isLoading && allItems.length > 0 && filter === 'unread' && unreadCount === 0 && (
        <EmptyState
          title="All caught up."
          action={(
            <button onClick={() => setFilter('all')} className="text-xs text-accent hover:underline">
              View all {allItems.length} items →
            </button>
          )}
        />
      )}

      {!isLoading && visible.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-px">
            {visible.map((item) => {
              if (item.type === 'conversation') {
                const reason = buildConversationReason(item.session);
                const sortAt = item.session.attentionUpdatedAt ?? item.session.lastActivityAt ?? item.session.timestamp;

                return (
                  <ListLinkRow
                    key={item.key}
                    to={`/conversations/${item.session.id}`}
                    onClick={() => openSession(item.session.id)}
                    leading={<span className="mt-1.5 w-2 h-2 rounded-full shrink-0 transition-all bg-warning" />}
                  >
                    <p className="ui-row-title">{item.session.title}</p>
                    <p className="ui-row-meta">
                      <span className="text-warning bg-warning/10">conversation</span>
                      <span className="opacity-40 mx-1.5">·</span>
                      {reason}
                      <span className="opacity-40 mx-1.5">·</span>
                      {timeAgo(sortAt)}
                    </p>
                  </ListLinkRow>
                );
              }

              const meta = kindMeta(item.entry.kind);
              const isSelected = item.entry.id === selectedId;
              const titleClass = item.entry.read ? 'ui-row-title text-secondary' : 'ui-row-title';
              const leadingClass = item.entry.read
                ? 'mt-1.5 w-2 h-2 rounded-full shrink-0 transition-all border border-border-default bg-transparent'
                : `mt-1.5 w-2 h-2 rounded-full shrink-0 transition-all ${meta.dot}`;

              return (
                <ListLinkRow
                  key={item.key}
                  to={`/inbox/${item.entry.id}`}
                  selected={isSelected}
                  leading={<span className={leadingClass} />}
                  trailing={!item.entry.read && <span className="shrink-0 self-center w-1.5 h-1.5 rounded-full bg-accent" />}
                >
                  <p className={titleClass}>{item.entry.summary}</p>
                  <p className="ui-row-meta">
                    <span className={meta.color}>{meta.label}</span>
                    <span className="opacity-40 mx-1.5">·</span>
                    {timeAgo(item.entry.createdAt)}
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
