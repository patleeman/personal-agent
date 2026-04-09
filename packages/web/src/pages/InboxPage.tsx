import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAppData, useSseConnection } from '../contexts';
import { useConversations } from '../hooks/useConversations';
import { sessionNeedsAttention } from '../sessionIndicators';
import { kindMeta, timeAgo } from '../utils';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, ToolbarButton, cx } from '../components/ui';
import type { ActivityEntry, AlertEntry, SessionMeta } from '../types';

type InboxSurfaceItem =
  | {
      type: 'alert';
      key: string;
      sortAt: string;
      read: false;
      entry: AlertEntry;
    }
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

function pickActivityConversationId(entry: Pick<ActivityEntry, 'relatedConversationIds'>): string | null {
  const relatedConversationIds = (entry.relatedConversationIds ?? [])
    .filter((conversationId): conversationId is string => typeof conversationId === 'string' && conversationId.trim().length > 0);

  return relatedConversationIds.length > 0
    ? relatedConversationIds[relatedConversationIds.length - 1] ?? null
    : null;
}

function alertMeta(entry: AlertEntry): { label: string; color: string; dot: string } {
  if (entry.kind === 'approval-needed') {
    return {
      label: 'approval',
      color: 'text-warning',
      dot: 'bg-warning',
    };
  }

  if (entry.kind === 'reminder') {
    return {
      label: 'reminder',
      color: 'text-warning',
      dot: 'bg-warning',
    };
  }

  if (entry.kind === 'task-failed') {
    return {
      label: 'failed',
      color: 'text-danger',
      dot: 'bg-danger',
    };
  }

  if (entry.kind === 'blocked') {
    return {
      label: 'blocked',
      color: 'text-danger',
      dot: 'bg-danger',
    };
  }

  if (entry.kind === 'task-callback') {
    return {
      label: 'callback',
      color: 'text-accent',
      dot: 'bg-accent',
    };
  }

  return {
    label: entry.kind.replace(/-/g, ' '),
    color: 'text-accent',
    dot: 'bg-accent',
  };
}

export function InboxPage() {
  const navigate = useNavigate();
  const { id: selectedId } = useParams<{ id?: string }>();
  const { activity, setActivity, setAlerts = () => {} } = useAppData();
  const { status: sseStatus } = useSseConnection();
  const { tabs, archivedSessions, archivedConversationIds = [], openSession, loading: conversationsLoading, refetch: refetchSessions } = useConversations();
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');
  const [markingAll, setMarkingAll] = useState(false);
  const [clearingInbox, setClearingInbox] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [startingActivityId, setStartingActivityId] = useState<string | null>(null);
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);

  const activeAlerts = useMemo<AlertEntry[]>(() => [], []);
  const activeAlertConversationIds = useMemo(
    () => new Set(activeAlerts
      .map((entry) => entry.conversationId)
      .filter((conversationId): conversationId is string => typeof conversationId === 'string' && conversationId.trim().length > 0)),
    [activeAlerts],
  );
  const activeAlertActivityIds = useMemo(
    () => new Set(activeAlerts
      .map((entry) => entry.activityId)
      .filter((activityId): activityId is string => typeof activityId === 'string' && activityId.trim().length > 0)),
    [activeAlerts],
  );
  const standaloneActivities = useMemo(() => {
    const knownConversationIds = new Set([...tabs, ...archivedSessions].map((session) => session.id));
    return (activity?.entries ?? []).filter((entry) => {
      if (activeAlertActivityIds.has(entry.id)) {
        return false;
      }

      return !(entry.relatedConversationIds ?? []).some((conversationId) => knownConversationIds.has(conversationId));
    });
  }, [activity?.entries, activeAlertActivityIds, archivedSessions, tabs]);

  const archivedConversationIdSet = useMemo(
    () => new Set(archivedConversationIds),
    [archivedConversationIds],
  );
  const attentionConversations = useMemo(
    () => archivedSessions.filter((session) => (
      sessionNeedsAttention(session)
      && !archivedConversationIdSet.has(session.id)
      && !activeAlertConversationIds.has(session.id)
    )),
    [activeAlertConversationIds, archivedConversationIdSet, archivedSessions],
  );

  const allItems = useMemo<InboxSurfaceItem[]>(() => {
    const alertItems: InboxSurfaceItem[] = activeAlerts.map((entry) => ({
      type: 'alert',
      key: `alert:${entry.id}`,
      sortAt: entry.updatedAt,
      read: false,
      entry,
    }));

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

    return [...alertItems, ...conversationItems, ...activityItems]
      .sort((left, right) => right.sortAt.localeCompare(left.sortAt));
  }, [activeAlerts, attentionConversations, standaloneActivities]);

  const unreadCount = useMemo(
    () => activeAlerts.length + attentionConversations.length + standaloneActivities.filter((entry) => !entry.read).length,
    [activeAlerts.length, attentionConversations.length, standaloneActivities],
  );
  const notificationCount = allItems.length;
  const visible = useMemo(
    () => filter === 'unread' ? allItems.filter((item) => !item.read) : allItems,
    [allItems, filter],
  );
  const isLoading = (activity === null || conversationsLoading) && (sseStatus === 'connecting' || sseStatus === 'reconnecting');
  const visibleError = activity === null && sseStatus === 'offline'
    ? refreshError ?? 'Live updates are offline. Use refresh to load the latest notifications.'
    : refreshError;

  const refreshInbox = useCallback(async () => {
    try {
      const [nextActivity, nextAlerts] = await Promise.all([
        api.activity(),
        api.alerts(),
        refetchSessions(),
      ]);
      setActivity({
        entries: nextActivity,
        unreadCount: nextActivity.filter((entry) => !entry.read).length,
      });
      setAlerts(nextAlerts);
      setRefreshError(null);
      return nextActivity;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRefreshError(message);
      return null;
    }
  }, [refetchSessions, setActivity, setAlerts]);

  const markAllRead = useCallback(async () => {
    if (allItems.length === 0) return;

    const unreadActivities = standaloneActivities.filter((entry) => !entry.read);
    const unreadConversations = attentionConversations;
    const unreadAlerts = activeAlerts;

    if (unreadActivities.length === 0 && unreadConversations.length === 0 && unreadAlerts.length === 0) {
      return;
    }

    setMarkingAll(true);
    try {
      await Promise.all([
        ...unreadActivities.map((entry) => api.markActivityRead(entry.id)),
        ...unreadConversations.map((session) => api.markConversationAttentionRead(session.id)),
        ...unreadAlerts.map((entry) => api.acknowledgeAlert(entry.id)),
      ]);
      await refreshInbox();
    } finally {
      setMarkingAll(false);
    }
  }, [activeAlerts, allItems.length, attentionConversations, refreshInbox, standaloneActivities]);

  const clearInbox = useCallback(async () => {
    if (allItems.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      activeAlerts.length > 0
        ? 'Clear notifications? This deletes standalone activity items, marks archived conversations as read, and dismisses active reminder notifications.'
        : 'Clear notifications? This deletes standalone activity items and marks archived conversations as read.',
    );
    if (!confirmed) {
      return;
    }

    setActionError(null);
    setClearingInbox(true);
    try {
      await Promise.all([
        api.clearInbox(),
        ...activeAlerts.map((entry) => api.dismissAlert(entry.id)),
      ]);
      await refreshInbox();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setClearingInbox(false);
    }
  }, [activeAlerts, allItems.length, refreshInbox]);

  const acknowledgeAlert = useCallback(async (id: string) => {
    if (busyAlertId) {
      return;
    }

    setBusyAlertId(id);
    setActionError(null);
    try {
      await api.acknowledgeAlert(id);
      setAlerts(await api.alerts());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAlertId(null);
    }
  }, [busyAlertId, setAlerts]);

  const dismissAlert = useCallback(async (id: string) => {
    if (busyAlertId) {
      return;
    }

    setBusyAlertId(id);
    setActionError(null);
    try {
      await api.dismissAlert(id);
      setAlerts(await api.alerts());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAlertId(null);
    }
  }, [busyAlertId, setAlerts]);

  const snoozeAlert = useCallback(async (id: string) => {
    if (busyAlertId) {
      return;
    }

    setBusyAlertId(id);
    setActionError(null);
    try {
      await api.snoozeAlert(id, { delay: '15m' });
      setAlerts(await api.alerts());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAlertId(null);
    }
  }, [busyAlertId, setAlerts]);

  const openActivityConversation = useCallback((conversationId: string) => {
    setActionError(null);
    openSession(conversationId);
    navigate(`/conversations/${encodeURIComponent(conversationId)}`);
  }, [navigate, openSession]);

  const handleActivityAction = useCallback(async (entry: ActivityEntry) => {
    const linkedConversationId = pickActivityConversationId(entry);
    if (linkedConversationId) {
      openActivityConversation(linkedConversationId);
      return;
    }

    setActionError(null);
    setStartingActivityId(entry.id);
    try {
      const result = await api.startActivityConversation(entry.id);
      openSession(result.id);
      navigate(`/conversations/${encodeURIComponent(result.id)}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      setStartingActivityId(null);
    }
  }, [navigate, openActivityConversation, openSession]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={(
          <>
            {(activity || archivedSessions.length > 0 || activeAlerts.length > 0) && (
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
            {allItems.length > 0 && (
              <ToolbarButton
                onClick={() => { void clearInbox(); }}
                disabled={clearingInbox}
                className="text-[11px]"
              >
                {clearingInbox ? 'Clearing…' : 'Clear notifications'}
              </ToolbarButton>
            )}
            {unreadCount > 0 && (
              <ToolbarButton
                onClick={markAllRead}
                disabled={markingAll || clearingInbox}
                className="text-[11px]"
              >
                {markingAll ? 'Marking…' : 'Mark all read'}
              </ToolbarButton>
            )}
            <ToolbarButton onClick={() => { void refreshInbox(); }} disabled={clearingInbox || busyAlertId !== null}>↻ Refresh</ToolbarButton>
          </>
        )}
      >
        <PageHeading
          title="Notifications"
          meta={`${notificationCount} ${notificationCount === 1 ? 'notification' : 'notifications'}`}
        />
      </PageHeader>

      {isLoading && <LoadingState label="Loading notifications…" className="px-6" />}
      {visibleError && <ErrorState message={`Failed to load notifications: ${visibleError}`} className="px-6" />}
      {actionError && <ErrorState message={actionError} className="px-6" />}

      {!isLoading && !visibleError && allItems.length === 0 && (
        <EmptyState
          title="No notifications yet."
          body="Standalone activity and conversations that need attention appear here."
        />
      )}

      {!isLoading && !visibleError && allItems.length > 0 && filter === 'unread' && unreadCount === 0 && (
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
          <div className="space-y-px px-6 py-4">
            {visible.map((item) => {
              if (item.type === 'alert') {
                const meta = alertMeta(item.entry);
                const conversationId = item.entry.conversationId ?? null;
                const conversationPath = conversationId ? `/conversations/${encodeURIComponent(conversationId)}` : null;
                const busy = busyAlertId === item.entry.id;

                return (
                  <div key={item.key} className="ui-list-row">
                    {conversationPath ? (
                      <Link
                        to={conversationPath}
                        onClick={() => openSession(conversationId as string)}
                        className="min-w-0 flex flex-1 items-start gap-4"
                      >
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                        <div className="min-w-0 flex-1">
                          <p className="ui-row-title">{item.entry.title}</p>
                          <p className="ui-row-meta">
                            <span className={meta.color}>{meta.label}</span>
                            <span className="mx-1.5 opacity-40">·</span>
                            {timeAgo(item.entry.updatedAt)}
                            {item.entry.requiresAck ? (
                              <>
                                <span className="mx-1.5 opacity-40">·</span>
                                ack required
                              </>
                            ) : null}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-6 text-secondary">{item.entry.body}</p>
                        </div>
                      </Link>
                    ) : (
                      <div className="min-w-0 flex flex-1 items-start gap-4">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                        <div className="min-w-0 flex-1">
                          <p className="ui-row-title">{item.entry.title}</p>
                          <p className="ui-row-meta">
                            <span className={meta.color}>{meta.label}</span>
                            <span className="mx-1.5 opacity-40">·</span>
                            {timeAgo(item.entry.updatedAt)}
                            {item.entry.requiresAck ? (
                              <>
                                <span className="mx-1.5 opacity-40">·</span>
                                ack required
                              </>
                            ) : null}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-6 text-secondary">{item.entry.body}</p>
                        </div>
                      </div>
                    )}
                    <div className="flex shrink-0 self-center items-center gap-2">
                      {item.entry.wakeupId ? (
                        <button
                          type="button"
                          onClick={() => { void snoozeAlert(item.entry.id); }}
                          disabled={busy}
                          className="ui-action-button text-[11px]"
                          title="Snooze this notification for 15 minutes"
                        >
                          {busy ? 'working…' : 'snooze'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => { void acknowledgeAlert(item.entry.id); }}
                        disabled={busy}
                        className="ui-action-button text-[11px]"
                        title="Mark this notification read"
                      >
                        {busy ? 'working…' : 'read'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void dismissAlert(item.entry.id); }}
                        disabled={busy}
                        className="ui-action-button text-[11px]"
                        title="Dismiss this notification"
                      >
                        dismiss
                      </button>
                    </div>
                  </div>
                );
              }

              if (item.type === 'conversation') {
                const reason = buildConversationReason(item.session);
                const sortAt = item.session.attentionUpdatedAt ?? item.session.lastActivityAt ?? item.session.timestamp;

                return (
                  <ListLinkRow
                    key={item.key}
                    to={`/conversations/${item.session.id}`}
                    onClick={() => openSession(item.session.id)}
                    leading={<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warning" />}
                    trailing={<span className="shrink-0 self-center text-[10px] uppercase tracking-[0.14em] text-warning" title="Open the conversation that needs attention">open</span>}
                  >
                    <p className="ui-row-title">{item.session.title}</p>
                    <p className="ui-row-meta">
                      <span className="text-warning bg-warning/10">conversation</span>
                      <span className="mx-1.5 opacity-40">·</span>
                      {reason}
                      <span className="mx-1.5 opacity-40">·</span>
                      {timeAgo(sortAt)}
                    </p>
                  </ListLinkRow>
                );
              }

              const meta = kindMeta(item.entry.kind);
              const isSelected = item.entry.id === selectedId;
              const titleClass = item.entry.read ? 'ui-row-title text-secondary' : 'ui-row-title';
              const leadingClass = item.entry.read
                ? 'mt-1.5 h-2 w-2 shrink-0 rounded-full border border-border-default bg-transparent'
                : `mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`;
              const linkedConversationId = pickActivityConversationId(item.entry);
              const isStarting = startingActivityId === item.entry.id;

              return (
                <div
                  key={item.key}
                  className={cx('group', 'ui-list-row', isSelected ? 'ui-list-row-selected' : 'ui-list-row-hover')}
                >
                  <Link to={`/inbox/${item.entry.id}`} className="min-w-0 flex flex-1 items-start gap-4">
                    <span className={leadingClass} />
                    <div className="min-w-0 flex-1">
                      <p className={titleClass}>{item.entry.summary}</p>
                      <p className="ui-row-meta">
                        <span className={meta.color}>{meta.label}</span>
                        <span className="mx-1.5 opacity-40">·</span>
                        {timeAgo(item.entry.createdAt)}
                      </p>
                    </div>
                  </Link>
                  <div className="flex shrink-0 self-center items-center gap-3">
                    {!item.entry.read && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                    <button
                      type="button"
                      onClick={() => { void handleActivityAction(item.entry); }}
                      disabled={isStarting}
                      className="ui-action-button text-[11px]"
                      title={linkedConversationId
                        ? 'Open the linked conversation for this inbox item'
                        : 'Start a new conversation from this inbox item'}
                    >
                      {isStarting ? 'starting…' : linkedConversationId ? 'open' : 'start'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
