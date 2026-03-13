import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ArchivedConversationsModal } from './ArchivedConversationsModal';
import { ConversationStatusText } from './ConversationStatusText';
import { api } from '../api';
import { useConversations } from '../hooks/useConversations';
import { useAppData } from '../contexts';
import { sessionNeedsAttention } from '../sessionIndicators';
import { reorderOpenSessionIds, type OpenConversationDropPosition } from '../sessionTabs';
import type { SessionMeta } from '../types';
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
  archive:  'M20.25 7.5v10.125c0 1.243-1.007 2.25-2.25 2.25H6c-1.243 0-2.25-1.007-2.25-2.25V7.5m16.5 0-2.394-2.992A2.25 2.25 0 0 0 16.099 3.75H7.901a2.25 2.25 0 0 0-1.757.758L3.75 7.5m16.5 0H3.75m5.25 4.5h6',
  gateway:  'M7.5 7.5 3.75 12l3.75 4.5m9-9 3.75 4.5-3.75 4.5M20.25 12H3.75',
  daemon:   'M6 4.5h12A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5Zm0 3.75h12M6 12h12M6 15.75h12',
  web:      'M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25H13.5l-3 3v-3H6.75A2.25 2.25 0 0 1 4.5 14.25v-7.5Z',
  projects: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z',
  runs:     'M4.5 6.75h15M4.5 12h15M4.5 17.25h9m4.5-1.5 1.5 1.5 3-3',
  tasks:    'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  memory:      'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25',
  tools:       'M14.7 6.3a2.25 2.25 0 1 0 3 3L21 12.6l-2.4 2.4-3.3-3.3a2.25 2.25 0 1 0-3-3L3 18v3h3l9.3-9.3Z',
  settings:    'M10.5 6h3m-1.5-3v6m4.348-2.826 2.121 2.121m-12.728 0 2.121-2.121m8.486 8.486 2.121 2.121m-12.728 0 2.121-2.121M6 10.5H3m18 0h-3m-5.25 7.5v3m0-18v3',
  close:       'M6 18 18 6M6 6l12 12',
  grip:        'M9 7.5h.01M9 12h.01M9 16.5h.01M15 7.5h.01M15 12h.01M15 16.5h.01',
};

const SIDEBAR_NEW_CHAT_HOTKEY = 'Ctrl+Shift+N';
const SIDEBAR_PREVIOUS_CHAT_HOTKEY = 'Ctrl+Shift+[';
const SIDEBAR_NEXT_CHAT_HOTKEY = 'Ctrl+Shift+]';

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

function TopNavItem({ to, icon, label, badge }: { to: string; icon: string; label: string; badge?: number | null }) {
  return (
    <NavLink
      to={to}
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
  isActive = false,
  onClick,
}: {
  icon: string;
  label: string;
  badge?: number | string | null;
  isActive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
      {badge != null && (
        <span className="ui-sidebar-nav-badge">{badge}</span>
      )}
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

// ── Open tab ───────────────────────────────────────────────────────────────

function OpenTab({
  session,
  needsAttention,
  canReorder,
  isDragging,
  dropPosition,
  onClose,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  session: SessionMeta;
  needsAttention?: boolean;
  canReorder: boolean;
  isDragging?: boolean;
  dropPosition?: OpenConversationDropPosition | null;
  onClose: () => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const location = useLocation();
  const isActive = location.pathname === `/conversations/${session.id}`;

  return (
    <div
      className="relative"
      draggable={canReorder}
      onDragStart={canReorder ? onDragStart : undefined}
      onDragOver={canReorder ? onDragOver : undefined}
      onDrop={canReorder ? onDrop : undefined}
      onDragEnd={canReorder ? onDragEnd : undefined}
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
          canReorder && (isDragging ? 'cursor-grabbing opacity-60' : 'cursor-grab'),
        ].filter(Boolean).join(' ')}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={canReorder ? 'Drag to reorder' : undefined}
      >
        <span
          aria-hidden="true"
          className={[
            'mt-0.5 self-stretch w-px rounded-full shrink-0 transition-colors',
            isActive ? 'bg-accent/80' : 'bg-border-subtle',
          ].join(' ')}
        />

        <div className="flex-1 min-w-0">
          <p className="ui-row-title truncate">{session.title}</p>
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
        </div>

        <div className="shrink-0 mt-0.5 min-w-[16px] flex items-center justify-center">
          {hovered ? (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
              className="ui-icon-button ui-icon-button-compact"
              title="Close tab"
            >
              <Ico d={PATH.close} size={10} />
            </button>
          ) : canReorder ? (
            <span className="text-dim/45" aria-hidden="true">
              <Ico d={PATH.grip} size={12} />
            </span>
          ) : null}
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

function SidebarFooter() {
  return (
    <div className="border-t border-border-subtle px-2 py-2 shrink-0 space-y-0.5">
      <TopNavItem to="/gateway" icon={PATH.gateway} label="Gateway" />
      <TopNavItem to="/daemon" icon={PATH.daemon} label="Daemon" />
      <TopNavItem to="/web-ui" icon={PATH.web} label="Web UI" />
      <TopNavItem to="/memory" icon={PATH.memory} label="Memory" />
      <TopNavItem to="/tools" icon={PATH.tools} label="Tools" />
      <TopNavItem to="/settings" icon={PATH.settings} label="Settings" />
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activity } = useAppData();
  const { tabs, archivedSessions, openSession, closeSession, reorderSessions, loading } = useConversations();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    sessionId: string;
    position: OpenConversationDropPosition;
  } | null>(null);
  const allSessions = useMemo(() => [...tabs, ...archivedSessions], [archivedSessions, tabs]);
  const activeConversationId = useMemo(() => getActiveConversationId(location.pathname), [location.pathname]);
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
  const tabIds = useMemo(() => tabs.map((session) => session.id), [tabs]);
  const canReorderTabs = tabs.length > 1;

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
    setDropTarget(null);
  }

  function getDropPosition(event: DragEvent<HTMLDivElement>): OpenConversationDropPosition {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
  }

  function handleTabDragStart(sessionId: string, event: DragEvent<HTMLDivElement>) {
    setDraggingSessionId(sessionId);
    setDropTarget(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sessionId);
  }

  function handleTabDragOver(sessionId: string, event: DragEvent<HTMLDivElement>) {
    const draggedSessionId = draggingSessionId ?? event.dataTransfer.getData('text/plain');
    if (!draggedSessionId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (draggedSessionId === sessionId) {
      setDropTarget(null);
      return;
    }

    const position = getDropPosition(event);
    setDropTarget((current) => (
      current?.sessionId === sessionId && current.position === position
        ? current
        : { sessionId, position }
    ));
  }

  function handleTabDrop(sessionId: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const draggedSessionId = draggingSessionId ?? event.dataTransfer.getData('text/plain');
    if (!draggedSessionId || draggedSessionId === sessionId) {
      clearDragState();
      return;
    }

    const position = getDropPosition(event);
    const nextOrder = reorderOpenSessionIds(tabIds, draggedSessionId, sessionId, position);
    reorderSessions(nextOrder);
    clearDragState();
  }

  function handleRestoreArchivedConversation(session: SessionMeta) {
    openSession(session.id);
    setArchiveOpen(false);
    navigate(`/conversations/${session.id}`);
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
    const nextTab = remainingTabs[0];
    if (nextTab) {
      navigate(`/conversations/${nextTab.id}`);
      return;
    }

    navigate('/inbox');
  }

  const handleNewConversation = useCallback(() => {
    navigate('/conversations/new');
  }, [navigate]);

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

  return (
    <aside className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <div className="ui-brand-mark">
          <span className="ui-brand-mark-text">pa</span>
        </div>
        <span className="text-[13px] font-semibold text-primary truncate flex-1">personal agent</span>
      </div>

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

      <div className="pb-1 space-y-0.5">
        <TopNavItem to="/inbox" icon={PATH.inbox} label="Inbox" badge={inboxCount} />
        <TopActionButton
          icon={PATH.archive}
          label="Archived"
          isActive={archiveOpen}
          onClick={() => setArchiveOpen(true)}
        />
        <TopNavItem to="/scheduled" icon={PATH.tasks} label="Scheduled" />
        <TopNavItem to="/runs" icon={PATH.runs} label="Runs" />
        <TopNavItem to="/projects" icon={PATH.projects} label="Projects" />
      </div>

      <div className="mx-3 border-t border-border-subtle my-2" />

      <SectionHeader
        label="Open conversations"
        count={loading ? '…' : tabs.length}
        title={`Navigate between open conversations with ${SIDEBAR_PREVIOUS_CHAT_HOTKEY} and ${SIDEBAR_NEXT_CHAT_HOTKEY}`}
      />

      {/* ── Open tabs ── */}
      <div className="flex-1 overflow-y-auto py-1 space-y-0.5 min-h-0">
        {!loading && tabs.length === 0 && (
          <p className="px-4 py-2 text-[12px] text-dim">
            No open conversations yet.
          </p>
        )}
        {tabs.map((session) => {
          const dropPosition = dropTarget?.sessionId === session.id && draggingSessionId !== session.id
            ? dropTarget.position
            : null;

          return (
            <OpenTab
              key={session.id}
              session={session}
              needsAttention={attentionIds.has(session.id)}
              canReorder={canReorderTabs}
              isDragging={draggingSessionId === session.id}
              dropPosition={dropPosition}
              onClose={() => handleCloseTab(session.id)}
              onDragStart={(event) => handleTabDragStart(session.id, event)}
              onDragOver={(event) => handleTabDragOver(session.id, event)}
              onDrop={(event) => handleTabDrop(session.id, event)}
              onDragEnd={() => clearDragState()}
            />
          );
        })}
      </div>

      <SidebarFooter />

      {archiveOpen && (
        <ArchivedConversationsModal
          sessions={archivedSessions}
          loading={loading}
          attentionIds={attentionIds}
          onRestore={(sessionId) => {
            const session = archivedSessions.find((item) => item.id === sessionId);
            if (!session) {
              return;
            }
            handleRestoreArchivedConversation(session);
          }}
          onClose={() => setArchiveOpen(false)}
        />
      )}
    </aside>
  );
}
