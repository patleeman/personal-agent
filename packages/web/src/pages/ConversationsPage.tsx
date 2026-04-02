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
import { EmptyState, LoadingState, PageHeader, PageHeading, SectionLabel, ToolbarButton, cx, type PillTone } from '../components/ui';

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
  timestampLabel: string | null;
  statusLabel: string;
  tone: PillTone;
  searchText: string;
  needsReview: boolean;
  active: boolean;
};

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const INLINE_ACTION_CLASS = 'ui-toolbar-button min-h-0 px-2 py-1 text-[11px] leading-none disabled:opacity-40';

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

function buildConversationFilterHref(filter: ConversationFilter): string {
  return filter === 'open' ? '/conversations' : `/conversations?filter=${filter}`;
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
        body: 'Unread conversation updates will show up here.',
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

type ConversationLinkState = {
  activeCount: number;
};

function sessionNeedsReview(session: SessionMeta): boolean {
  return sessionNeedsAttention(session);
}

function linkedRunIsActive(session: SessionMeta, linkedState: ConversationLinkState | undefined): boolean {
  return session.isRunning || (linkedState?.activeCount ?? 0) > 0;
}

function linkedRunActiveLabel(count: number): string {
  return `${count} linked run${count === 1 ? '' : 's'} active`;
}

function buildConversationLinkStates(items: ConversationWorkItem[]): Map<string, ConversationLinkState> {
  const states = new Map<string, ConversationLinkState>();

  for (const item of items) {
    if (!item.active) {
      continue;
    }

    const current = states.get(item.conversationId) ?? { activeCount: 0 };
    current.activeCount += 1;
    states.set(item.conversationId, current);
  }

  return states;
}

function filterSessions(
  items: SessionMeta[],
  query: string,
  options: {
    attentionOnly?: boolean;
    excludedSessionIds?: ReadonlySet<string>;
  } = {},
): SessionMeta[] {
  const matched = sortSessions(items).filter((session) => matchesConversation(session, query));

  if (!options.attentionOnly) {
    return matched;
  }

  return matched.filter((session) => {
    if (options.excludedSessionIds?.has(session.id)) {
      return false;
    }

    return sessionNeedsReview(session);
  });
}

function sectionDotClass(
  session: SessionMeta,
  section: ConversationSection,
  linkedState: ConversationLinkState | undefined,
): string {
  if (sessionNeedsReview(session)) {
    return 'bg-warning';
  }

  if (linkedRunIsActive(session, linkedState)) {
    return 'bg-accent animate-pulse';
  }

  if (section === 'archived') {
    return 'bg-border-default';
  }

  return 'bg-teal';
}

function formatSessionTimestamp(session: SessionMeta): string {
  return timeAgo(session.lastActivityAt ?? session.timestamp);
}

function sectionMeta(
  session: SessionMeta,
  section: ConversationSection,
  linkedState: ConversationLinkState | undefined,
): string {
  const parts: string[] = [];

  if (section === 'pinned') {
    parts.push('pinned');
  }

  if (sessionNeedsAttention(session)) {
    parts.push('review');
  }

  if (session.isRunning && (linkedState?.activeCount ?? 0) === 0) {
    parts.push('running');
  } else if ((linkedState?.activeCount ?? 0) > 0) {
    parts.push(linkedRunActiveLabel(linkedState?.activeCount ?? 0));
  }

  if (session.model) {
    parts.push(session.model.split('/').pop() ?? session.model);
  }

  if (session.cwdSlug) {
    parts.push(session.cwdSlug);
  }

  return parts.join(' · ');
}

function ListActionRow({
  onClick,
  leading,
  timestamp,
  actions,
  children,
}: {
  onClick: () => void;
  leading: ReactNode;
  timestamp?: string | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cx('group', 'ui-list-row', 'ui-list-row-hover')}>
      {leading}
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-1 focus-visible:ring-offset-base"
      >
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">{children}</div>
          {timestamp ? <span className="shrink-0 pt-0.5 text-[11px] text-dim">{timestamp}</span> : null}
        </div>
      </button>
      {actions ? <div className="mt-0.5 flex shrink-0 flex-wrap items-center gap-2 self-start">{actions}</div> : null}
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

type ConversationListEntry = {
  session: SessionMeta;
  section: ConversationSection;
};

function buildConversationEntries(sessions: SessionMeta[], section: ConversationSection): ConversationListEntry[] {
  return sessions.map((session) => ({ session, section }));
}

function ConversationRows({
  entries,
  conversationLinkStates,
  onOpen,
  onPin,
  onUnpin,
  onClose,
  onMarkRead,
  busyId,
}: {
  entries: ConversationListEntry[];
  conversationLinkStates: ReadonlyMap<string, ConversationLinkState>;
  onOpen: (sessionId: string, options?: { restore?: boolean }) => void;
  onPin: (sessionId: string) => void;
  onUnpin: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onMarkRead: (sessionId: string) => void;
  busyId: string | null;
}) {
  return (
    <div className="space-y-0.5">
      {entries.map(({ session, section }) => {
        const archived = section === 'archived';
        const linkedState = conversationLinkStates.get(session.id);
        const meta = sectionMeta(session, section, linkedState);

        return (
          <ListActionRow
            key={session.id}
            onClick={() => onOpen(session.id, archived ? { restore: true } : undefined)}
            leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sectionDotClass(session, section, linkedState)}`} />}
            timestamp={formatSessionTimestamp(session)}
            actions={(
              <>
                {sessionNeedsReview(session) ? (
                  <button
                    type="button"
                    className={INLINE_ACTION_CLASS}
                    onClick={() => onMarkRead(session.id)}
                    disabled={busyId === session.id}
                    title="Mark as reviewed"
                  >
                    {busyId === session.id ? '…' : 'read'}
                  </button>
                ) : null}
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
                {!archived ? (
                  <button
                    type="button"
                    className={INLINE_ACTION_CLASS}
                    onClick={() => onClose(session.id)}
                    title="Archive conversation from the workspace"
                  >
                    close
                  </button>
                ) : null}
              </>
            )}
          >
            <p className="ui-row-title break-words">{session.title}</p>
            <p className="ui-row-summary">{session.messageCount} {session.messageCount === 1 ? 'message' : 'messages'}</p>
            {meta ? <p className="ui-row-meta break-words">{meta}</p> : null}
          </ListActionRow>
        );
      })}
    </div>
  );
}

function SectionBlock({
  label,
  entries,
  conversationLinkStates,
  onOpen,
  onPin,
  onUnpin,
  onClose,
  onMarkRead,
  busyId,
}: {
  label: string;
  entries: ConversationListEntry[];
  conversationLinkStates: ReadonlyMap<string, ConversationLinkState>;
  onOpen: (sessionId: string, options?: { restore?: boolean }) => void;
  onPin: (sessionId: string) => void;
  onUnpin: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onMarkRead: (sessionId: string) => void;
  busyId: string | null;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <section className="space-y-1">
      <SectionLabel label={label} count={entries.length} className="px-3 pb-1" />
      <ConversationRows
        entries={entries}
        conversationLinkStates={conversationLinkStates}
        onOpen={onOpen}
        onPin={onPin}
        onUnpin={onUnpin}
        onClose={onClose}
        onMarkRead={onMarkRead}
        busyId={busyId}
      />
    </section>
  );
}

function ArchivedSection({
  entries,
  expanded,
  collapsible,
  onToggle,
  conversationLinkStates,
  onOpen,
  onPin,
  onUnpin,
  onClose,
  onMarkRead,
  busyId,
}: {
  entries: ConversationListEntry[];
  expanded: boolean;
  collapsible: boolean;
  onToggle: () => void;
  conversationLinkStates: ReadonlyMap<string, ConversationLinkState>;
  onOpen: (sessionId: string, options?: { restore?: boolean }) => void;
  onPin: (sessionId: string) => void;
  onUnpin: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onMarkRead: (sessionId: string) => void;
  busyId: string | null;
}) {
  if (entries.length === 0) {
    return null;
  }

  if (!collapsible) {
    return (
      <SectionBlock
        label="Archived conversations"
        entries={entries}
        conversationLinkStates={conversationLinkStates}
        onOpen={onOpen}
        onPin={onPin}
        onUnpin={onUnpin}
        onClose={onClose}
        onMarkRead={onMarkRead}
        busyId={busyId}
      />
    );
  }

  return (
    <section className="space-y-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls="archived-conversations-list"
        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-base"
      >
        <div className="flex items-center gap-2">
          <span className="ui-section-label">Archived conversations</span>
          <span className="ui-section-count">{entries.length}</span>
        </div>
        <span className="text-[11px] text-dim">{expanded ? 'Hide' : 'Show'}</span>
      </button>

      {expanded ? (
        <div id="archived-conversations-list">
          <ConversationRows
            entries={entries}
            conversationLinkStates={conversationLinkStates}
            onOpen={onOpen}
            onPin={onPin}
            onUnpin={onUnpin}
            onClose={onClose}
            onMarkRead={onMarkRead}
            busyId={busyId}
          />
        </div>
      ) : null}
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
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [archivedExpanded, setArchivedExpanded] = useState(filter === 'all' || filter === 'archived');

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

  useEffect(() => {
    setArchivedExpanded(filter === 'all' || filter === 'archived');
  }, [filter]);

  const archivedConversationIdSet = useMemo(
    () => new Set(archivedConversationIds),
    [archivedConversationIds],
  );
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
      const metaParts = [workspaceLabel(workspace)];
      if (moment.at && moment.label !== 'updated') {
        metaParts.push(moment.label);
      }
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
        timestampLabel: moment.at ? timeAgo(moment.at) : null,
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
        meta: ['archived', session.model?.split('/').pop() ?? session.model, session.cwdSlug].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' · '),
        timestampLabel: formatSessionTimestamp(session),
        statusLabel: 'running',
        tone: 'accent' as const,
        searchText: [session.title, session.id, session.cwd, session.cwdSlug, session.model, 'running archived conversation'].filter((value): value is string => typeof value === 'string' && value.length > 0).join('\n').toLowerCase(),
        needsReview: false,
        active: true,
      }));

    return [...sortedRunItems, ...archivedRunningItems];
  }, [archivedConversationIdSet, archivedSessions, lookups, openIdSet, pinnedIdSet, runs?.runs, sessionsById]);
  const conversationLinkStates = useMemo(
    () => buildConversationLinkStates(conversationWorkItems),
    [conversationWorkItems],
  );
  const pinnedVisible = useMemo(
    () => filterSessions(pinnedSessions, query, { attentionOnly: filter === 'attention' }),
    [filter, pinnedSessions, query],
  );
  const openVisible = useMemo(
    () => filterSessions(tabs, query, { attentionOnly: filter === 'attention' }),
    [filter, query, tabs],
  );
  const archivedVisible = useMemo(
    () => filter === 'attention'
      ? filterSessions(archivedSessions, query, { attentionOnly: true, excludedSessionIds: archivedConversationIdSet })
      : filterSessions(archivedSessions, query),
    [archivedConversationIdSet, archivedSessions, filter, query],
  );
  const openEntries = useMemo(
    () => filter === 'archived'
      ? []
      : [
          ...buildConversationEntries(pinnedVisible, 'pinned'),
          ...buildConversationEntries(openVisible, 'open'),
        ],
    [filter, openVisible, pinnedVisible],
  );
  const archivedEntries = useMemo(
    () => buildConversationEntries(archivedVisible, 'archived'),
    [archivedVisible],
  );
  const archivedRunningConversationCount = useMemo(
    () => new Set(conversationWorkItems.filter((item) => item.workspace === 'archived' && item.active).map((item) => item.conversationId)).size,
    [conversationWorkItems],
  );
  const archivedCollapsible = filter === 'open' || filter === 'attention';
  const showArchivedRows = !archivedCollapsible || archivedExpanded;
  const hasVisibleContent = openEntries.length > 0 || archivedEntries.length > 0;
  const visibleItemCount = openEntries.length + (showArchivedRows ? archivedEntries.length : 0);
  const hasWorkspaceConversations = pinnedSessions.length + tabs.length + archivedSessions.length > 0;
  const filteredEmptyState = emptyStateCopy(filter, hasWorkspaceConversations);

  const handleOpen = useCallback((sessionId: string, options?: { restore?: boolean }) => {
    if (options?.restore) {
      restoreSession(sessionId);
    }
    navigate(`/conversations/${encodeURIComponent(sessionId)}`);
  }, [navigate, restoreSession]);

  const handleMarkRead = useCallback(async (sessionId: string) => {
    if (busyConversationId) {
      return;
    }

    setBusyConversationId(sessionId);
    setPageError(null);
    try {
      await api.markConversationAttentionRead(sessionId);
      await refetch();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Could not mark the conversation as reviewed.');
    } finally {
      setBusyConversationId(null);
    }
  }, [busyConversationId, refetch]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) {
      return;
    }

    setRefreshing(true);
    setPageError(null);

    const [sessionsResult, runsResult] = await Promise.allSettled([
      refetch(),
      api.runs(),
    ]);

    if (runsResult.status === 'fulfilled') {
      setRuns(runsResult.value);
    }

    const sessionError = sessionsResult.status === 'rejected'
      ? (sessionsResult.reason instanceof Error ? sessionsResult.reason.message : 'Could not refresh conversations.')
      : null;
    const runsError = runsResult.status === 'rejected'
      ? (runsResult.reason instanceof Error ? runsResult.reason.message : 'Could not refresh background runs.')
      : null;

    if (sessionError || runsError) {
      setPageError([sessionError, runsError].filter(Boolean).join(' '));
    }

    setRefreshing(false);
  }, [refetch, refreshing, setRuns]);

  return (
    <div className="min-h-0 flex h-full flex-col overflow-hidden">
      <PageHeader
        actions={(
          <>
            <ToolbarButton onClick={() => navigate('/conversations/new')}>+ New chat</ToolbarButton>
            <ToolbarButton onClick={() => { void handleRefresh(); }} disabled={refreshing} aria-label="Refresh conversations">
              {refreshing ? 'Refreshing…' : 'Refresh'}
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
              {archivedRunningConversationCount > 0 && <span className="ml-2 text-secondary">· {archivedRunningConversationCount} archived still running</span>}
            </>
          )}
        />
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4">
          {loading ? <LoadingState label="Loading conversations…" className="py-10" /> : (
            <>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="ui-segmented-control" role="group" aria-label="Conversation filter">
                  {([
                    ['open', 'Open'],
                    ['attention', 'Needs review'],
                    ['archived', 'Archived'],
                    ['all', 'All'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => navigate(buildConversationFilterHref(value))}
                      className={filter === value ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 text-[11px] text-dim">
                  <span>{conversationFilterLabel(filter)}</span>
                  <span className="opacity-40">·</span>
                  <span>{visibleItemCount} visible</span>
                </div>
              </div>

              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search titles, IDs, cwd, or models"
                aria-label="Search conversations"
                className={INPUT_CLASS}
                autoComplete="off"
                spellCheck={false}
              />

              {pageError ? <p className="text-[11px] text-danger">{pageError}</p> : null}

              {!hasVisibleContent ? (
                <EmptyState
                  className="py-10"
                  title={query.trim() ? 'No conversations match that search.' : filteredEmptyState.title}
                  body={query.trim()
                    ? 'Try a broader search across titles, IDs, cwd, and model names.'
                    : filteredEmptyState.body}
                  action={<ToolbarButton onClick={() => navigate('/conversations/new')}>Start a conversation</ToolbarButton>}
                />
              ) : (
                <div className="space-y-5">
                  <SectionBlock
                    label="Open conversations"
                    entries={openEntries}
                    conversationLinkStates={conversationLinkStates}
                    onOpen={handleOpen}
                    onPin={pinSession}
                    onUnpin={unpinSession}
                    onClose={archiveSession}
                    onMarkRead={handleMarkRead}
                    busyId={busyConversationId}
                  />

                  <ArchivedSection
                    entries={archivedEntries}
                    expanded={showArchivedRows}
                    collapsible={archivedCollapsible}
                    onToggle={() => setArchivedExpanded((current) => !current)}
                    conversationLinkStates={conversationLinkStates}
                    onOpen={handleOpen}
                    onPin={pinSession}
                    onUnpin={unpinSession}
                    onClose={archiveSession}
                    onMarkRead={handleMarkRead}
                    busyId={busyConversationId}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
