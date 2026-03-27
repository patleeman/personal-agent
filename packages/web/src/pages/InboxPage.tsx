import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAppData, useSseConnection } from '../contexts';
import { useConversations } from '../hooks/useConversations';
import { sessionNeedsAttention } from '../sessionIndicators';
import { kindMeta, timeAgo } from '../utils';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, Pill, ToolbarButton, cx } from '../components/ui';
import type { ActivityEntry, AlertEntry, SessionMeta } from '../types';

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

function pickActivityConversationId(entry: Pick<ActivityEntry, 'relatedConversationIds'>): string | null {
  const relatedConversationIds = (entry.relatedConversationIds ?? [])
    .filter((conversationId): conversationId is string => typeof conversationId === 'string' && conversationId.trim().length > 0);

  return relatedConversationIds.length > 0
    ? relatedConversationIds[relatedConversationIds.length - 1] ?? null
    : null;
}

function alertTone(entry: AlertEntry): 'warning' | 'accent' | 'danger' {
  if (entry.kind === 'approval-needed' || entry.kind === 'reminder') {
    return 'warning';
  }

  if (entry.kind === 'task-failed' || entry.kind === 'blocked') {
    return 'danger';
  }

  return 'accent';
}

function alertLabel(entry: AlertEntry): string {
  if (entry.kind === 'task-callback') {
    return 'task callback';
  }

  return entry.kind.replace(/-/g, ' ');
}

function sortAlerts(entries: AlertEntry[]): AlertEntry[] {
  return [...entries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function InboxPage() {
  const navigate = useNavigate();
  const { id: selectedId } = useParams<{ id?: string }>();
  const { activity, alerts, setActivity, setAlerts = () => {} } = useAppData();
  const { status: sseStatus } = useSseConnection();
  const { tabs, archivedSessions, archivedConversationIds = [], openSession, loading: conversationsLoading, refetch: refetchSessions } = useConversations();
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');
  const [markingAll, setMarkingAll] = useState(false);
  const [clearingInbox, setClearingInbox] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [startingActivityId, setStartingActivityId] = useState<string | null>(null);
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);

  const standaloneActivities = useMemo(() => {
    const knownConversationIds = new Set([...tabs, ...archivedSessions].map((session) => session.id));
    return (activity?.entries ?? []).filter((entry) => {
      return !(entry.relatedConversationIds ?? []).some((conversationId) => knownConversationIds.has(conversationId));
    });
  }, [activity?.entries, archivedSessions, tabs]);

  const archivedConversationIdSet = useMemo(
    () => new Set(archivedConversationIds),
    [archivedConversationIds],
  );
  const attentionConversations = useMemo(
    () => archivedSessions.filter((session) => sessionNeedsAttention(session) && !archivedConversationIdSet.has(session.id)),
    [archivedConversationIdSet, archivedSessions],
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

  const activeAlerts = useMemo(
    () => sortAlerts((alerts?.entries ?? []).filter((entry) => entry.status === 'active')),
    [alerts?.entries],
  );
  const unreadCount = useMemo(
    () => attentionConversations.length + standaloneActivities.filter((entry) => !entry.read).length,
    [attentionConversations.length, standaloneActivities],
  );
  const notificationCount = unreadCount + activeAlerts.length;
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

  const clearInbox = useCallback(async () => {
    if (allItems.length === 0) {
      return;
    }

    const confirmed = window.confirm('Clear the inbox? This deletes standalone activity items and marks archived conversations as read.');
    if (!confirmed) {
      return;
    }

    setActionError(null);
    setClearingInbox(true);
    try {
      await api.clearInbox();
      await refreshInbox();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setClearingInbox(false);
    }
  }, [allItems.length, refreshInbox]);

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
            {(alerts?.entries.length ?? 0) > 0 && (
              <Link to="/alerts" className="ui-toolbar-button text-[11px]">
                Alert history
              </Link>
            )}
            {allItems.length > 0 && (
              <ToolbarButton
                onClick={() => { void clearInbox(); }}
                disabled={clearingInbox}
                className="text-[11px]"
              >
                {clearingInbox ? 'Clearing…' : 'Clear inbox'}
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
          title="Inbox"
          meta={(
            <>
              {notificationCount} {notificationCount === 1 ? 'notification' : 'notifications'}
              {' · '}
              {activeAlerts.length} active {activeAlerts.length === 1 ? 'alert' : 'alerts'}
              {' · '}
              {allItems.length} inbox {allItems.length === 1 ? 'item' : 'items'}
            </>
          )}
        />
      </PageHeader>

      {isLoading && <LoadingState label="Loading inbox…" className="px-6" />}
      {visibleError && <ErrorState message={`Failed to load inbox: ${visibleError}`} className="px-6" />}
      {actionError && <ErrorState message={actionError} className="px-6" />}

      {!isLoading && !visibleError && activeAlerts.length > 0 && (
        <div className="px-6 pt-4">
          <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface/45">
            <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
              <div className="space-y-1">
                <p className="ui-section-label">Active alerts</p>
                <p className="ui-card-meta">Interrupting reminders and callbacks stay visible here until you acknowledge or dismiss them.</p>
              </div>
              <Link to="/alerts" className="ui-toolbar-button shrink-0">Open alerts</Link>
            </div>
            <div className="divide-y divide-border-subtle">
              {activeAlerts.map((entry) => {
                const busy = busyAlertId === entry.id;
                const conversationPath = entry.conversationId ? `/conversations/${encodeURIComponent(entry.conversationId)}` : null;
                return (
                  <div key={entry.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Pill tone={alertTone(entry)}>{alertLabel(entry)}</Pill>
                          <span className="text-[11px] text-dim">{timeAgo(entry.updatedAt)}</span>
                        </div>
                        <p className="mt-2 text-[13px] font-medium text-primary">{entry.title}</p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] leading-6 text-secondary">{entry.body}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {conversationPath ? (
                          <Link to={conversationPath} className="ui-toolbar-button">Open conversation</Link>
                        ) : null}
                        <div className="flex flex-wrap justify-end gap-2">
                          {entry.wakeupId ? (
                            <ToolbarButton disabled={busy} onClick={() => { void snoozeAlert(entry.id); }}>
                              {busy ? 'Working…' : 'Snooze 15m'}
                            </ToolbarButton>
                          ) : null}
                          <ToolbarButton disabled={busy} onClick={() => { void acknowledgeAlert(entry.id); }}>
                            {busy ? 'Working…' : 'Acknowledge'}
                          </ToolbarButton>
                          <ToolbarButton disabled={busy} onClick={() => { void dismissAlert(entry.id); }}>
                            Dismiss
                          </ToolbarButton>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {!isLoading && !visibleError && allItems.length === 0 && activeAlerts.length === 0 && (
        <EmptyState
          title="No notifications yet."
          body="Standalone background activity, archived conversations that need attention, and sparse alerts appear here."
        />
      )}

      {!isLoading && allItems.length > 0 && filter === 'unread' && unreadCount === 0 && activeAlerts.length === 0 && (
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
