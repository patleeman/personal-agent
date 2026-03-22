import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAppData } from '../contexts';
import { useConversations } from '../hooks/useConversations';
import {
  getRunConnections,
  getRunHeadline,
  getRunImportState,
  getRunMoment,
  getRunSortTimestamp,
  isRunInProgress,
  type RunPresentationLookups,
} from '../runPresentation';
import { sessionNeedsAttention } from '../sessionIndicators';
import type { DurableRunRecord, SessionMeta } from '../types';
import { timeAgo } from '../utils';
import { EmptyState, ListButtonRow, LoadingState, PageHeader, PageHeading, Pill, ToolbarButton, type PillTone } from '../components/ui';

type ConversationFilter = 'open' | 'attention' | 'archived' | 'all';
type ConversationSection = 'pinned' | 'open' | 'archived';
type ConversationWorkspaceState = ConversationSection | 'unknown';

type ConversationWorkItem = {
  key: string;
  conversationId: string;
  runId: string | null;
  workspace: ConversationWorkspaceState;
  title: string;
  summary: string;
  meta: string;
  statusLabel: string;
  tone: PillTone;
  searchText: string;
  needsReview: boolean;
  active: boolean;
};

const FILTER_OPTIONS: Array<{ value: ConversationFilter; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

const INPUT_CLASS = 'w-full max-w-xl rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const INLINE_ACTION_CLASS = 'text-[11px] font-mono text-dim transition-colors hover:text-accent disabled:opacity-40';

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function matchesConversation(session: SessionMeta, query: string): boolean {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return true;
  }

  const haystack = [
    session.title,
    session.id,
    session.cwd,
    session.cwdSlug,
    session.model,
    session.file,
    session.parentSessionId,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .toLowerCase();

  return haystack.includes(normalized);
}

function sortSessions(items: SessionMeta[]): SessionMeta[] {
  return [...items].sort((left, right) => {
    const leftTimestamp = left.lastActivityAt ?? left.timestamp;
    const rightTimestamp = right.lastActivityAt ?? right.timestamp;
    return rightTimestamp.localeCompare(leftTimestamp) || left.title.localeCompare(right.title);
  });
}

function sectionDotClass(session: SessionMeta, section: ConversationSection): string {
  if (sessionNeedsAttention(session)) {
    return 'bg-warning';
  }

  if (session.isRunning) {
    return 'bg-accent animate-pulse';
  }

  if (section === 'archived') {
    return 'bg-border-default';
  }

  return 'bg-teal';
}

function sectionMeta(session: SessionMeta, section: ConversationSection): string {
  const parts: string[] = [];
  const timestamp = session.lastActivityAt ?? session.timestamp;

  if (section === 'pinned') {
    parts.push('pinned');
  } else if (section === 'open') {
    parts.push('open');
  } else {
    parts.push('archived');
  }

  if (session.isRunning) {
    parts.push('running');
  }

  if (sessionNeedsAttention(session)) {
    parts.push('needs attention');
  }

  parts.push(timeAgo(timestamp));

  if (session.model) {
    parts.push(session.model.split('/').pop() ?? session.model);
  }

  if (session.cwdSlug) {
    parts.push(session.cwdSlug);
  }

  return parts.join(' · ');
}

function sectionSummary(section: ConversationSection, count: number): string {
  if (count === 0) {
    return '';
  }

  switch (section) {
    case 'pinned':
      return `${count} pinned ${count === 1 ? 'conversation' : 'conversations'}`;
    case 'open':
      return `${count} open ${count === 1 ? 'conversation' : 'conversations'}`;
    case 'archived':
      return `${count} archived ${count === 1 ? 'conversation' : 'conversations'}`;
    default:
      return `${count}`;
  }
}

function runStatusTone(run: DurableRunRecord): PillTone {
  const status = run.status?.status;

  if (run.problems.length > 0 || run.recoveryAction === 'invalid' || status === 'failed' || status === 'interrupted' || getRunImportState(run) === 'failed') {
    return 'danger';
  }
  if (run.recoveryAction === 'resume' || run.recoveryAction === 'rerun' || status === 'recovering' || getRunImportState(run) === 'ready') {
    return 'warning';
  }
  if (status === 'running') {
    return 'accent';
  }
  if (status === 'completed') {
    return 'success';
  }
  return 'muted';
}

function runStatusLabel(run: DurableRunRecord): string {
  const status = run.status?.status;

  if (run.problems.length > 0 || run.recoveryAction === 'invalid' || status === 'failed' || status === 'interrupted' || getRunImportState(run) === 'failed') {
    return 'attention';
  }
  if (run.recoveryAction === 'resume' || run.recoveryAction === 'rerun' || status === 'recovering' || getRunImportState(run) === 'ready') {
    return 'needs review';
  }
  if (status === 'running') {
    return 'running';
  }
  if (status === 'completed') {
    return 'completed';
  }
  return status ?? 'waiting';
}

function formatRecoveryAction(action: string): string {
  switch (action) {
    case 'resume':
      return 'resume';
    case 'rerun':
      return 'rerun';
    case 'invalid':
      return 'invalid';
    case 'attention':
      return 'needs attention';
    default:
      return action;
  }
}

function runNeedsReview(run: DurableRunRecord): boolean {
  const status = run.status?.status;
  return run.problems.length > 0
    || run.recoveryAction === 'resume'
    || run.recoveryAction === 'rerun'
    || run.recoveryAction === 'invalid'
    || status === 'failed'
    || status === 'interrupted'
    || status === 'recovering'
    || getRunImportState(run) === 'ready'
    || getRunImportState(run) === 'failed';
}

function workspaceLabel(workspace: ConversationWorkspaceState): string {
  switch (workspace) {
    case 'pinned':
      return 'pinned conversation';
    case 'open':
      return 'open conversation';
    case 'archived':
      return 'archived conversation';
    default:
      return 'conversation';
  }
}

function readConversationIdFromRun(run: DurableRunRecord, lookups: RunPresentationLookups): string | null {
  const conversationConnection = getRunConnections(run, lookups).find((connection) => connection.label === 'Conversation' || connection.label === 'Conversation to reopen');
  if (!conversationConnection?.to) {
    return null;
  }

  const match = conversationConnection.to.match(/^\/conversations\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function workItemMatches(item: ConversationWorkItem, query: string): boolean {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return true;
  }

  return item.searchText.includes(normalized);
}

function filterConversationWorkItems(items: ConversationWorkItem[], filter: ConversationFilter, query: string): ConversationWorkItem[] {
  const matched = items.filter((item) => workItemMatches(item, query));

  if (filter === 'attention') {
    return matched.filter((item) => item.needsReview);
  }

  if (filter === 'archived') {
    return matched.filter((item) => item.workspace === 'archived');
  }

  return matched;
}

function filterSectionSessions(section: ConversationSection, items: SessionMeta[], filter: ConversationFilter, query: string): SessionMeta[] {
  const matched = sortSessions(items).filter((session) => matchesConversation(session, query));

  if (filter === 'all') {
    return matched;
  }

  if (filter === 'attention') {
    return matched.filter((session) => sessionNeedsAttention(session));
  }

  if (filter === 'archived') {
    return section === 'archived' ? matched : [];
  }

  return section === 'archived' ? [] : matched;
}

function SectionBlock({
  label,
  summary,
  emptyLabel,
  sessions,
  section,
  onOpen,
  onPin,
  onUnpin,
  onClose,
  onMarkRead,
  busyId,
}: {
  label: string;
  summary: string;
  emptyLabel: string;
  sessions: SessionMeta[];
  section: ConversationSection;
  onOpen: (sessionId: string, options?: { restore?: boolean }) => void;
  onPin: (sessionId: string) => void;
  onUnpin: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onMarkRead: (sessionId: string) => void;
  busyId: string | null;
}) {
  return (
    <section className="space-y-2 border-t border-border-subtle pt-5 first:border-t-0 first:pt-0">
      <div className="space-y-1">
        <p className="ui-section-label">{label}</p>
        {summary && <p className="ui-card-meta">{summary}</p>}
      </div>

      {sessions.length === 0 ? (
        <p className="text-[12px] text-dim">{emptyLabel}</p>
      ) : (
        <div className="space-y-px">
          {sessions.map((session) => {
            const archived = section === 'archived';
            return (
              <ListButtonRow
                key={session.id}
                onClick={() => onOpen(session.id, archived ? { restore: true } : undefined)}
                leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sectionDotClass(session, section)}`} />}
                trailing={(
                  <div className="mt-0.5 flex shrink-0 items-center gap-3">
                    {sessionNeedsAttention(session) && (
                      <button
                        type="button"
                        className={INLINE_ACTION_CLASS}
                        onClick={(event) => {
                          event.stopPropagation();
                          onMarkRead(session.id);
                        }}
                        disabled={busyId === session.id}
                        title="Mark attention as read"
                      >
                        {busyId === session.id ? '…' : 'read'}
                      </button>
                    )}
                    {archived ? (
                      <button
                        type="button"
                        className={INLINE_ACTION_CLASS}
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(session.id, { restore: true });
                        }}
                        title="Restore conversation"
                      >
                        restore
                      </button>
                    ) : section === 'pinned' ? (
                      <button
                        type="button"
                        className={INLINE_ACTION_CLASS}
                        onClick={(event) => {
                          event.stopPropagation();
                          onUnpin(session.id);
                        }}
                        title="Move back to open conversations"
                      >
                        unpin
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={INLINE_ACTION_CLASS}
                        onClick={(event) => {
                          event.stopPropagation();
                          onPin(session.id);
                        }}
                        title="Pin conversation"
                      >
                        pin
                      </button>
                    )}
                    {!archived && (
                      <button
                        type="button"
                        className={INLINE_ACTION_CLASS}
                        onClick={(event) => {
                          event.stopPropagation();
                          onClose(session.id);
                        }}
                        title="Archive conversation from the open workspace"
                      >
                        close
                      </button>
                    )}
                  </div>
                )}
              >
                <p className="ui-row-title">{session.title}</p>
                <p className="ui-row-summary">{session.messageCount} {session.messageCount === 1 ? 'message' : 'messages'}</p>
                <p className="ui-row-meta break-words">{sectionMeta(session, section)}</p>
              </ListButtonRow>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ConversationWorkBlock({
  items,
  onOpen,
}: {
  items: ConversationWorkItem[];
  onOpen: (item: ConversationWorkItem) => void;
}) {
  const reviewCount = items.filter((item) => item.needsReview).length;
  const activeCount = items.filter((item) => item.active).length;
  const archivedActiveCount = new Set(items.filter((item) => item.workspace === 'archived' && item.active).map((item) => item.conversationId)).size;
  const summaryParts = [
    reviewCount > 0 ? `${reviewCount} need review` : '',
    activeCount > 0 ? `${activeCount} active` : '',
    archivedActiveCount > 0 ? `${archivedActiveCount} archived still running` : '',
  ].filter(Boolean);

  return (
    <section className="space-y-2 border-t border-border-subtle pt-5 first:border-t-0 first:pt-0">
      <div className="space-y-1">
        <p className="ui-section-label">Conversation work</p>
        <p className="ui-card-meta">
          {summaryParts.length > 0
            ? summaryParts.join(' · ')
            : 'Runs tied to conversations that are still active or need review.'}
        </p>
      </div>

      <div className="space-y-px">
        {items.map((item) => (
          <ListButtonRow
            key={item.key}
            onClick={() => onOpen(item)}
            leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.tone === 'danger' ? 'bg-danger' : item.tone === 'warning' ? 'bg-warning' : item.tone === 'accent' ? 'bg-accent animate-pulse' : item.tone === 'success' ? 'bg-success' : 'bg-border-default'}`} />}
            trailing={<span className="mt-0.5 text-[11px] font-mono text-dim transition-colors group-hover:text-secondary">inspect</span>}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="ui-row-title">{item.title}</p>
              <Pill tone={item.tone}>{item.statusLabel}</Pill>
            </div>
            <p className="ui-row-summary">{item.summary}</p>
            <p className="ui-row-meta break-words">{item.meta}</p>
          </ListButtonRow>
        ))}
      </div>
    </section>
  );
}

export function ConversationsPage() {
  const navigate = useNavigate();
  const { runs, sessions } = useAppData();
  const {
    pinnedIds,
    openIds,
    pinnedSessions,
    tabs,
    archivedSessions,
    openSession,
    closeSession,
    pinSession,
    unpinSession,
    refetch,
    loading,
  } = useConversations();
  const [filter, setFilter] = useState<ConversationFilter>('open');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const pinned = useMemo(() => filterSectionSessions('pinned', pinnedSessions, filter, query), [filter, pinnedSessions, query]);
  const open = useMemo(() => filterSectionSessions('open', tabs, filter, query), [filter, query, tabs]);
  const archived = useMemo(() => filterSectionSessions('archived', archivedSessions, filter, query), [archivedSessions, filter, query]);

  const visibleSectionCount = [pinned, open, archived].filter((items) => items.length > 0).length;
  const totalVisible = pinned.length + open.length + archived.length;
  const totalAttention = useMemo(
    () => [...pinnedSessions, ...tabs, ...archivedSessions].filter((session) => sessionNeedsAttention(session)).length,
    [archivedSessions, pinnedSessions, tabs],
  );
  const lookups = useMemo<RunPresentationLookups>(() => ({ sessions }), [sessions]);
  const openIdSet = useMemo(() => new Set(openIds), [openIds]);
  const pinnedIdSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const sessionsById = useMemo(
    () => new Map((sessions ?? []).map((session) => [session.id, session] as const)),
    [sessions],
  );
  const conversationWorkItems = useMemo<ConversationWorkItem[]>(() => {
    const runItems = [...(runs?.runs ?? [])]
      .filter((run) => runNeedsReview(run) || isRunInProgress(run))
      .map((run) => {
        const conversationId = readConversationIdFromRun(run, lookups);
        if (!conversationId) {
          return null;
        }

        const session = sessionsById.get(conversationId) ?? null;
        const headline = getRunHeadline(run, lookups);
        const workspace: ConversationWorkspaceState = pinnedIdSet.has(conversationId)
          ? 'pinned'
          : openIdSet.has(conversationId)
            ? 'open'
            : session
              ? 'archived'
              : 'unknown';
        const statusLabel = runStatusLabel(run);
        const moment = getRunMoment(run);
        const metaParts = [
          statusLabel,
          moment.at ? `${moment.label} ${timeAgo(moment.at)}` : '',
          workspaceLabel(workspace),
        ];
        if (run.recoveryAction !== 'none' && run.recoveryAction !== statusLabel) {
          metaParts.push(formatRecoveryAction(run.recoveryAction));
        }
        if (run.problems.length > 0) {
          metaParts.push(`${run.problems.length} issue${run.problems.length === 1 ? '' : 's'}`);
        }
        const title = session?.title ?? conversationId;
        const summary = headline.title !== title ? headline.title : headline.summary;
        const searchText = [
          title,
          conversationId,
          run.runId,
          summary,
          headline.summary,
          session?.cwd,
          session?.cwdSlug,
          session?.model,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0).join('\n').toLowerCase();

        return {
          key: run.runId,
          conversationId,
          runId: run.runId,
          workspace,
          title,
          summary,
          meta: metaParts.filter(Boolean).join(' · '),
          statusLabel,
          tone: runStatusTone(run),
          searchText,
          needsReview: runNeedsReview(run),
          active: isRunInProgress(run),
          sortTimestamp: getRunSortTimestamp(run),
        };
      })
      .filter((item): item is ConversationWorkItem & { sortTimestamp: string } => item !== null)
      .sort((left, right) => {
        const leftNeedsReview = left.needsReview ? 1 : 0;
        const rightNeedsReview = right.needsReview ? 1 : 0;
        if (leftNeedsReview !== rightNeedsReview) {
          return rightNeedsReview - leftNeedsReview;
        }

        const leftActive = left.active ? 1 : 0;
        const rightActive = right.active ? 1 : 0;
        if (leftActive !== rightActive) {
          return rightActive - leftActive;
        }

        return right.sortTimestamp.localeCompare(left.sortTimestamp) || left.title.localeCompare(right.title);
      })
      .map(({ sortTimestamp: _sortTimestamp, ...item }) => item);

    const coveredConversationIds = new Set(runItems.filter((item) => item.active).map((item) => item.conversationId));
    const archivedRunningItems = sortSessions(archivedSessions)
      .filter((session) => session.isRunning && !coveredConversationIds.has(session.id))
      .map((session) => ({
        key: `session:${session.id}`,
        conversationId: session.id,
        runId: null,
        workspace: 'archived' as const,
        title: session.title,
        summary: 'Conversation still running after it was closed.',
        meta: ['running', workspaceLabel('archived'), timeAgo(session.lastActivityAt ?? session.timestamp), session.model?.split('/').pop() ?? session.model, session.cwdSlug].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' · '),
        statusLabel: 'running',
        tone: 'accent' as const,
        searchText: [session.title, session.id, session.cwd, session.cwdSlug, session.model, 'running archived conversation'].filter((value): value is string => typeof value === 'string' && value.length > 0).join('\n').toLowerCase(),
        needsReview: false,
        active: true,
      }));

    return [...runItems, ...archivedRunningItems];
  }, [archivedSessions, lookups, openIdSet, pinnedIdSet, runs?.runs, sessionsById]);
  const visibleConversationWorkItems = useMemo(
    () => filterConversationWorkItems(conversationWorkItems, filter, query),
    [conversationWorkItems, filter, query],
  );
  const conversationRunReviewCount = useMemo(
    () => conversationWorkItems.filter((item) => item.needsReview).length,
    [conversationWorkItems],
  );
  const archivedRunningConversationCount = useMemo(
    () => new Set(conversationWorkItems.filter((item) => item.workspace === 'archived' && item.active).map((item) => item.conversationId)).size,
    [conversationWorkItems],
  );
  const hasVisibleConversationWork = visibleConversationWorkItems.length > 0;
  const hasVisibleContent = totalVisible > 0 || hasVisibleConversationWork;

  const handleOpen = useCallback((sessionId: string, options?: { restore?: boolean }) => {
    if (options?.restore) {
      openSession(sessionId);
    }
    navigate(`/conversations/${encodeURIComponent(sessionId)}`);
  }, [navigate, openSession]);

  const handleOpenWorkItem = useCallback((item: ConversationWorkItem) => {
    if (item.workspace === 'archived' || item.workspace === 'unknown') {
      openSession(item.conversationId);
    }

    const search = item.runId ? `?run=${encodeURIComponent(item.runId)}` : '';
    navigate(`/conversations/${encodeURIComponent(item.conversationId)}${search}`);
  }, [navigate, openSession]);

  const handleMarkRead = useCallback(async (sessionId: string) => {
    if (busyId) {
      return;
    }

    setBusyId(sessionId);
    try {
      await api.markConversationAttentionRead(sessionId);
      await refetch({ resetLoading: false });
    } finally {
      setBusyId(null);
    }
  }, [busyId, refetch]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        className="flex-wrap items-start gap-y-3"
        actions={(
          <>
            <ToolbarButton onClick={() => navigate('/conversations/new')}>+ New chat</ToolbarButton>
            <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }}>
              ↻ Refresh
            </ToolbarButton>
          </>
        )}
      >
        <PageHeading
          title="Conversations"
          meta={(
            <>
              {pinnedSessions.length} pinned · {tabs.length} open · {archivedSessions.length} archived
              {totalAttention > 0 && <span className="ml-2 text-warning">· {totalAttention} need attention</span>}
              {conversationRunReviewCount > 0 && <span className="ml-2 text-warning">· {conversationRunReviewCount} run{conversationRunReviewCount === 1 ? '' : 's'} need review</span>}
              {archivedRunningConversationCount > 0 && <span className="ml-2 text-secondary">· {archivedRunningConversationCount} archived still running</span>}
            </>
          )}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? <LoadingState label="Loading conversations…" /> : (
          <div className="space-y-5 pb-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="ui-segmented-control" role="group" aria-label="Conversation filter">
                  {FILTER_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFilter(option.value)}
                      className={filter === option.value ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <span className="ui-card-meta">Use ⌘K for global jump/search.</span>
              </div>

              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search titles, IDs, cwd, or models"
                className={INPUT_CLASS}
                autoComplete="off"
                spellCheck={false}
              />

              <p className="ui-card-meta">
                {query.trim()
                  ? `Showing ${totalVisible} matching ${totalVisible === 1 ? 'conversation' : 'conversations'} across ${visibleSectionCount} ${visibleSectionCount === 1 ? 'section' : 'sections'}${hasVisibleConversationWork ? `, plus ${visibleConversationWorkItems.length} active or review work item${visibleConversationWorkItems.length === 1 ? '' : 's'}` : ''}.`
                  : 'Use this page to browse your full conversation workspace, not just the tabs currently visible in the sidebar.'}
              </p>
            </div>

            {!hasVisibleContent ? (
              <EmptyState
                title={query.trim() ? 'No conversations match that search.' : 'No conversations yet.'}
                body={query.trim()
                  ? 'Try a broader search across titles, IDs, cwd, model names, and active run details.'
                  : 'Start a new chat to create your first conversation.'}
                action={<ToolbarButton onClick={() => navigate('/conversations/new')}>Start a conversation</ToolbarButton>}
              />
            ) : (
              <div className="space-y-6">
                {visibleConversationWorkItems.length > 0 && (
                  <ConversationWorkBlock
                    items={visibleConversationWorkItems}
                    onOpen={handleOpenWorkItem}
                  />
                )}

                {filter !== 'archived' && (
                  <SectionBlock
                    label="Pinned"
                    summary={sectionSummary('pinned', pinned.length)}
                    emptyLabel={filter === 'attention' ? 'No pinned conversations need attention.' : 'No pinned conversations in this view.'}
                    sessions={pinned}
                    section="pinned"
                    onOpen={handleOpen}
                    onPin={pinSession}
                    onUnpin={unpinSession}
                    onClose={closeSession}
                    onMarkRead={handleMarkRead}
                    busyId={busyId}
                  />
                )}

                {filter !== 'archived' && (
                  <SectionBlock
                    label="Open"
                    summary={sectionSummary('open', open.length)}
                    emptyLabel={filter === 'attention' ? 'No open conversations need attention.' : 'No open conversations in this view.'}
                    sessions={open}
                    section="open"
                    onOpen={handleOpen}
                    onPin={pinSession}
                    onUnpin={unpinSession}
                    onClose={closeSession}
                    onMarkRead={handleMarkRead}
                    busyId={busyId}
                  />
                )}

                {(filter === 'attention' || filter === 'archived' || filter === 'all') && (
                  <SectionBlock
                    label="Archived"
                    summary={sectionSummary('archived', archived.length)}
                    emptyLabel={filter === 'attention' ? 'No archived conversations need attention.' : 'No archived conversations in this view.'}
                    sessions={archived}
                    section="archived"
                    onOpen={handleOpen}
                    onPin={pinSession}
                    onUnpin={unpinSession}
                    onClose={closeSession}
                    onMarkRead={handleMarkRead}
                    busyId={busyId}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
