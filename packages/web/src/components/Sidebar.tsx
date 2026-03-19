import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ConversationStatusText } from './ConversationStatusText';
import { Keycap } from './ui';
import { api } from '../api';
import { openCommandPalette } from '../commandPaletteEvents';
import { buildDeferredResumeIndicatorText } from '../deferredResumeIndicator';
import { useApi } from '../hooks';
import { useConversations } from '../hooks/useConversations';
import { useAppData } from '../contexts';
import { sessionNeedsAttention } from '../sessionIndicators';
import type { ConversationShelf, OpenConversationDropPosition } from '../sessionTabs';
import type { SessionMeta } from '../types';
import {
  buildDraftConversationSessionMeta,
  clearDraftConversationAttachments,
  clearDraftConversationComposer,
  clearDraftConversationCwd,
  DRAFT_CONVERSATION_ID,
  DRAFT_CONVERSATION_ROUTE,
  DRAFT_CONVERSATION_STATE_CHANGED_EVENT,
  hasDraftConversationAttachments,
  readDraftConversationComposer,
  readDraftConversationCwd,
  shouldShowDraftConversationTab,
} from '../draftConversation';
import { getSidebarBrandLabel } from '../sidebarBrand';
import { buildNestedSessionRows } from '../sessionLineage';
import { summarizeActiveRuns } from '../runPresentation';
import { timeAgo } from '../utils';

// ── Icons ──────────────────────────────────────────────────────────────────

function Ico({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const PATH = {
  inbox:    'M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z',
  search:   'M21 21l-4.35-4.35m1.6-5.15a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Z',
  gateway:  'M7.5 7.5 3.75 12l3.75 4.5m9-9 3.75 4.5-3.75 4.5M20.25 12H3.75',
  automation: 'M6 6h5v5H6zM13 13h5v5h-5zM11 8.5h2M12 9.5v5M8.5 11v2M15.5 11v2',
  daemon:   'M6 4.5h12A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5Zm0 3.75h12M6 12h12M6 15.75h12',
  sync:     'M4.5 12a7.5 7.5 0 0 1 12.803-5.303M19.5 12a7.5 7.5 0 0 1-12.803 5.303M16.5 3.75v3h-3m-3 10.5h3v3',
  system:   'M4.5 7.5h15m-15 4.5h15m-15 4.5h15M6.75 4.5h10.5A2.25 2.25 0 0 1 19.5 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 17.25V6.75A2.25 2.25 0 0 1 6.75 4.5Z',
  web:      'M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25H13.5l-3 3v-3H6.75A2.25 2.25 0 0 1 4.5 14.25v-7.5Z',
  projects: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z',
  runs:     'M4.5 6.75h15M4.5 12h15M4.5 17.25h9m4.5-1.5 1.5 1.5 3-3',
  tasks:    'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  memory:      'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25',
  tools:       'M14.7 6.3a2.25 2.25 0 1 0 3 3L21 12.6l-2.4 2.4-3.3-3.3a2.25 2.25 0 1 0-3-3L3 18v3h3l9.3-9.3Z',
  settings:    'M10.5 6h3m-1.5-3v6m4.348-2.826 2.121 2.121m-12.728 0 2.121-2.121m8.486 8.486 2.121 2.121m-12.728 0 2.121-2.121M6 10.5H3m18 0h-3m-5.25 7.5v3m0-18v3',
  close:       'M6 18 18 6M6 6l12 12',
  pin:         'M12 17.25v4.5m0-4.5-4.243-4.243a1.5 1.5 0 0 1-.44-1.06V5.25L6.287 4.22A.75.75 0 0 1 6.818 3h10.364a.75.75 0 0 1 .53 1.28l-1.03 1.03v6.697a1.5 1.5 0 0 1-.44 1.06L12 17.25Z',
  unpin:       'M12 4.5v10.5m0 0-3-3m3 3 3-3M5.25 19.5h13.5',
};

const SIDEBAR_NEW_CHAT_HOTKEY = 'Ctrl+Shift+N';
const SIDEBAR_PREVIOUS_CHAT_HOTKEY = 'Ctrl+Shift+[';
const SIDEBAR_NEXT_CHAT_HOTKEY = 'Ctrl+Shift+]';
const SIDEBAR_SEARCH_HOTKEY = '⌘K';

function normalizeHotkeyKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function matchesLetterHotkey(event: KeyboardEvent, code: string, letter: string): boolean {
  return event.code === code || normalizeHotkeyKey(event.key) === letter;
}

function hasOverlayOpen(): boolean {
  return document.querySelector('.ui-overlay-backdrop') !== null;
}

// ── Top nav item ───────────────────────────────────────────────────────────

function TopNavItem({
  to,
  icon,
  label,
  badge,
  title,
}: {
  to: string;
  icon: string;
  label: string;
  badge?: number | null;
  title?: string;
}) {
  return (
    <NavLink
      to={to}
      title={title}
      className={({ isActive }) => [
        'ui-sidebar-nav-item',
        isActive && 'ui-sidebar-nav-item-active',
      ].filter(Boolean).join(' ')}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
        className="shrink-0 opacity-70">
        <path d={icon} />
      </svg>
      <span className="flex-1">{label}</span>
      {badge != null && badge > 0 && (
        <span className="ui-sidebar-nav-badge">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}

function TopActionButton({
  icon,
  label,
  badge,
  shortcut,
  isActive = false,
  title,
  onClick,
}: {
  icon: string;
  label: string;
  badge?: number | string | null;
  shortcut?: string;
  isActive?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-haspopup="dialog"
      aria-expanded={isActive}
      className={[
        'ui-sidebar-nav-item w-full',
        isActive && 'ui-sidebar-nav-item-active',
      ].filter(Boolean).join(' ')}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
        className="shrink-0 opacity-70">
        <path d={icon} />
      </svg>
      <span className="flex-1 text-left truncate">{label}</span>
      {shortcut ? (
        <Keycap className="ml-auto shrink-0">{shortcut}</Keycap>
      ) : badge != null ? (
        <span className="ui-sidebar-nav-badge">{badge}</span>
      ) : null}
    </button>
  );
}

function cwdLabel(cwd: string, maxLen = 24): string {
  const parts = cwd.split('/').filter(Boolean);
  const label = parts[parts.length - 1] ?? cwd;
  return label.length > maxLen ? label.slice(0, maxLen - 1) + '…' : label;
}

function getActiveConversationId(pathname: string): string | null {
  const match = pathname.match(/^\/conversations\/([^/]+)$/);
  if (!match || match[1] === 'new') {
    return null;
  }

  return decodeURIComponent(match[1]);
}

// ── Conversation shelf rows ───────────────────────────────────────────────

function OpenTab({
  session,
  needsAttention,
  canDrag,
  isDragging,
  dropPosition,
  depth = 0,
  nestedUnderTitle,
  actions = [],
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  nowMs,
}: {
  session: SessionMeta;
  needsAttention?: boolean;
  canDrag: boolean;
  isDragging?: boolean;
  dropPosition?: OpenConversationDropPosition | null;
  depth?: number;
  nestedUnderTitle?: string;
  actions?: Array<{
    key: string;
    title: string;
    icon: string;
    onClick: () => void;
  }>;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
  nowMs?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const location = useLocation();
  const isActive = location.pathname === `/conversations/${session.id}`;
  const deferredResumes = session.deferredResumes ?? [];
  const deferredResumeText = deferredResumes.length > 0
    ? buildDeferredResumeIndicatorText(deferredResumes, nowMs ?? Date.now())
    : null;
  const hasReadyDeferredResumes = deferredResumes.some((resume) => resume.status === 'ready');
  const title = [
    depth > 0 && nestedUnderTitle ? `Nested under ${nestedUnderTitle}` : undefined,
    canDrag ? 'Drag to move' : undefined,
  ].filter((value): value is string => Boolean(value)).join(' · ') || undefined;

  return (
    <div
      className="relative"
      style={depth > 0 ? { paddingLeft: `${depth * 14}px` } : undefined}
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrag ? onDragOver : undefined}
      onDrop={canDrag ? onDrop : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
    >
      {dropPosition && (
        <span
          aria-hidden="true"
          className={[
            'pointer-events-none absolute left-4 right-4 z-10 h-0.5 rounded-full bg-accent/80',
            dropPosition === 'before' ? 'top-0' : 'bottom-0',
          ].join(' ')}
        />
      )}

      <NavLink
        to={`/conversations/${session.id}`}
        draggable={false}
        className={[
          'ui-sidebar-session-row select-none',
          isActive && 'ui-sidebar-session-row-active',
          canDrag && (isDragging ? 'cursor-grabbing opacity-60' : 'cursor-grab'),
        ].filter(Boolean).join(' ')}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={title}
      >
        <span
          aria-hidden="true"
          className={[
            'mt-0.5 self-stretch w-px rounded-full shrink-0 transition-colors',
            isActive ? 'bg-accent/80' : 'bg-border-subtle',
          ].join(' ')}
        />

        <div className="flex-1 min-w-0">
          <p className="ui-row-title truncate">{depth > 0 ? `↳ ${session.title}` : session.title}</p>
          <p className="ui-sidebar-session-meta flex items-center gap-1.5 min-w-0">
            <span className="shrink-0">{timeAgo(session.timestamp)}</span>
            <span className="shrink-0 opacity-40">·</span>
            <span className="truncate min-w-0 opacity-55" title={session.cwd}>{cwdLabel(session.cwd)}</span>
            {(session.isRunning || needsAttention) && (
              <>
                <span className="shrink-0 opacity-40">·</span>
                <ConversationStatusText
                  isRunning={session.isRunning}
                  needsAttention={needsAttention}
                  className="shrink-0"
                />
              </>
            )}
          </p>
          {deferredResumeText && (
            <p
              className="ui-sidebar-session-meta mt-1 flex items-center gap-1.5 min-w-0"
              title={`Deferred resume status: ${deferredResumeText}`}
            >
              <span className={[
                'shrink-0',
                hasReadyDeferredResumes ? 'text-warning' : 'text-accent',
              ].join(' ')}>
                <Ico d={PATH.tasks} size={11} />
              </span>
              <span className="min-w-0 truncate">
                <span className="text-secondary">Deferred </span>
                <span className={hasReadyDeferredResumes ? 'text-warning' : 'text-accent'}>{deferredResumeText}</span>
              </span>
            </p>
          )}
        </div>

        <div className="shrink-0 mt-0.5 min-w-[34px] flex items-center justify-end gap-0.5">
          {hovered && actions.length > 0 ? actions.map((action) => (
            <button
              key={action.key}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                action.onClick();
              }}
              className="ui-icon-button ui-icon-button-compact"
              title={action.title}
            >
              <Ico d={action.icon} size={10} />
            </button>
          )) : null}
        </div>
      </NavLink>
    </div>
  );
}

function SectionHeader({
  label,
  count,
  title,
}: {
  label: string;
  count?: number | string;
  title?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pt-2 pb-1" title={title}>
      <span className="ui-section-label">{label}</span>
      {count != null && <span className="ui-section-count ml-auto">{count}</span>}
    </div>
  );
}

function ShelfDropZone({
  label,
  active,
  onDragOver,
  onDrop,
}: {
  label: string;
  active?: boolean;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={[
        'mx-3 rounded-lg border border-dashed px-3 py-2 text-[11px] text-dim transition-colors',
        active ? 'border-accent/60 bg-accent/8 text-accent' : 'border-border-subtle bg-elevated/35',
      ].join(' ')}
    >
      {label}
    </div>
  );
}

function SidebarFooter({
  activeRunCount,
  agentRunsTitle,
}: {
  activeRunCount: number;
  agentRunsTitle: string;
}) {
  return (
    <div className="border-t border-border-subtle px-2 py-2 shrink-0 space-y-0.5">
      <TopNavItem
        to="/runs"
        icon={PATH.runs}
        label="Agent Runs"
        badge={activeRunCount}
        title={agentRunsTitle}
      />
      <TopNavItem
        to="/system"
        icon={PATH.system}
        label="System"
        title="Consolidated status for the daemon, sync, gateway, and managed web UI."
      />
      <TopNavItem to="/settings" icon={PATH.settings} label="Settings" />
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activity, runs, sessions, tasks } = useAppData();
  const { data: status } = useApi(api.status);
  const {
    pinnedSessions,
    tabs,
    archivedSessions,
    closeSession,
    pinSession,
    unpinSession,
    moveSession,
    loading,
  } = useConversations();
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const [draggingSection, setDraggingSection] = useState<ConversationShelf | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    section: ConversationShelf;
    sessionId: string | null;
    position: OpenConversationDropPosition;
  } | null>(null);
  const allSessions = useMemo(() => [...pinnedSessions, ...tabs, ...archivedSessions], [archivedSessions, pinnedSessions, tabs]);
  const activeConversationId = useMemo(() => getActiveConversationId(location.pathname), [location.pathname]);
  const automationTarget = '/automation';
  const attentionIds = useMemo(
    () => new Set(allSessions.filter((session) => sessionNeedsAttention(session)).map((session) => session.id)),
    [allSessions],
  );
  const standaloneUnreadCount = useMemo(() => {
    const knownConversationIds = new Set(allSessions.map((session) => session.id));
    return (activity?.entries ?? []).filter((entry) => {
      if (entry.read) {
        return false;
      }

      return !(entry.relatedConversationIds ?? []).some((conversationId) => knownConversationIds.has(conversationId));
    }).length;
  }, [activity?.entries, allSessions]);
  const inboxCount = standaloneUnreadCount + archivedSessions.filter((session) => sessionNeedsAttention(session)).length;
  const activeRuns = useMemo(() => summarizeActiveRuns({ tasks, sessions, runs }), [runs, sessions, tasks]);
  const agentRunsTitle = useMemo(() => {
    const base = 'Daemon-backed agent runs: scheduled task runs, deferred resumes, and recoverable conversation runs.';
    if (activeRuns.total === 0) {
      return base;
    }

    const breakdown: string[] = [];
    if (activeRuns.conversation > 0) {
      breakdown.push(`${activeRuns.conversation} conversation${activeRuns.conversation === 1 ? '' : 's'}`);
    }
    if (activeRuns.scheduled > 0) {
      breakdown.push(`${activeRuns.scheduled} scheduled`);
    }
    if (activeRuns.background > 0) {
      breakdown.push(`${activeRuns.background} background`);
    }
    if (activeRuns.deferred > 0) {
      breakdown.push(`${activeRuns.deferred} deferred`);
    }
    if (activeRuns.other > 0) {
      breakdown.push(`${activeRuns.other} other`);
    }

    return `${base} ${activeRuns.total} active now${breakdown.length > 0 ? ` · ${breakdown.join(' · ')}` : ''}.`;
  }, [activeRuns]);
  const [draftComposer, setDraftComposer] = useState(() => readDraftConversationComposer());
  const [draftCwd, setDraftCwd] = useState(() => readDraftConversationCwd());
  const [draftHasAttachments, setDraftHasAttachments] = useState(() => hasDraftConversationAttachments());
  const draftTab = useMemo(() => {
    if (!shouldShowDraftConversationTab(location.pathname, draftComposer, draftCwd, draftHasAttachments)) {
      return null;
    }

    return buildDraftConversationSessionMeta(undefined, draftCwd);
  }, [draftComposer, draftCwd, draftHasAttachments, location.pathname]);
  const visibleTabs = useMemo(
    () => draftTab ? [...tabs, draftTab] : tabs,
    [draftTab, tabs],
  );
  const runsById = useMemo(
    () => new Map((runs?.runs ?? []).map((run) => [run.runId, run] as const)),
    [runs],
  );
  const pinnedSessionRows = useMemo(
    () => buildNestedSessionRows(pinnedSessions, runsById),
    [pinnedSessions, runsById],
  );
  const openSessionRows = useMemo(
    () => buildNestedSessionRows(visibleTabs, runsById),
    [runsById, visibleTabs],
  );
  const pinnedSessionsById = useMemo(
    () => new Map(pinnedSessions.map((session) => [session.id, session] as const)),
    [pinnedSessions],
  );
  const openSessionsById = useMemo(
    () => new Map(visibleTabs.map((session) => [session.id, session] as const)),
    [visibleTabs],
  );
  const [deferredResumeNowMs, setDeferredResumeNowMs] = useState(() => Date.now());
  const visibleSessionDeferredResumeCount = useMemo(
    () => [...pinnedSessions, ...visibleTabs].reduce((count, session) => count + (session.deferredResumes?.length ?? 0), 0),
    [pinnedSessions, visibleTabs],
  );

  useEffect(() => {
    if (visibleSessionDeferredResumeCount === 0) {
      return;
    }

    setDeferredResumeNowMs(Date.now());
    const intervalHandle = window.setInterval(() => {
      setDeferredResumeNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalHandle);
    };
  }, [visibleSessionDeferredResumeCount]);

  useEffect(() => {
    function syncDraftState() {
      setDraftComposer(readDraftConversationComposer());
      setDraftCwd(readDraftConversationCwd());
      setDraftHasAttachments(hasDraftConversationAttachments());
    }

    syncDraftState();
    window.addEventListener(DRAFT_CONVERSATION_STATE_CHANGED_EVENT, syncDraftState);
    return () => {
      window.removeEventListener(DRAFT_CONVERSATION_STATE_CHANGED_EVENT, syncDraftState);
    };
  }, [location.pathname]);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }

    const activeSession = allSessions.find((session) => session.id === activeConversationId);
    if (!activeSession || !sessionNeedsAttention(activeSession)) {
      return;
    }

    void api.markConversationAttentionRead(activeSession.id).catch(() => {
      // Ignore optimistic attention-clear failures; SSE or manual refresh can recover.
    });
  }, [activeConversationId, allSessions]);

  function clearDragState() {
    setDraggingSessionId(null);
    setDraggingSection(null);
    setDropTarget(null);
  }

  function getDropPosition(event: DragEvent<HTMLDivElement>): OpenConversationDropPosition {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
  }

  function handleTabDragStart(section: ConversationShelf, sessionId: string, event: DragEvent<HTMLDivElement>) {
    setDraggingSessionId(sessionId);
    setDraggingSection(section);
    setDropTarget(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sessionId);
  }

  function handleTabDragOver(section: ConversationShelf, sessionId: string, event: DragEvent<HTMLDivElement>) {
    const draggedId = draggingSessionId ?? event.dataTransfer.getData('text/plain');
    if (!draggedId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (draggedId === sessionId && draggingSection === section) {
      setDropTarget(null);
      return;
    }

    const position = getDropPosition(event);
    setDropTarget((current) => (
      current?.section === section && current.sessionId === sessionId && current.position === position
        ? current
        : { section, sessionId, position }
    ));
  }

  function handleEmptyShelfDragOver(section: ConversationShelf, event: DragEvent<HTMLDivElement>) {
    const draggedId = draggingSessionId ?? event.dataTransfer.getData('text/plain');
    if (!draggedId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget((current) => (
      current?.section === section && current.sessionId === null
        ? current
        : { section, sessionId: null, position: 'after' }
    ));
  }

  function handleConversationDrop(targetSection: ConversationShelf, targetSessionId: string | null, position: OpenConversationDropPosition) {
    if (!draggingSessionId) {
      clearDragState();
      return;
    }

    if (targetSessionId === draggingSessionId && draggingSection === targetSection) {
      clearDragState();
      return;
    }

    moveSession(draggingSessionId, targetSection, targetSessionId, position);
    clearDragState();
  }

  function handleTabDrop(section: ConversationShelf, sessionId: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    handleConversationDrop(section, sessionId, getDropPosition(event));
  }

  function handleEmptyShelfDrop(section: ConversationShelf, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    handleConversationDrop(section, null, 'after');
  }

  function handleCloseDraftTab() {
    clearDraftConversationAttachments();
    clearDraftConversationComposer();
    clearDraftConversationCwd();
    setDraftComposer('');
    setDraftCwd('');
    setDraftHasAttachments(false);

    if (draggingSessionId === DRAFT_CONVERSATION_ID) {
      clearDragState();
    }

    if (location.pathname !== DRAFT_CONVERSATION_ROUTE) {
      return;
    }

    const nextConversation = tabs[0] ?? pinnedSessions[0];
    if (nextConversation) {
      navigate(`/conversations/${nextConversation.id}`);
      return;
    }

    navigate('/inbox');
  }

  function handleCloseTab(sessionId: string) {
    const isActive = location.pathname === `/conversations/${sessionId}`;
    closeSession(sessionId);

    if (draggingSessionId === sessionId) {
      clearDragState();
    }

    if (!isActive) {
      return;
    }

    const remainingTabs = tabs.filter((session) => session.id !== sessionId);
    const nextConversation = remainingTabs[0] ?? pinnedSessions[0];
    if (nextConversation) {
      navigate(`/conversations/${nextConversation.id}`);
      return;
    }

    navigate('/inbox');
  }

  function handlePinConversation(sessionId: string) {
    pinSession(sessionId);
    if (draggingSessionId === sessionId) {
      clearDragState();
    }
  }

  function handleUnpinConversation(sessionId: string) {
    unpinSession(sessionId, { open: true });
    if (draggingSessionId === sessionId) {
      clearDragState();
    }
  }

  function handleClosePinnedTab(sessionId: string) {
    const isActive = location.pathname === `/conversations/${sessionId}`;
    unpinSession(sessionId, { open: false });

    if (draggingSessionId === sessionId) {
      clearDragState();
    }

    if (!isActive) {
      return;
    }

    const remainingPinnedSessions = pinnedSessions.filter((session) => session.id !== sessionId);
    const nextConversation = remainingPinnedSessions[0] ?? tabs[0];
    if (nextConversation) {
      navigate(`/conversations/${nextConversation.id}`);
      return;
    }

    navigate('/inbox');
  }

  const handleNewConversation = useCallback(() => {
    navigate('/conversations/new');
  }, [navigate]);

  const handleOpenSearch = useCallback(() => {
    openCommandPalette();
  }, []);

  const navigateOpenConversation = useCallback((direction: -1 | 1) => {
    if (tabs.length === 0) {
      return;
    }

    const activeIndex = activeConversationId
      ? tabs.findIndex((session) => session.id === activeConversationId)
      : -1;

    if (activeIndex === -1) {
      const fallbackIndex = direction > 0 ? 0 : tabs.length - 1;
      navigate(`/conversations/${tabs[fallbackIndex].id}`);
      return;
    }

    const nextIndex = (activeIndex + direction + tabs.length) % tabs.length;
    navigate(`/conversations/${tabs[nextIndex].id}`);
  }, [activeConversationId, navigate, tabs]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      if (hasOverlayOpen()) {
        return;
      }

      if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) {
        return;
      }

      const key = normalizeHotkeyKey(event.key);
      if (matchesLetterHotkey(event, 'KeyN', 'n')) {
        event.preventDefault();
        handleNewConversation();
        return;
      }

      if (event.code === 'BracketLeft' || key === '[' || key === '{') {
        event.preventDefault();
        navigateOpenConversation(-1);
        return;
      }

      if (event.code === 'BracketRight' || key === ']' || key === '}') {
        event.preventDefault();
        navigateOpenConversation(1);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNewConversation, navigateOpenConversation]);

  const pinnedDropTargetActive = dropTarget?.section === 'pinned' && dropTarget.sessionId === null;
  const openDropTargetActive = dropTarget?.section === 'open' && dropTarget.sessionId === null;

  return (
    <aside className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <div className="ui-brand-mark">
          <span className="ui-brand-mark-text">pa</span>
        </div>
        <span className="text-[13px] font-semibold text-primary truncate flex-1">{getSidebarBrandLabel(status?.profile)}</span>
      </div>

      <div className="pb-1 space-y-0.5">
        <TopNavItem to="/inbox" icon={PATH.inbox} label="Inbox" badge={inboxCount} />
        <TopActionButton
          icon={PATH.search}
          label="Search"
          shortcut={SIDEBAR_SEARCH_HOTKEY}
          title={`Open unified search (${SIDEBAR_SEARCH_HOTKEY})`}
          onClick={handleOpenSearch}
        />
        <TopNavItem to={automationTarget} icon={PATH.automation} label="Automation" title="Open the full-page workflow editor for the active conversation." />
        <TopNavItem to="/scheduled" icon={PATH.tasks} label="Scheduled" />
        <TopNavItem to="/projects" icon={PATH.projects} label="Projects" />
        <TopNavItem to="/memories" icon={PATH.memory} label="Memories" />
        <TopNavItem to="/tools" icon={PATH.tools} label="Tools" />
      </div>

      <div className="mx-3 border-t border-border-subtle my-2" />

      <div className="px-1 pb-2">
        <button
          onClick={handleNewConversation}
          className="ui-sidebar-nav-item"
          style={{ width: 'calc(100% - 8px)' }}
          title={`New chat (${SIDEBAR_NEW_CHAT_HOTKEY})`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70"><path d="M12 5v14M5 12h14"/></svg>
          New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 pb-2">
        <SectionHeader
          label="Pinned"
          count={loading ? '…' : pinnedSessions.length}
          title="Pinned conversations stay visible above your open tabs. Drag tabs here to pin them."
        />
        <div className="py-1 space-y-0.5">
          {!loading && pinnedSessions.length === 0 && (
            <ShelfDropZone
              label={draggingSection === 'open'
                ? 'Drop a conversation here to pin it.'
                : 'Drag conversations here to pin them.'}
              active={pinnedDropTargetActive}
              onDragOver={(event) => handleEmptyShelfDragOver('pinned', event)}
              onDrop={(event) => handleEmptyShelfDrop('pinned', event)}
            />
          )}
          {pinnedSessionRows.map(({ session, depth, parentSessionId }) => {
            const canDrag = depth === 0;
            const dropPosition = canDrag && dropTarget?.section === 'pinned' && dropTarget.sessionId === session.id && draggingSessionId !== session.id
              ? dropTarget.position
              : null;
            const nestedUnderTitle = parentSessionId ? pinnedSessionsById.get(parentSessionId)?.title : undefined;

            return (
              <OpenTab
                key={session.id}
                session={session}
                needsAttention={attentionIds.has(session.id)}
                canDrag={canDrag}
                isDragging={canDrag && draggingSessionId === session.id}
                dropPosition={dropPosition}
                depth={depth}
                nestedUnderTitle={nestedUnderTitle}
                nowMs={deferredResumeNowMs}
                actions={depth > 0 ? [{
                  key: 'unpin',
                  title: 'Move to open conversations',
                  icon: PATH.unpin,
                  onClick: () => handleUnpinConversation(session.id),
                }, {
                  key: 'close',
                  title: 'Close tab',
                  icon: PATH.close,
                  onClick: () => handleClosePinnedTab(session.id),
                }] : [{
                  key: 'unpin',
                  title: 'Move to open conversations',
                  icon: PATH.unpin,
                  onClick: () => handleUnpinConversation(session.id),
                }]}
                onDragStart={canDrag ? (event) => handleTabDragStart('pinned', session.id, event) : undefined}
                onDragOver={canDrag ? (event) => handleTabDragOver('pinned', session.id, event) : undefined}
                onDrop={canDrag ? (event) => handleTabDrop('pinned', session.id, event) : undefined}
                onDragEnd={canDrag ? () => clearDragState() : undefined}
              />
            );
          })}
        </div>

        <SectionHeader
          label="Open conversations"
          count={loading ? '…' : visibleTabs.length}
          title={`Navigate between open conversations with ${SIDEBAR_PREVIOUS_CHAT_HOTKEY} and ${SIDEBAR_NEXT_CHAT_HOTKEY}`}
        />
        <div className="py-1 space-y-0.5 min-h-0">
          {!loading && tabs.length === 0 && draggingSection === 'pinned' && (
            <ShelfDropZone
              label="Drop here to move back into open conversations."
              active={openDropTargetActive}
              onDragOver={(event) => handleEmptyShelfDragOver('open', event)}
              onDrop={(event) => handleEmptyShelfDrop('open', event)}
            />
          )}
          {!loading && visibleTabs.length === 0 && draggingSection !== 'pinned' && (
            <p className="px-4 py-2 text-[12px] text-dim">
              No open conversations yet.
            </p>
          )}
          {openSessionRows.map(({ session, depth, parentSessionId }) => {
            const isDraftTab = session.id === DRAFT_CONVERSATION_ID;
            const canDrag = !isDraftTab && depth === 0;
            const dropPosition = canDrag && dropTarget?.section === 'open' && dropTarget.sessionId === session.id && draggingSessionId !== session.id
              ? dropTarget.position
              : null;
            const nestedUnderTitle = parentSessionId ? openSessionsById.get(parentSessionId)?.title : undefined;

            return (
              <OpenTab
                key={session.id}
                session={session}
                needsAttention={!isDraftTab && attentionIds.has(session.id)}
                canDrag={canDrag}
                isDragging={canDrag && draggingSessionId === session.id}
                dropPosition={dropPosition}
                depth={depth}
                nestedUnderTitle={nestedUnderTitle}
                nowMs={deferredResumeNowMs}
                actions={isDraftTab ? [{
                  key: 'close',
                  title: 'Close draft',
                  icon: PATH.close,
                  onClick: handleCloseDraftTab,
                }] : [{
                  key: 'pin',
                  title: 'Pin conversation',
                  icon: PATH.pin,
                  onClick: () => handlePinConversation(session.id),
                }, {
                  key: 'close',
                  title: 'Close tab',
                  icon: PATH.close,
                  onClick: () => handleCloseTab(session.id),
                }]}
                onDragStart={canDrag ? (event) => handleTabDragStart('open', session.id, event) : undefined}
                onDragOver={canDrag ? (event) => handleTabDragOver('open', session.id, event) : undefined}
                onDrop={canDrag ? (event) => handleTabDrop('open', session.id, event) : undefined}
                onDragEnd={canDrag ? () => clearDragState() : undefined}
              />
            );
          })}
        </div>
      </div>

      <SidebarFooter activeRunCount={activeRuns.total} agentRunsTitle={agentRunsTitle} />
    </aside>
  );
}
