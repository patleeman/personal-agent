import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
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
  plus:        'M12 4.5v15m7.5-7.5h-15',
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Last path segment, truncated */
function cwdLabel(cwd: string, maxLen = 26): string {
  const parts = cwd.split('/').filter(Boolean);
  const label = parts[parts.length - 1] ?? cwd;
  return label.length > maxLen ? label.slice(0, maxLen - 1) + '…' : label;
}

// ── ConvTab ────────────────────────────────────────────────────────────────

function ConvTab({ session, onClose }: { session: SessionMeta; onClose: () => void }) {
  const [hovered, setHovered] = useState(false);
  const location  = useLocation();
  const isActive  = location.pathname === `/conversations/${session.id}`;

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
      {/* Indicator dot */}
      <span className={[
        'mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 transition-colors',
        isActive ? 'bg-accent' : 'bg-border-default/50',
      ].join(' ')} />

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] leading-snug font-medium truncate">{session.title}</p>
        <p className="text-[11px] text-dim mt-0.5 truncate">
          {timeAgo(session.timestamp)}
          <span className="ml-1.5 opacity-55">· {cwdLabel(session.cwd)}</span>
        </p>
      </div>

      {/* Close / archive */}
      {hovered && !isActive && (
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onClose(); }}
          className="shrink-0 mt-0.5 w-4 h-4 rounded flex items-center justify-center text-dim hover:text-primary hover:bg-elevated transition-colors"
          title="Dismiss conversation"
        >
          <Ico d={PATH.close} size={10} />
        </button>
      )}
    </NavLink>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const { open, archived, archiveConversation, restoreConversation, loading, usingFallback } =
    useConversations();
  const [archivedOpen, setArchivedOpen] = useState(false);

  return (
    <aside className="flex-1 flex flex-col overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <div className="w-6 h-6 rounded bg-accent/20 flex items-center justify-center shrink-0">
          <span className="text-accent text-[10px] font-bold font-mono">pa</span>
        </div>
        <span className="text-[13px] font-semibold text-primary truncate flex-1">personal agent</span>
        <ThemeSwitcher />
      </div>

      {/* Conversations label + loading */}
      <div className="flex items-center gap-2 px-4 pb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-dim">Conversations</span>
        {loading && <span className="text-[10px] text-dim animate-pulse">loading…</span>}
        {usingFallback && <span className="text-[10px] text-dim opacity-50" title="API unavailable">demo</span>}
      </div>

      {/* ── Open list ── */}
      <div className="flex-1 overflow-y-auto py-1 space-y-0.5">
        {!loading && open.length === 0 && (
          <p className="px-4 py-3 text-[12px] text-dim">No conversations yet</p>
        )}
        {open.map(session => (
          <ConvTab
            key={session.id}
            session={session}
            onClose={() => archiveConversation(session.id)}
          />
        ))}
      </div>

      {/* ── Archived section ── */}
      {archived.length > 0 && (
        <div className="border-t border-border-subtle">
          <button
            onClick={() => setArchivedOpen(v => !v)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-dim hover:text-secondary transition-colors"
          >
            <span
              className="transition-transform duration-150"
              style={{ display: 'inline-block', transform: archivedOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
            >
              <Ico d={PATH.chevron} size={12} />
            </span>
            Dismissed ({archived.length})
          </button>

          {archivedOpen && (
            <div className="pb-1 space-y-0.5">
              {archived.map(session => (
                <button
                  key={session.id}
                  onClick={() => restoreConversation(session.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 mx-1 rounded text-[12px] text-dim hover:text-secondary hover:bg-elevated transition-colors"
                  title="Restore conversation"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-border-default shrink-0" />
                  <span className="flex-1 text-left truncate">{session.title}</span>
                  <span className="text-[10px] opacity-50 shrink-0">{timeAgo(session.timestamp)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Bottom dock — Inbox, Workstreams ── */}
      <div className="border-t border-border-subtle px-2 py-2 flex items-center gap-1">
        <NavLink
          to="/inbox"
          title="Inbox"
          className={({ isActive }) =>
            `flex-1 flex items-center justify-center py-1.5 rounded-lg transition-colors ${
              isActive ? 'bg-accent/12 text-accent' : 'text-dim hover:text-secondary hover:bg-elevated'
            }`
          }
        >
          <Ico d={PATH.inbox} />
        </NavLink>
        <NavLink
          to="/workstreams"
          title="Workstreams"
          className={({ isActive }) =>
            `flex-1 flex items-center justify-center py-1.5 rounded-lg transition-colors ${
              isActive ? 'bg-accent/12 text-accent' : 'text-dim hover:text-secondary hover:bg-elevated'
            }`
          }
        >
          <Ico d={PATH.workstreams} />
        </NavLink>
      </div>
    </aside>
  );
}
