import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useConversations } from '../hooks/useConversations';
import { useApi } from '../hooks';
import { useAppData } from '../contexts';
import { api } from '../api';
import type { ProfileState, SessionMeta } from '../types';
import { useTheme } from '../theme';
import { timeAgo } from '../utils';

function useInboxCount() {
  const { activity } = useAppData();
  return activity?.unreadCount ?? null;
}

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
  projects: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z',
  tasks:    'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  memory:      'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25',
  close:       'M6 18 18 6M6 6l12 12',
  chevron:     'M19.5 8.25l-7.5 7.5-7.5-7.5',
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

function cwdLabel(cwd: string, maxLen = 24): string {
  const parts = cwd.split('/').filter(Boolean);
  const label = parts[parts.length - 1] ?? cwd;
  return label.length > maxLen ? label.slice(0, maxLen - 1) + '…' : label;
}

// ── Open tab ───────────────────────────────────────────────────────────────

function OpenTab({ session, onClose }: { session: SessionMeta; onClose: () => void }) {
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
        <p className="ui-row-title truncate">{session.title}</p>
        <p className="ui-sidebar-session-meta">
          {timeAgo(session.timestamp)}
          <span className="ml-1.5 opacity-55">· {cwdLabel(session.cwd)}</span>
        </p>
      </div>

      {hovered && !isActive && (
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

// ── Shelf row ──────────────────────────────────────────────────────────────

function ShelfRow({ session, onOpen }: { session: SessionMeta; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="ui-sidebar-shelf-row"
      style={{ width: 'calc(100% - 8px)' }}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-border-default/40 shrink-0 mt-px" />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] leading-snug truncate">{session.title}</p>
        <p className="text-[10px] text-dim/60 mt-0.5 truncate">
          {timeAgo(session.timestamp)}
          <span className="ml-1.5">· {cwdLabel(session.cwd)}</span>
        </p>
      </div>
    </button>
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

function SidebarFooter({
  profileState,
  switchingProfile,
  profileError,
  theme,
  onToggleTheme,
  onProfileChange,
}: {
  profileState?: ProfileState;
  switchingProfile: boolean;
  profileError: string | null;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onProfileChange: (profile: string) => void;
}) {
  const nextTheme = theme === 'light' ? 'dark' : 'light';
  const profileHint = switchingProfile
    ? 'Switching profile and reloading…'
    : 'Changes inbox, projects, memory, and new live sessions.';
  const rowClass = [
    'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-secondary transition-colors',
    'hover:bg-elevated/60 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/30',
  ].join(' ');

  return (
    <div className="border-t border-border-subtle px-2 py-2 shrink-0">
      <div className="space-y-1">
        <button
          type="button"
          onClick={onToggleTheme}
          className={rowClass}
          title={`Switch to ${nextTheme} theme`}
          aria-label={`Switch to ${nextTheme} theme`}
        >
          <span className="flex-1 text-[13px] font-medium">Theme</span>
          <span className="text-[11px] text-dim capitalize">{theme}</span>
        </button>

        {profileState && profileState.profiles.length > 0 && (
          <div className="relative" title={profileHint}>
            <div className={rowClass}>
              <span className="flex-1 text-[13px] font-medium">Profile</span>
              <span className="max-w-[7rem] truncate text-[11px] text-dim">{profileState.currentProfile}</span>
              <span className="pointer-events-none shrink-0 text-dim/70">
                <Ico d={PATH.chevron} size={11} />
              </span>
            </div>

            <select
              value={profileState.currentProfile}
              onChange={(event) => { onProfileChange(event.target.value); }}
              disabled={switchingProfile}
              aria-label="Active profile"
              className="absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
            >
              {profileState.profiles.map((profile) => (
                <option key={profile} value={profile}>{profile}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {switchingProfile && (
        <p className="px-3 pt-1 text-[10px] text-dim">Switching profile and reloading…</p>
      )}
      {profileError && <p className="px-3 pt-1 text-[10px] text-danger">{profileError}</p>}
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();
  const { tabs, shelf, openSession, closeSession, loading, refetch } = useConversations();
  const { data: profileState } = useApi(api.profiles);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [switchingProfile, setSwitchingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const inboxCount = useInboxCount();

  function handleShelfClick(session: SessionMeta) {
    openSession(session.id);
    navigate(`/conversations/${session.id}`);
  }

  async function handleNewConversation() {
    if (creating) return;
    setCreating(true);
    try {
      const data = await api.createLiveSession();
      openSession(data.id);
      navigate(`/conversations/${data.id}`);
      // Refetch after a brief delay so the new session file appears in the shelf
      setTimeout(() => void refetch(), 1500);
    } catch (err) {
      console.error('Failed to create session:', err);
    } finally {
      setCreating(false);
    }
  }

  async function handleProfileChange(profile: string) {
    if (!profileState || profile === profileState.currentProfile || switchingProfile) return;
    setProfileError(null);
    setSwitchingProfile(true);
    try {
      await api.setCurrentProfile(profile);
      window.location.reload();
    } catch (err) {
      console.error('Failed to switch profile:', err);
      setProfileError('Could not switch profile.');
      setSwitchingProfile(false);
    }
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
          disabled={creating}
          className="ui-sidebar-nav-item disabled:opacity-40"
          style={{ width: 'calc(100% - 8px)' }}
        >
          {creating
            ? <span className="w-4 h-4 border-[1.5px] border-current border-t-transparent rounded-full animate-spin shrink-0 opacity-70" />
            : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70"><path d="M12 5v14M5 12h14"/></svg>
          }
          New chat
        </button>
      </div>

      <div className="pb-1 space-y-0.5">
        <TopNavItem to="/inbox" icon={PATH.inbox} label="Inbox" badge={inboxCount} />
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
            onClose={() => closeSession(session.id)}
          />
        ))}
      </div>

      {/* ── Shelf ── */}
      <div className="border-t border-border-subtle shrink-0">
        <button
          onClick={() => setShelfOpen(v => !v)}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-dim hover:text-secondary transition-colors"
        >
          <span
            className="transition-transform duration-150 shrink-0"
            style={{ display: 'inline-block', transform: shelfOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          >
            <Ico d={PATH.chevron} size={11} />
          </span>
          <span className="flex-1 text-left">Recent conversations</span>
          <span className="text-[10px] tabular-nums opacity-60">
            {loading ? '…' : shelf.length}
          </span>
        </button>

        {shelfOpen && (
          <div className="pb-2 max-h-72 overflow-y-auto space-y-0.5">
            {shelf.map(session => (
              <ShelfRow
                key={session.id}
                session={session}
                onOpen={() => handleShelfClick(session)}
              />
            ))}
            {shelf.length === 0 && (
              <p className="px-4 py-2 text-[11px] text-dim">All conversations are already open.</p>
            )}
          </div>
        )}
      </div>

      <SidebarFooter
        profileState={profileState}
        switchingProfile={switchingProfile}
        profileError={profileError}
        theme={theme}
        onToggleTheme={toggleTheme}
        onProfileChange={(profile) => { void handleProfileChange(profile); }}
      />
    </aside>
  );
}
