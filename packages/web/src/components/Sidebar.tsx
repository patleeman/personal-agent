import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useConversations } from '../hooks/useConversations';
import type { SessionMeta } from '../types';
import { ThemeSwitcher } from './ThemeSwitcher';
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
  inbox:       'M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z',
  workstreams: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z',
  close:       'M6 18 18 6M6 6l12 12',
  chevron:     'M19.5 8.25l-7.5 7.5-7.5-7.5',
};

// ── Top nav item ───────────────────────────────────────────────────────────

function TopNavItem({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 mx-1 rounded-lg text-[13px] font-medium transition-colors ${
          isActive
            ? 'bg-elevated text-primary'
            : 'text-secondary hover:bg-elevated/60 hover:text-primary'
        }`
      }
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
        className="shrink-0 opacity-70">
        <path d={icon} />
      </svg>
      {label}
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
        'group relative flex items-start gap-2.5 px-3 py-2 rounded-lg mx-1 transition-colors',
        isActive
          ? 'bg-elevated text-primary'
          : 'text-secondary hover:bg-elevated/60 hover:text-primary',
      ].join(' ')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={[
        'mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 transition-colors',
        isActive ? 'bg-accent' : 'bg-border-default/50',
      ].join(' ')} />

      <div className="flex-1 min-w-0">
        <p className="text-[13px] leading-snug font-medium truncate">{session.title}</p>
        <p className="text-[11px] text-dim mt-0.5 truncate">
          {timeAgo(session.timestamp)}
          <span className="ml-1.5 opacity-55">· {cwdLabel(session.cwd)}</span>
        </p>
      </div>

      {/* × sends back to shelf */}
      {hovered && !isActive && (
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onClose(); }}
          className="shrink-0 mt-0.5 w-4 h-4 rounded flex items-center justify-center text-dim hover:text-primary hover:bg-elevated transition-colors"
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
      className="w-full flex items-center gap-2.5 px-3 py-1.5 mx-1 rounded-lg text-left transition-colors text-dim hover:text-secondary hover:bg-elevated/50"
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

// ── Sidebar ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const navigate = useNavigate();
  const { tabs, shelf, openSession, closeSession, loading, usingFallback } = useConversations();
  const [shelfOpen, setShelfOpen] = useState(false);

  function handleShelfClick(session: SessionMeta) {
    openSession(session.id);
    navigate(`/conversations/${session.id}`);
  }

  return (
    <aside className="flex-1 flex flex-col overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <div className="w-6 h-6 rounded bg-accent/20 flex items-center justify-center shrink-0">
          <span className="text-accent text-[10px] font-bold font-mono">pa</span>
        </div>
        <span className="text-[13px] font-semibold text-primary truncate flex-1">personal agent</span>
        <ThemeSwitcher />
      </div>

      {/* ── Top nav ── */}
      <div className="pb-1 space-y-0.5">
        <TopNavItem to="/inbox"       icon={PATH.inbox}       label="Inbox"       />
        <TopNavItem to="/workstreams" icon={PATH.workstreams} label="Workstreams" />
      </div>

      <div className="mx-3 border-t border-border-subtle my-1" />

      {/* ── Open tabs ── */}
      <div className="flex-1 overflow-y-auto py-1 space-y-0.5 min-h-0">
        {!loading && tabs.length === 0 && (
          <p className="px-4 py-2 text-[12px] text-dim">
            No open tabs — pick one from the shelf below.
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
          <span className="flex-1 text-left">All sessions</span>
          <span className="text-[10px] tabular-nums opacity-60">
            {loading ? '…' : shelf.length}
          </span>
          {usingFallback && <span className="text-[9px] opacity-40 ml-1">demo</span>}
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
              <p className="px-4 py-2 text-[11px] text-dim">All sessions are open.</p>
            )}
          </div>
        )}
      </div>


    </aside>
  );
}
