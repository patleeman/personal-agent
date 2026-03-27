import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  runNeedsAttention,
  type RunPresentationLookups,
} from '../runPresentation';
import { sessionNeedsAttention } from '../sessionIndicators';
import type { DurableRunRecord, SessionMeta } from '../types';
import { timeAgo } from '../utils';
import { ConversationWorkspaceShell } from '../components/ConversationWorkspaceShell';
import { EmptyState, LoadingState, PageHeader, PageHeading, Pill, ToolbarButton, cx, type PillTone } from '../components/ui';

type ConversationFilter = 'open' | 'attention' | 'archived' | 'all';
type ConversationSection = 'pinned' | 'open' | 'archived';
type ConversationWorkspaceState = ConversationSection | 'unknown';

type ConversationWorkItem = {
  key: string;
  conversationId: string;
  runId: string | null;
  workspace: ConversationWorkspaceState;
  title: string;
  summary: string | null;
  meta: string;
  statusLabel: string;
  tone: PillTone;
  searchText: string;
  needsReview: boolean;
  active: boolean;
};

const INPUT_CLASS = 'w-full max-w-xl rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const INLINE_ACTION_CLASS = 'ui-toolbar-button min-h-0 px-2 py-1 text-[11px] font-mono leading-none disabled:opacity-40';

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function parseConversationFilter(value: string | null): ConversationFilter {
  switch (value) {
    case 'attention':
    case 'archived':
    case 'all':
      return value;
    default:
      return 'open';
  }
}

function conversationFilterLabel(filter: ConversationFilter): string {
  switch (filter) {
    case 'attention':
      return 'Needs review';
    case 'archived':
      return 'Archived';
    case 'all':
      return 'All conversations';
    default:
      return 'Open';
  }
}

function conversationFilterDescription(filter: ConversationFilter): string {
  switch (filter) {
    case 'attention':
      return 'Needs review includes unread conversation updates plus durable runs waiting on resume, rerun, import recovery, or manual review. Use read to clear items you have already handled.';
    case 'archived':
      return 'Archived keeps closed conversations visible, including linked runs that are still active or waiting on you.';
    case 'all':
      return 'Use this page to browse your full conversation workspace, including archived conversations and linked durable runs.';
    default:
      return 'Open focuses on pinned and open conversations. Workspace-wide review counts in the header can still include archived or imported durable runs.';
  }
}

function emptyStateCopy(filter: ConversationFilter, hasWorkspaceConversations: boolean): { title: string; body: string } {
  if (!hasWorkspaceConversations) {
    return {
      title: 'No conversations yet.',
      body: 'Start a new chat to create your first conversation.',
    };
  }

  switch (filter) {
    case 'attention':
      return {
        title: 'Nothing needs review right now.',
        body: 'Unread conversation updates and linked runs waiting on you will show up here.',
      };
    case 'archived':
      return {
        title: 'No archived conversations.',
        body: 'Archive a conversation from the open workspace to keep it here without deleting it.',
      };
    case 'all':
      return {
        title: 'No conversations in this view.',
        body: 'Try a broader search or switch back to the open workspace from the sidebar.',
      };
    default:
      return {
        title: 'No open conversations.',
        body: 'Your remaining conversations may already be archived. Use the sidebar to switch views or start a new chat.',
      };
  }
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

function sectionMeta(session: SessionMeta): string {
  const parts: string[] = [];
  const timestamp = session.lastActivityAt ?? session.timestamp;

  if (session.isRunning) {
    parts.push('running');
  } else if (sessionNeedsAttention(session)) {
    parts.push('review');
  }

  parts.push(`updated ${timeAgo(timestamp)}`);

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

function ListActionRow({
  onClick,
  leading,
  actions,
  children,
}: {
  onClick: () => void;
  leading: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cx('group', 'ui-list-row', 'ui-list-row-hover')}>
      {leading}
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 flex-col items-start self-stretch rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
      >
        {children}
      </button>
      {actions ? <div className="mt-0.5 flex shrink-0 items-center gap-3 self-start">{actions}</div> : null}
    </div>
  );
}

function runStatusTone(run: DurableRunRecord): PillTone {
  const status = run.status?.status;

  if (run.problems.length > 0 || run.recoveryAction === 'invalid' || status === 'failed' || status === 'interrupted' || getRunImportState(run) === 'failed') {
    return 'danger';
  }
  if (run.recoveryAction === 'resume' || run.recoveryAction === 'rerun' || run.recoveryAction === 'attention' || status === 'recovering' || getRunImportState(run) === 'ready') {
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
    return 'issue';
  }
  if (run.recoveryAction === 'resume' || run.recoveryAction === 'rerun' || run.recoveryAction === 'attention' || status === 'recovering' || getRunImportState(run) === 'ready') {
    return 'review';
  }
  if (status === 'running') {
    return 'running';
  }
  if (status === 'completed') {
    return 'done';
  }
  return 'queued';
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
      return 'manual review';
    default:
      return action;
  }
}

function workspaceLabel(workspace: ConversationWorkspaceState): string {
  switch (workspace) {
    case 'pinned':
      return 'pinned';
    case 'open':
      return 'open';
    case 'archived':
      return 'archived';
    default:
      return 'conversation';
  }
}

function isGenericRunSummary(summary: string): boolean {
  return /^(Live conversation|Background run|Scheduled task|Wakeup|Remote execution)( · .+)?$/.test(summary)
    || summary === 'Conversation node distillation'
    || summary === 'Shell run'
    || summary === 'Workflow'
    || summary === 'Run';
}

function buildConversationWorkSummary(title: string, headline: ReturnType<typeof getRunHeadline>): string | null {
  if (headline.title !== title) {
    return headline.title;
  }

  return isGenericRunSummary(headline.summary) ? null : headline.summary;
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

  if (filter === 'open') {
    return matched.filter((item) => item.workspace === 'pinned' || item.workspace === 'open');
  }

  return matched;
}

function filterSectionSessions(
  section: ConversationSection,
  items: SessionMeta[],
  filter: ConversationFilter,
  query: string,
  explicitlyArchivedIdSet: ReadonlySet<string> = new Set(),
): SessionMeta[] {
  const matched = sortSessions(items).filter((session) => matchesConversation(session, query));

  if (filter === 'all') {
    return matched;
  }

  if (filter === 'attention') {
    return matched.filter((session) => {
      if (!sessionNeedsAttention(session)) {
        return false;
      }

      return section !== 'archived' || !explicitlyArchivedIdSet.has(session.id);
    });
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
              <ListActionRow
                key={session.id}
                onClick={() => onOpen(session.id, archived ? { restore: true } : undefined)}
                leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sectionDotClass(session, section)}`} />}
                actions={(
                  <>
                    {sessionNeedsAttention(session) && (
                      <button
                        type="button"
                        className={INLINE_ACTION_CLASS}
                        onClick={() => onMarkRead(session.id)}
                        disabled={busyId === session.id}
                        title="Mark as reviewed"
                      >
                        {busyId === session.id ? '…' : 'read'}
                      </button>
                    )}
                    {archived ? (
                      <button
                        type="button"
                        className={INLINE_ACTION_CLASS}
                        onClick={() => onOpen(session.id, { restore: true })}
                        title="Restore conversation"
                      >
                        restore
                      </button>
                    ) : section === 'pinned' ? (
                      <button
                        type="button"
                        className={INLINE_ACTION_CLASS}
                        onClick={() => onUnpin(session.id)}
                        title="Move back to open conversations"
                      >
                        unpin
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={INLINE_ACTION_CLASS}
                        onClick={() => onPin(session.id)}
                        title="Pin conversation"
                      >
                        pin
                      </button>
                    )}
                    {!archived && (
                      <button
                        type="button"
                        className={INLINE_ACTION_CLASS}
                        onClick={() => onClose(session.id)}
                        title="Archive conversation from the workspace"
                      >
                        close
                      </button>
                    )}
                  </>
                )}
              >
                <p className="ui-row-title">{session.title}</p>
                <p className="ui-row-summary">{session.messageCount} {session.messageCount === 1 ? 'message' : 'messages'}</p>
                <p className="ui-row-meta break-words">{sectionMeta(session)}</p>
              </ListActionRow>
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
  onMarkRead,
  busyRunId,
}: {
  items: ConversationWorkItem[];
  onOpen: (item: ConversationWorkItem) => void;
  onMarkRead: (runId: string) => void;
  busyRunId: string | null;
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
        <p className="ui-section-label">Conversation runs</p>
        <p className="ui-card-meta">
          {summaryParts.length > 0
            ? summaryParts.join(' · ')
            : 'Only active runs or runs waiting on you show up here.'}
          {' '}These are durable run states linked back to conversations, including archived or imported work when it matches the current view.
        </p>
      </div>

      <div className="space-y-px">
        {items.map((item) => (
          <ListActionRow
            key={item.key}
            onClick={() => onOpen(item)}
            leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.tone === 'danger' ? 'bg-danger' : item.tone === 'warning' ? 'bg-warning' : item.tone === 'accent' ? 'bg-accent animate-pulse' : item.tone === 'success' ? 'bg-success' : 'bg-border-default'}`} />}
            actions={(
              <>
                {item.needsReview && item.runId && (
                  <button
                    type="button"
                    className={INLINE_ACTION_CLASS}
                    onClick={() => onMarkRead(item.runId as string)}
                    disabled={busyRunId === item.runId}
                    title="Mark run as reviewed"
                  >
                    {busyRunId === item.runId ? '…' : 'read'}
                  </button>
                )}
                <span className="text-[11px] font-mono text-dim transition-colors group-hover:text-secondary">open</span>
              </>
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="ui-row-title">{item.title}</p>
              <Pill tone={item.tone}>{item.statusLabel}</Pill>
            </div>
            {item.summary && <p className="ui-row-summary">{item.summary}</p>}
            <p className="ui-row-meta break-words">{item.meta}</p>
          </ListActionRow>
        ))}
      </div>
    </section>
  );
}

export function ConversationsPage() {
  const navigate = useNavigate();
  const { runs, sessions, setRuns } = useAppData();
  const {
    pinnedIds,
    openIds,
    archivedConversationIds = [],
    pinnedSessions,
    tabs,
    archivedSessions,
    openSession,
    pinSession,
    unpinSession,
    archiveSession,
    restoreSession,
    refetch,
    loading,
  } = useConversations();
  const [searchParams] = useSearchParams();
  const filter = parseConversationFilter(searchParams.get('filter'));
  const [query, setQuery] = useState('');
  const [busyConversationId, setBusyConversationId] = useState<string | null>(null);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);

  useEffect(() => {
    if (runs !== null) {
      return;
    }

    let cancelled = false;
    void api.runs()
      .then((nextRuns) => {
        if (!cancelled) {
          setRuns(nextRuns);
        }
      })
      .catch(() => {
        // Leave the page-level runs section empty until a later refresh or SSE update.
      });

    return () => {
      cancelled = true;
    };
  }, [runs, setRuns]);

  const archivedConversationIdSet = useMemo(
    () => new Set(archivedConversationIds),
    [archivedConversationIds],
  );
  const pinned = useMemo(() => filterSectionSessions('pinned', pinnedSessions, filter, query), [filter, pinnedSessions, query]);
  const open = useMemo(() => filterSectionSessions('open', tabs, filter, query), [filter, query, tabs]);
  const archived = useMemo(
    () => filterSectionSessions('archived', archivedSessions, filter, query, archivedConversationIdSet),
    [archivedConversationIdSet, archivedSessions, filter, query],
  );

  const visibleSectionCount = [pinned, open, archived].filter((items) => items.length > 0).length;
  const totalVisible = pinned.length + open.length + archived.length;
  const totalAttention = useMemo(
    () => [
      ...pinnedSessions,
      ...tabs,
      ...archivedSessions.filter((session) => !archivedConversationIdSet.has(session.id)),
    ].filter((session) => sessionNeedsAttention(session)).length,
    [archivedConversationIdSet, archivedSessions, pinnedSessions, tabs],
  );
  const lookups = useMemo<RunPresentationLookups>(() => ({ sessions }), [sessions]);
  const openIdSet = useMemo(() => new Set(openIds), [openIds]);
  const pinnedIdSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const sessionsById = useMemo(
    () => new Map((sessions ?? []).map((session) => [session.id, session] as const)),
    [sessions],
  );
  const conversationWorkItems = useMemo<ConversationWorkItem[]>(() => {
    const runItems: Array<ConversationWorkItem & { sortTimestamp: string }> = [];

    for (const run of runs?.runs ?? []) {
      if (!runNeedsAttention(run) && !isRunInProgress(run)) {
        continue;
      }

      const conversationId = readConversationIdFromRun(run, lookups);
      if (!conversationId) {
        continue;
      }

      const session = sessionsById.get(conversationId) ?? null;
      if (archivedConversationIdSet.has(conversationId)) {
        continue;
      }

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
      const title = session?.title ?? conversationId;
      const summary = buildConversationWorkSummary(title, headline);
      const recoveryLabel = formatRecoveryAction(run.recoveryAction);
      const metaParts = [
        moment.at ? `${moment.label} ${timeAgo(moment.at)}` : '',
        workspaceLabel(workspace),
      ];
      if (run.recoveryAction !== 'none' && recoveryLabel !== statusLabel) {
        metaParts.push(recoveryLabel);
      }
      if (run.problems.length > 0) {
        metaParts.push(`${run.problems.length} issue${run.problems.length === 1 ? '' : 's'}`);
      }
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

      runItems.push({
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
        needsReview: runNeedsAttention(run),
        active: isRunInProgress(run),
        sortTimestamp: getRunSortTimestamp(run),
      });
    }

    runItems.sort((left, right) => {
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
    });

    const sortedRunItems = runItems.map(({ sortTimestamp: _sortTimestamp, ...item }) => item);

    const coveredConversationIds = new Set(sortedRunItems.filter((item) => item.active).map((item) => item.conversationId));
    const archivedRunningItems = sortSessions(archivedSessions)
      .filter((session) => !archivedConversationIdSet.has(session.id))
      .filter((session) => session.isRunning && !coveredConversationIds.has(session.id))
      .map((session) => ({
        key: `session:${session.id}`,
        conversationId: session.id,
        runId: null,
        workspace: 'archived' as const,
        title: session.title,
        summary: 'Still running after you archived it.',
        meta: ['archived', `updated ${timeAgo(session.lastActivityAt ?? session.timestamp)}`, session.model?.split('/').pop() ?? session.model, session.cwdSlug].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' · '),
        statusLabel: 'running',
        tone: 'accent' as const,
        searchText: [session.title, session.id, session.cwd, session.cwdSlug, session.model, 'running archived conversation'].filter((value): value is string => typeof value === 'string' && value.length > 0).join('\n').toLowerCase(),
        needsReview: false,
        active: true,
      }));

    return [...sortedRunItems, ...archivedRunningItems];
  }, [archivedConversationIdSet, archivedSessions, lookups, openIdSet, pinnedIdSet, runs?.runs, sessionsById]);
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
  const hasWorkspaceConversations = pinnedSessions.length + tabs.length + archivedSessions.length > 0;
  const filteredEmptyState = emptyStateCopy(filter, hasWorkspaceConversations);

  const handleOpen = useCallback((sessionId: string, options?: { restore?: boolean }) => {
    if (options?.restore) {
      restoreSession(sessionId);
    }
    navigate(`/conversations/${encodeURIComponent(sessionId)}`);
  }, [navigate, restoreSession]);

  const handleOpenWorkItem = useCallback((item: ConversationWorkItem) => {
    if (item.workspace === 'archived' || item.workspace === 'unknown') {
      openSession(item.conversationId);
    }

    const search = item.runId ? `?run=${encodeURIComponent(item.runId)}` : '';
    navigate(`/conversations/${encodeURIComponent(item.conversationId)}${search}`);
  }, [navigate, openSession]);

  const handleMarkRead = useCallback(async (sessionId: string) => {
    if (busyConversationId) {
      return;
    }

    setBusyConversationId(sessionId);
    try {
      await api.markConversationAttentionRead(sessionId);
      await refetch();
    } finally {
      setBusyConversationId(null);
    }
  }, [busyConversationId, refetch]);

  const handleMarkRunRead = useCallback(async (runId: string) => {
    if (busyRunId) {
      return;
    }

    setBusyRunId(runId);
    try {
      await api.markDurableRunAttentionRead(runId);
      setRuns(await api.runs());
    } finally {
      setBusyRunId(null);
    }
  }, [busyRunId, setRuns]);

  return (
    <ConversationWorkspaceShell>
      <div className="flex h-full flex-col overflow-hidden">
        <PageHeader
          className="flex-wrap items-start gap-y-3"
          actions={(
            <>
              <ToolbarButton onClick={() => navigate('/conversations/new')}>+ New chat</ToolbarButton>
              <ToolbarButton onClick={() => { void refetch(); }}>
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
              {totalAttention > 0 && <span className="ml-2 text-warning">· {totalAttention} conversation{totalAttention === 1 ? '' : 's'} need review</span>}
              {conversationRunReviewCount > 0 && <span className="ml-2 text-warning">· {conversationRunReviewCount} linked run{conversationRunReviewCount === 1 ? '' : 's'} need review workspace-wide</span>}
              {archivedRunningConversationCount > 0 && <span className="ml-2 text-secondary">· {archivedRunningConversationCount} archived still running</span>}
            </>
          )}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? <LoadingState label="Loading conversations…" /> : (
          <div className="space-y-5 pb-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {([
                  ['open', 'Open'],
                  ['attention', 'Needs review'],
                  ['archived', 'Archived'],
                  ['all', 'All'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => navigate(value === 'open' ? '/conversations' : `/conversations?filter=${value}`)}
                    className={filter === value ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <p className="ui-card-meta">
                View: {conversationFilterLabel(filter)} · Use ⌘K for global jump/search.
              </p>

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
                  : conversationFilterDescription(filter)}
              </p>
            </div>

            {!hasVisibleContent ? (
              <EmptyState
                title={query.trim() ? 'No conversations match that search.' : filteredEmptyState.title}
                body={query.trim()
                  ? 'Try a broader search across titles, IDs, cwd, model names, and active run details.'
                  : filteredEmptyState.body}
                action={<ToolbarButton onClick={() => navigate('/conversations/new')}>Start a conversation</ToolbarButton>}
              />
            ) : (
              <div className="space-y-6">
                {visibleConversationWorkItems.length > 0 && (
                  <ConversationWorkBlock
                    items={visibleConversationWorkItems}
                    onOpen={handleOpenWorkItem}
                    onMarkRead={handleMarkRunRead}
                    busyRunId={busyRunId}
                  />
                )}

                {filter !== 'archived' && (
                  <SectionBlock
                    label="Pinned"
                    summary={sectionSummary('pinned', pinned.length)}
                    emptyLabel={filter === 'attention' ? 'No pinned conversations need review.' : 'No pinned conversations in this view.'}
                    sessions={pinned}
                    section="pinned"
                    onOpen={handleOpen}
                    onPin={pinSession}
                    onUnpin={unpinSession}
                    onClose={archiveSession}
                    onMarkRead={handleMarkRead}
                    busyId={busyConversationId}
                  />
                )}

                {filter !== 'archived' && (
                  <SectionBlock
                    label="Open"
                    summary={sectionSummary('open', open.length)}
                    emptyLabel={filter === 'attention' ? 'No open conversations need review.' : 'No open conversations in this view.'}
                    sessions={open}
                    section="open"
                    onOpen={handleOpen}
                    onPin={pinSession}
                    onUnpin={unpinSession}
                    onClose={archiveSession}
                    onMarkRead={handleMarkRead}
                    busyId={busyConversationId}
                  />
                )}

                {(filter === 'attention' || filter === 'archived' || filter === 'all') && (
                  <SectionBlock
                    label="Archived"
                    summary={sectionSummary('archived', archived.length)}
                    emptyLabel={filter === 'attention' ? 'No archived conversations need review.' : 'No archived conversations in this view.'}
                    sessions={archived}
                    section="archived"
                    onOpen={handleOpen}
                    onPin={pinSession}
                    onUnpin={unpinSession}
                    onClose={archiveSession}
                    onMarkRead={handleMarkRead}
                    busyId={busyConversationId}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </ConversationWorkspaceShell>
  );
}
