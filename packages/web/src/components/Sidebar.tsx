import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ArchivedConversationsModal } from './ArchivedConversationsModal';
import { api } from '../api';
import { useConversations } from '../hooks/useConversations';
import { useAppData } from '../contexts';
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
  projects: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z',
  tasks:    'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  memory:      'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25',
  settings:    'M10.5 6h3m-1.5-3v6m4.348-2.826 2.121 2.121m-12.728 0 2.121-2.121m8.486 8.486 2.121 2.121m-12.728 0 2.121-2.121M6 10.5H3m18 0h-3m-5.25 7.5v3m0-18v3',
  close:       'M6 18 18 6M6 6l12 12',
};

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

function ConversationStatusIndicators({
  isRunning,
  needsAttention,
}: {
  isRunning?: boolean;
  needsAttention?: boolean;
}) {
  if (!isRunning && !needsAttention) {
    return null;
  }

  return (
    <span className="flex items-center gap-1.5 shrink-0 self-start mt-0.5" aria-hidden="true">
      {isRunning && (
        <span
          className="w-2 h-2 rounded-full bg-accent animate-pulse"
          title="Running"
        />
      )}
      {needsAttention && (
        <span
          className="w-2 h-2 rounded-full bg-warning ring-1 ring-warning/25"
          title="Needs attention"
        />
      )}
    </span>
  );
}

// ── Open tab ───────────────────────────────────────────────────────────────

function OpenTab({
  session,
  needsAttention,
  onClose,
}: {
  session: SessionMeta;
  needsAttention?: boolean;
  onClose: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const location = useLocation();
  const isActive = location.pathname === `/conversations/${session.id}`;

  return (
    <NavLink
      to={`/conversations/${session.id}`}
      className={[
        'ui-sidebar-session-row',
        isActive && 'ui-sidebar-session-row-active',
      ].filter(Boolean).join(' ')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={[
        'mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 transition-colors',
        isActive ? 'bg-accent' : 'bg-border-default/50',
      ].join(' ')} />

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <p className="ui-row-title truncate flex-1 min-w-0">{session.title}</p>
          <ConversationStatusIndicators isRunning={session.isRunning} needsAttention={needsAttention} />
        </div>
        <p className="ui-sidebar-session-meta">
          {timeAgo(session.timestamp)}
          <span className="ml-1.5 opacity-55">· {cwdLabel(session.cwd)}</span>
        </p>
      </div>

      {hovered && (
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onClose(); }}
          className="ui-icon-button ui-icon-button-compact shrink-0 mt-0.5"
          title="Close tab"
        >
          <Ico d={PATH.close} size={10} />
        </button>
      )}
    </NavLink>
  );
}

function SectionHeader({ label, count }: { label: string; count?: number | string }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-2 pb-1">
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
      <TopNavItem to="/settings" icon={PATH.settings} label="Settings" />
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activity } = useAppData();
  const { tabs, archivedSessions, openSession, closeSession, loading } = useConversations();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const allSessions = useMemo(() => [...tabs, ...archivedSessions], [archivedSessions, tabs]);
  const activeConversationId = useMemo(() => getActiveConversationId(location.pathname), [location.pathname]);
  const attentionIds = useMemo(
    () => new Set(allSessions.filter((session) => session.needsAttention).map((session) => session.id)),
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
  const inboxCount = standaloneUnreadCount + archivedSessions.filter((session) => session.needsAttention).length;

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }

    const activeSession = allSessions.find((session) => session.id === activeConversationId);
    if (!activeSession || !activeSession.needsAttention) {
      return;
    }

    void api.markConversationAttentionRead(activeSession.id).catch(() => {
      // Ignore optimistic attention-clear failures; SSE or manual refresh can recover.
    });
  }, [activeConversationId, allSessions]);

  function handleRestoreArchivedConversation(session: SessionMeta) {
    openSession(session.id);
    setArchiveOpen(false);
    navigate(`/conversations/${session.id}`);
  }

  function handleCloseTab(sessionId: string) {
    const isActive = location.pathname === `/conversations/${sessionId}`;
    closeSession(sessionId);

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

  function handleNewConversation() {
    navigate('/conversations/new');
  }

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
        <TopNavItem to="/projects" icon={PATH.projects} label="Projects" />
        <TopNavItem to="/memory" icon={PATH.memory} label="Memory" />
      </div>

      <div className="mx-3 border-t border-border-subtle my-2" />

      <SectionHeader label="Open conversations" count={loading ? '…' : tabs.length} />

      {/* ── Open tabs ── */}
      <div className="flex-1 overflow-y-auto py-1 space-y-0.5 min-h-0">
        {!loading && tabs.length === 0 && (
          <p className="px-4 py-2 text-[12px] text-dim">
            No open conversations yet.
          </p>
        )}
        {tabs.map(session => (
          <OpenTab
            key={session.id}
            session={session}
            needsAttention={attentionIds.has(session.id)}
            onClose={() => handleCloseTab(session.id)}
          />
        ))}
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
