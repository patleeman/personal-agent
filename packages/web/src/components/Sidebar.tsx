import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useConversations, type Conversation } from '../hooks/useConversations';
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
  plus:        'M12 4.5v15m7.5-7.5h-15',
  close:       'M6 18 18 6M6 6l12 12',
  chevron:     'M19.5 8.25l-7.5 7.5-7.5-7.5',
};

// ── ConvTab ────────────────────────────────────────────────────────────────

function ConvTab({ conv, onClose }: { conv: Conversation; onClose: () => void }) {
  const [hovered, setHovered] = useState(false);
  const location = useLocation();
  const isActive = location.pathname === `/conversations/${conv.id}`;

  return (
    <NavLink
      to={`/conversations/${conv.id}`}
      className={[
        'group relative flex items-start gap-2.5 px-3 py-2 rounded-lg mx-1 transition-colors border-l-2',
        isActive
          ? 'bg-accent/12 text-primary border-accent'
          : 'text-secondary hover:bg-elevated hover:text-primary border-transparent',
      ].join(' ')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Active indicator dot */}
      <span className={[
        'mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 transition-colors',
        isActive ? 'bg-accent' : 'bg-border-default',
      ].join(' ')} />

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] leading-snug font-medium truncate">{conv.title}</p>
        <p className="text-[11px] text-dim mt-0.5 truncate">
          {timeAgo(conv.updatedAt)}
          {conv.workstreamId && (
            <span className="ml-1.5 text-accent/70">· {conv.workstreamId}</span>
          )}
        </p>
      </div>

      {/* Close button — only on non-active hovered tabs */}
      {hovered && !isActive && (
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onClose(); }}
          className="shrink-0 mt-0.5 w-4 h-4 rounded flex items-center justify-center text-dim hover:text-primary hover:bg-elevated transition-colors"
          title="Archive conversation"
        >
          <Ico d={PATH.close} size={10} />
        </button>
      )}
    </NavLink>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const navigate = useNavigate();
  const { open, archived, archiveConversation, restoreConversation, newConversation } = useConversations();
  const [archivedOpen, setArchivedOpen] = useState(false);

  function handleNew() {
    const conv = newConversation();
    navigate(`/conversations/${conv.id}`);
  }

  return (
    <aside className="w-56 shrink-0 flex flex-col bg-surface border-r border-border-subtle overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <div className="w-6 h-6 rounded bg-accent/20 flex items-center justify-center shrink-0">
          <span className="text-accent text-[10px] font-bold font-mono">pa</span>
        </div>
        <span className="text-[13px] font-semibold text-primary truncate flex-1">personal agent</span>
        <ThemeSwitcher />
      </div>

      {/* New conversation */}
      <div className="px-2 pb-2">
        <button
          onClick={handleNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-secondary hover:text-primary hover:bg-elevated transition-colors"
        >
          <Ico d={PATH.plus} size={14} />
          <span>New conversation</span>
        </button>
      </div>

      {/* Divider */}
      <div className="mx-3 border-t border-border-subtle mb-1" />

      {/* Open tabs */}
      <div className="flex-1 overflow-y-auto py-1 space-y-0.5">
        {open.length === 0 ? (
          <p className="px-4 py-3 text-[12px] text-dim">No open conversations</p>
        ) : (
          open.map(conv => (
            <ConvTab
              key={conv.id}
              conv={conv}
              onClose={() => archiveConversation(conv.id)}
            />
          ))
        )}
      </div>

      {/* Archived section */}
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
            Archived ({archived.length})
          </button>
          {archivedOpen && (
            <div className="pb-1 space-y-0.5">
              {archived.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => restoreConversation(conv.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 mx-1 rounded text-[12px] text-dim hover:text-secondary hover:bg-elevated transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-border-default shrink-0" />
                  <span className="truncate">{conv.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bottom dock — Inbox, Workstreams */}
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
