import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAppData, useAppEvents, useSseConnection } from '../contexts';
import { useApi } from '../hooks';
import { kindMeta, timeAgo } from '../utils';
import type { ActivityEntry, CompanionConversationListResult, SessionMeta } from '../types';
import { buildCompanionConversationPath, COMPANION_INBOX_PATH } from './routes';
import { useCompanionTopBarAction } from './CompanionLayout';

type InboxItem =
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

export function CompanionInboxPage() {
  const navigate = useNavigate();
  const { activity, setActivity } = useAppData();
  const { versions } = useAppEvents();
  const { status: sseStatus } = useSseConnection();
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const [refreshingActivity, setRefreshingActivity] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [clearingInbox, setClearingInbox] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingActivityId, setPendingActivityId] = useState<string | null>(null);
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

  const knownConversationIds = useMemo(
    () => collectConversationIds(conversationGroups),
    [conversationGroups],
  );
  const standaloneActivities = useMemo(
    () => (activity?.entries ?? []).filter((entry) => !(entry.relatedConversationIds ?? []).some((conversationId) => knownConversationIds.has(conversationId))),
    [activity?.entries, knownConversationIds],
  );
  const attentionConversations = conversationGroups?.needsReview ?? [];

  const allItems = useMemo<InboxItem[]>(() => {
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

    return [...conversationItems, ...activityItems]
      .sort((left, right) => right.sortAt.localeCompare(left.sortAt));
  }, [attentionConversations, standaloneActivities]);

  const unreadCount = useMemo(
    () => attentionConversations.length + standaloneActivities.filter((entry) => !entry.read).length,
    [attentionConversations.length, standaloneActivities],
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
      const [nextActivity, nextConversations] = await Promise.all([
        api.activity(),
        refetchConversations({ resetLoading: false }),
      ]);

      setActivity({
        entries: nextActivity,
        unreadCount: nextActivity.filter((entry) => !entry.read).length,
      });

      if (nextConversations) {
        replaceConversationGroups(nextConversations);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshingActivity(false);
    }
  }, [refetchConversations, replaceConversationGroups, setActivity]);

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
      ]);
      await refreshInbox();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setMarkingAll(false);
    }
  }, [attentionConversations, markingAll, refreshInbox, standaloneActivities, unreadCount]);

  const clearInbox = useCallback(async () => {
    if (allItems.length === 0 || clearingInbox) {
      return;
    }

    if (!window.confirm('Clear the inbox? This deletes standalone activity items and marks attention conversations as read.')) {
      return;
    }

    setClearingInbox(true);
    setActionError(null);
    try {
      await api.clearInbox();
      await refreshInbox();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setClearingInbox(false);
    }
  }, [allItems.length, clearingInbox, refreshInbox]);

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
          <div className="mb-2 flex items-center gap-2 px-4">
            <div className="inline-flex rounded-full border border-border-subtle bg-surface p-1">
              <button
                type="button"
                onClick={() => setFilter('unread')}
                className={filter === 'unread'
                  ? 'rounded-full bg-base px-3 py-1.5 text-[11px] font-medium text-primary shadow-sm'
                  : 'rounded-full px-3 py-1.5 text-[11px] font-medium text-dim transition-colors hover:text-primary'}
              >
                Unread
              </button>
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={filter === 'all'
                  ? 'rounded-full bg-base px-3 py-1.5 text-[11px] font-medium text-primary shadow-sm'
                  : 'rounded-full px-3 py-1.5 text-[11px] font-medium text-dim transition-colors hover:text-primary'}
              >
                All
              </button>
            </div>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => { void markAllRead(); }}
                disabled={markingAll}
                className="rounded-full border border-border-default px-3 py-1.5 text-[11px] font-medium text-secondary transition-colors hover:text-primary disabled:cursor-default disabled:opacity-45"
              >
                {markingAll ? 'Marking…' : 'Mark all read'}
              </button>
            ) : null}
            {allItems.length > 0 ? (
              <button
                type="button"
                onClick={() => { void clearInbox(); }}
                disabled={clearingInbox}
                className="rounded-full border border-border-default px-3 py-1.5 text-[11px] font-medium text-secondary transition-colors hover:text-primary disabled:cursor-default disabled:opacity-45"
              >
                {clearingInbox ? 'Clearing…' : 'Clear'}
              </button>
            ) : null}
          </div>

          {isLoading ? <p className="px-4 text-[13px] text-dim">Loading inbox…</p> : null}
          {!isLoading && refreshError ? <p className="px-4 text-[13px] text-danger">Unable to load inbox: {refreshError}</p> : null}
          {!isLoading && !refreshError && allItems.length === 0 ? (
            <div className="px-4 pt-5">
              <p className="text-[15px] text-primary">No inbox items right now.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                Activity, approvals, failures, and conversations that need attention will surface here.
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
            <div className="border-y border-border-subtle">
              {visibleItems.map((item) => {
                if (item.type === 'conversation') {
                  const busy = pendingConversationId === item.session.id;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => { void handleOpenConversation(item.session); }}
                      disabled={busy}
                      className="flex w-full items-start gap-3 border-b border-border-subtle px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-surface/55 disabled:cursor-default disabled:opacity-60"
                    >
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warning" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <h2 className="truncate text-[15px] font-medium leading-tight text-primary">{item.session.title}</h2>
                            <p className="mt-1 text-[12px] leading-relaxed text-secondary">{buildConversationReason(item.session)}</p>
                            <p className="mt-2 break-words text-[11px] text-dim">Conversation · {timeAgo(item.sortAt)}</p>
                          </div>
                          <span className="shrink-0 rounded-full bg-warning/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-warning">
                            {busy ? 'opening' : 'open'}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                }

                const linkedConversationId = pickActivityConversationId(item.entry);
                const meta = kindMeta(item.entry.kind);
                const detail = summarizeActivityDetails(item.entry);
                const busy = pendingActivityId === item.entry.id;

                return (
                  <div key={item.key} className="border-b border-border-subtle px-4 py-3.5 last:border-b-0">
                    <div className="flex items-start gap-3">
                      <span className={item.entry.read ? 'mt-1.5 h-2 w-2 shrink-0 rounded-full border border-border-default bg-transparent' : `mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <h2 className={item.entry.read ? 'truncate text-[15px] font-medium leading-tight text-secondary' : 'truncate text-[15px] font-medium leading-tight text-primary'}>{item.entry.summary}</h2>
                            <p className="mt-2 break-words text-[11px] text-dim">
                              <span className={`rounded-full px-2 py-1 ${meta.color}`}>{meta.label}</span>
                              <span className="mx-1.5 opacity-40">·</span>
                              {timeAgo(item.entry.createdAt)}
                            </p>
                            {detail ? <p className="mt-2 text-[12px] leading-relaxed text-secondary">{detail}</p> : null}
                          </div>
                          {!item.entry.read ? <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /> : null}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => { void handleActivityAction(item.entry); }}
                            disabled={busy}
                            className="rounded-full bg-accent px-3 py-1.5 text-[11px] font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-45"
                          >
                            {busy ? 'Working…' : linkedConversationId ? 'Open conversation' : 'Start conversation'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { void handleToggleActivityRead(item.entry); }}
                            disabled={busy}
                            className="rounded-full border border-border-default px-3 py-1.5 text-[11px] font-medium text-secondary transition-colors hover:text-primary disabled:cursor-default disabled:opacity-45"
                          >
                            {item.entry.read ? 'Mark unread' : 'Mark read'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
