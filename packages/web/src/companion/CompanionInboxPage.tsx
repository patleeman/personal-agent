import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { BrowserRecordContent, ToolbarButton, browserRecordClass, cx } from '../components/ui';
import { useAppData, useAppEvents, useSseConnection } from '../contexts';
import { useApi } from '../hooks';
import { kindMeta, timeAgo } from '../utils';
import type { ActivityEntry, AlertEntry, CompanionConversationListResult, SessionMeta } from '../types';
import { CompanionCardStack } from './CompanionBrowser';
import { buildCompanionConversationPath, COMPANION_INBOX_PATH } from './routes';
import { useCompanionTopBarAction } from './CompanionLayout';

type InboxItem =
  | {
      type: 'alert';
      key: string;
      sortAt: string;
      read: false;
      entry: AlertEntry;
    }
  | {
      type: 'conversation';
      key: string;
      sortAt: string;
      read: false;
      session: SessionMeta;
    }
  | {
      type: 'activity';
      key: string;
      sortAt: string;
      read: boolean;
      entry: ActivityEntry;
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

function summarizeActivityDetails(entry: ActivityEntry): string | null {
  const details = typeof entry.details === 'string' ? entry.details.trim() : '';
  if (!details) {
    return null;
  }

  return details.split('\n').find((line) => line.trim().length > 0)?.trim() ?? null;
}

function alertMeta(entry: AlertEntry): { label: string; accentClass: string } {
  if (entry.kind === 'approval-needed') {
    return { label: 'approval', accentClass: 'text-warning' };
  }

  if (entry.kind === 'reminder') {
    return { label: 'reminder', accentClass: 'text-warning' };
  }

  if (entry.kind === 'task-failed') {
    return { label: 'failed', accentClass: 'text-danger' };
  }

  if (entry.kind === 'blocked') {
    return { label: 'blocked', accentClass: 'text-danger' };
  }

  if (entry.kind === 'task-callback') {
    return { label: 'callback', accentClass: 'text-accent' };
  }

  return {
    label: entry.kind.replace(/-/g, ' '),
    accentClass: 'text-accent',
  };
}

function collectConversationIds(result: CompanionConversationListResult | null): Set<string> {
  if (!result) {
    return new Set<string>();
  }

  return new Set([
    ...result.live,
    ...result.needsReview,
    ...result.active,
    ...result.archived,
  ].map((session) => session.id));
}

function buildConversationMeta(session: SessionMeta): string {
  const parts: string[] = [];

  if (session.messageCount > 0) {
    parts.push(`${session.messageCount} message${session.messageCount === 1 ? '' : 's'}`);
  }

  if ((session.attentionUnreadActivityCount ?? 0) > 0) {
    const count = session.attentionUnreadActivityCount ?? 0;
    parts.push(`${count} linked update${count === 1 ? '' : 's'}`);
  }

  if ((session.attentionUnreadMessageCount ?? 0) > 0) {
    const count = session.attentionUnreadMessageCount ?? 0;
    parts.push(`${count} unread message${count === 1 ? '' : 's'}`);
  }

  return parts.join(' · ') || 'Conversation';
}

export function CompanionInboxPage() {
  const navigate = useNavigate();
  const { activity, setActivity, setAlerts = () => {} } = useAppData();
  const { versions } = useAppEvents();
  const { status: sseStatus } = useSseConnection();
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const [refreshingActivity, setRefreshingActivity] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [clearingInbox, setClearingInbox] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingActivityId, setPendingActivityId] = useState<string | null>(null);
  const [pendingAlertId, setPendingAlertId] = useState<string | null>(null);
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
  const {
    data: conversationGroups,
    loading: conversationsLoading,
    refreshing: conversationsRefreshing,
    error: conversationsError,
    refetch: refetchConversations,
    replaceData: replaceConversationGroups,
  } = useApi(
    () => api.companionConversationList({ archivedOffset: 0, archivedLimit: 30 }),
    `companion-inbox:${versions.sessions}:${versions.activity}`,
  );

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
  const knownConversationIds = useMemo(
    () => collectConversationIds(conversationGroups),
    [conversationGroups],
  );
  const standaloneActivities = useMemo(
    () => (activity?.entries ?? []).filter((entry) => {
      if (activeAlertActivityIds.has(entry.id)) {
        return false;
      }

      return !(entry.relatedConversationIds ?? []).some((conversationId) => knownConversationIds.has(conversationId));
    }),
    [activity?.entries, activeAlertActivityIds, knownConversationIds],
  );
  const attentionConversations = useMemo(
    () => (conversationGroups?.needsReview ?? []).filter((session) => !activeAlertConversationIds.has(session.id)),
    [activeAlertConversationIds, conversationGroups?.needsReview],
  );

  const allItems = useMemo<InboxItem[]>(() => {
    const alertItems: InboxItem[] = activeAlerts.map((entry) => ({
      type: 'alert',
      key: `alert:${entry.id}`,
      sortAt: entry.updatedAt,
      read: false,
      entry,
    }));
    const activityItems: InboxItem[] = standaloneActivities.map((entry) => ({
      type: 'activity',
      key: `activity:${entry.id}`,
      sortAt: entry.createdAt,
      read: Boolean(entry.read),
      entry,
    }));
    const conversationItems: InboxItem[] = attentionConversations.map((session) => ({
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
  const visibleItems = useMemo(
    () => filter === 'unread' ? allItems.filter((item) => !item.read) : allItems,
    [allItems, filter],
  );

  const isLoading = (activity === null || conversationsLoading) && sseStatus !== 'offline';
  const refreshError = actionError ?? conversationsError;
  const { setTopBarAction } = useCompanionTopBarAction();

  const refreshInbox = useCallback(async () => {
    setRefreshingActivity(true);
    setActionError(null);

    try {
      const [nextActivity, nextAlerts, nextConversations] = await Promise.all([
        api.activity(),
        api.alerts(),
        refetchConversations({ resetLoading: false }),
      ]);

      setActivity({
        entries: nextActivity,
        unreadCount: nextActivity.filter((entry) => !entry.read).length,
      });
      setAlerts(nextAlerts);

      if (nextConversations) {
        replaceConversationGroups(nextConversations);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshingActivity(false);
    }
  }, [refetchConversations, replaceConversationGroups, setActivity, setAlerts]);

  const markAllRead = useCallback(async () => {
    if (unreadCount === 0 || markingAll) {
      return;
    }

    setMarkingAll(true);
    setActionError(null);
    try {
      await Promise.all([
        ...standaloneActivities.filter((entry) => !entry.read).map((entry) => api.markActivityRead(entry.id, true)),
        ...attentionConversations.map((session) => api.markConversationAttentionRead(session.id, true)),
        ...activeAlerts.map((entry) => api.acknowledgeAlert(entry.id)),
      ]);
      await refreshInbox();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setMarkingAll(false);
    }
  }, [activeAlerts, attentionConversations, markingAll, refreshInbox, standaloneActivities, unreadCount]);

  const clearInbox = useCallback(async () => {
    if (allItems.length === 0 || clearingInbox) {
      return;
    }

    if (!window.confirm(
      activeAlerts.length > 0
        ? 'Clear the inbox? This deletes standalone activity items, marks attention conversations as read, and dismisses active reminder notifications.'
        : 'Clear the inbox? This deletes standalone activity items and marks attention conversations as read.',
    )) {
      return;
    }

    setClearingInbox(true);
    setActionError(null);
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
  }, [activeAlerts, allItems.length, clearingInbox, refreshInbox]);

  const handleOpenConversation = useCallback(async (session: SessionMeta) => {
    setPendingConversationId(session.id);
    try {
      await api.markConversationAttentionRead(session.id, true).catch(() => {});
      navigate(buildCompanionConversationPath(session.id));
    } finally {
      setPendingConversationId(null);
    }
  }, [navigate]);

  const handleActivityAction = useCallback(async (entry: ActivityEntry) => {
    const linkedConversationId = pickActivityConversationId(entry);
    setPendingActivityId(entry.id);
    setActionError(null);

    try {
      if (linkedConversationId) {
        await api.markActivityRead(entry.id, true).catch(() => {});
        navigate(buildCompanionConversationPath(linkedConversationId));
        return;
      }

      const result = await api.startActivityConversation(entry.id);
      navigate(buildCompanionConversationPath(result.id));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingActivityId(null);
    }
  }, [navigate]);

  const handleToggleActivityRead = useCallback(async (entry: ActivityEntry) => {
    const nextRead = !entry.read;
    setPendingActivityId(entry.id);
    setActionError(null);
    try {
      await api.markActivityRead(entry.id, nextRead);
      const nextEntries = (activity?.entries ?? []).map((candidate) => candidate.id === entry.id ? { ...candidate, read: nextRead } : candidate);
      setActivity({
        entries: nextEntries,
        unreadCount: nextEntries.filter((candidate) => !candidate.read).length,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingActivityId(null);
    }
  }, [activity?.entries, setActivity]);

  const handleOpenAlertConversation = useCallback(async (entry: AlertEntry) => {
    if (!entry.conversationId) {
      return;
    }

    setPendingAlertId(entry.id);
    setActionError(null);
    try {
      navigate(buildCompanionConversationPath(entry.conversationId));
    } finally {
      setPendingAlertId(null);
    }
  }, [navigate]);

  const handleAcknowledgeAlert = useCallback(async (entry: AlertEntry) => {
    setPendingAlertId(entry.id);
    setActionError(null);
    try {
      await api.acknowledgeAlert(entry.id);
      await refreshInbox();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAlertId(null);
    }
  }, [refreshInbox]);

  const handleDismissAlert = useCallback(async (entry: AlertEntry) => {
    setPendingAlertId(entry.id);
    setActionError(null);
    try {
      await api.dismissAlert(entry.id);
      await refreshInbox();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAlertId(null);
    }
  }, [refreshInbox]);

  const handleSnoozeAlert = useCallback(async (entry: AlertEntry) => {
    setPendingAlertId(entry.id);
    setActionError(null);
    try {
      await api.snoozeAlert(entry.id, { delay: '15m' });
      await refreshInbox();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAlertId(null);
    }
  }, [refreshInbox]);

  useEffect(() => {
    setTopBarAction(
      <button
        key="refresh"
        type="button"
        onClick={() => { void refreshInbox(); }}
        disabled={refreshingActivity || conversationsRefreshing}
        className="rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
      >
        {refreshingActivity || conversationsRefreshing ? 'Refreshing…' : 'Refresh'}
      </button>,
    );
    return () => setTopBarAction(undefined);
  }, [conversationsRefreshing, refreshInbox, refreshingActivity, setTopBarAction]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-4">
          <div className="mb-2 px-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="ui-segmented-control">
                <button
                  type="button"
                  onClick={() => setFilter('unread')}
                  className={cx('ui-segmented-button', filter === 'unread' && 'ui-segmented-button-active')}
                >
                  Unread
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className={cx('ui-segmented-button', filter === 'all' && 'ui-segmented-button-active')}
                >
                  All
                </button>
              </div>
              {unreadCount > 0 ? (
                <ToolbarButton
                  onClick={() => { void markAllRead(); }}
                  disabled={markingAll}
                  className="rounded-full"
                >
                  {markingAll ? 'Marking…' : 'Mark all read'}
                </ToolbarButton>
              ) : null}
              {allItems.length > 0 ? (
                <ToolbarButton
                  onClick={() => { void clearInbox(); }}
                  disabled={clearingInbox}
                  className="rounded-full"
                >
                  {clearingInbox ? 'Clearing…' : 'Clear'}
                </ToolbarButton>
              ) : null}
            </div>
          </div>

          {isLoading ? <p className="px-4 text-[13px] text-dim">Loading inbox…</p> : null}
          {!isLoading && refreshError ? <p className="px-4 text-[13px] text-danger">Unable to load inbox: {refreshError}</p> : null}
          {!isLoading && !refreshError && allItems.length === 0 ? (
            <div className="px-4 pt-5">
              <p className="text-[15px] text-primary">No notifications right now.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                Activity and conversations that need attention will surface here.
              </p>
            </div>
          ) : null}
          {!isLoading && !refreshError && allItems.length > 0 && visibleItems.length === 0 ? (
            <div className="px-4 pt-5">
              <p className="text-[15px] text-primary">All caught up.</p>
              <Link to={COMPANION_INBOX_PATH} onClick={() => setFilter('all')} className="mt-2 inline-flex text-[13px] text-accent">
                View all items
              </Link>
            </div>
          ) : null}
          {!isLoading && visibleItems.length > 0 ? (
            <CompanionCardStack>
              {visibleItems.map((item) => {
                if (item.type === 'alert') {
                  const meta = alertMeta(item.entry);
                  const busy = pendingAlertId === item.entry.id;

                  return (
                    <div key={item.key} className={browserRecordClass(false, 'py-3.5')}>
                      {item.entry.conversationId ? (
                        <button
                          type="button"
                          onClick={() => { void handleOpenAlertConversation(item.entry); }}
                          disabled={busy}
                          className="block w-full text-left disabled:cursor-default"
                        >
                          <BrowserRecordContent
                            label={<span className={meta.accentClass}>{meta.label}</span>}
                            aside={busy ? 'Working…' : timeAgo(item.entry.updatedAt)}
                            heading={item.entry.title}
                            summary={item.entry.body}
                            meta={item.entry.requiresAck ? 'Mark read or dismiss' : 'Open conversation'}
                            titleClassName="text-[15px]"
                            summaryClassName="text-[13px]"
                            metaClassName="text-[11px] break-words"
                          />
                        </button>
                      ) : (
                        <BrowserRecordContent
                          label={<span className={meta.accentClass}>{meta.label}</span>}
                          aside={busy ? 'Working…' : timeAgo(item.entry.updatedAt)}
                          heading={item.entry.title}
                          summary={item.entry.body}
                          meta={item.entry.requiresAck ? 'Mark read or dismiss' : 'Notification'}
                          titleClassName="text-[15px]"
                          summaryClassName="text-[13px]"
                          metaClassName="text-[11px] break-words"
                        />
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
                        {item.entry.wakeupId ? (
                          <ToolbarButton
                            onClick={() => { void handleSnoozeAlert(item.entry); }}
                            disabled={busy}
                            className="rounded-full"
                          >
                            {busy ? 'Working…' : 'Snooze 15m'}
                          </ToolbarButton>
                        ) : null}
                        <ToolbarButton
                          onClick={() => { void handleAcknowledgeAlert(item.entry); }}
                          disabled={busy}
                          className="rounded-full"
                        >
                          {busy ? 'Working…' : 'Mark read'}
                        </ToolbarButton>
                        <ToolbarButton
                          onClick={() => { void handleDismissAlert(item.entry); }}
                          disabled={busy}
                          className="rounded-full"
                        >
                          Dismiss
                        </ToolbarButton>
                      </div>
                    </div>
                  );
                }

                if (item.type === 'conversation') {
                  const busy = pendingConversationId === item.session.id;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => { void handleOpenConversation(item.session); }}
                      disabled={busy}
                      className={browserRecordClass(false, 'py-3.5 disabled:cursor-default disabled:opacity-60')}
                    >
                      <BrowserRecordContent
                        label="Conversation"
                        aside={busy ? 'Opening…' : timeAgo(item.sortAt)}
                        heading={item.session.title}
                        summary={buildConversationReason(item.session)}
                        meta={buildConversationMeta(item.session)}
                        titleClassName="text-[15px]"
                        summaryClassName="text-[13px]"
                        metaClassName="text-[11px] break-words"
                      />
                    </button>
                  );
                }

                const linkedConversationId = pickActivityConversationId(item.entry);
                const meta = kindMeta(item.entry.kind);
                const detail = summarizeActivityDetails(item.entry);
                const busy = pendingActivityId === item.entry.id;

                return (
                  <div
                    key={item.key}
                    className={browserRecordClass(false, cx('py-3.5', item.entry.read ? 'opacity-80' : ''))}
                  >
                    <button
                      type="button"
                      onClick={() => { void handleActivityAction(item.entry); }}
                      disabled={busy}
                      className="block w-full text-left disabled:cursor-default"
                    >
                      <BrowserRecordContent
                        label={meta.label}
                        aside={busy ? 'Working…' : timeAgo(item.entry.createdAt)}
                        heading={item.entry.summary}
                        summary={detail ?? undefined}
                        meta={linkedConversationId ? 'Open conversation' : 'Start conversation'}
                        titleClassName={cx('text-[15px]', item.entry.read ? 'text-secondary' : undefined)}
                        summaryClassName="text-[13px]"
                        metaClassName="text-[11px] break-words"
                      />
                    </button>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
                      <ToolbarButton
                        onClick={() => { void handleToggleActivityRead(item.entry); }}
                        disabled={busy}
                        className="rounded-full"
                      >
                        {item.entry.read ? 'Mark unread' : 'Mark read'}
                      </ToolbarButton>
                    </div>
                  </div>
                );
              })}
            </CompanionCardStack>
          ) : null}
        </div>
      </div>
    </div>
  );
}
