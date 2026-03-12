import { useEffect, useMemo, useRef, useState } from 'react';
import { ALL_ARCHIVE_WORKSPACES_VALUE, buildArchiveWorkspaceOptions, filterArchiveSessions } from '../archiveSessions';
import type { SessionMeta } from '../types';
import { formatDate, timeAgo } from '../utils';
import { ConversationStatusText } from './ConversationStatusText';
import { IconButton, Keycap, Pill } from './ui';

interface Props {
  sessions: SessionMeta[];
  loading?: boolean;
  attentionIds?: Set<string>;
  onRestore: (sessionId: string) => void;
  onClose: () => void;
}

export function ArchivedConversationsModal({
  sessions,
  loading = false,
  attentionIds,
  onRestore,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [workspace, setWorkspace] = useState(ALL_ARCHIVE_WORKSPACES_VALUE);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const workspaceOptions = useMemo(() => buildArchiveWorkspaceOptions(sessions), [sessions]);
  const selectedWorkspace = useMemo(
    () => workspaceOptions.find((option) => option.value === workspace) ?? null,
    [workspace, workspaceOptions],
  );
  const filtered = useMemo(
    () => filterArchiveSessions(sessions, query, workspace),
    [query, sessions, workspace],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (workspace === ALL_ARCHIVE_WORKSPACES_VALUE) {
      return;
    }

    const hasWorkspace = workspaceOptions.some((option) => option.value === workspace);
    if (!hasWorkspace) {
      setWorkspace(ALL_ARCHIVE_WORKSPACES_VALUE);
      setCursor(0);
    }
  }, [workspace, workspaceOptions]);

  useEffect(() => {
    setCursor((current) => {
      if (filtered.length === 0) {
        return 0;
      }
      return Math.max(0, Math.min(current, filtered.length - 1));
    });
  }, [filtered.length]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const active = filtered[cursor];
        if (active) {
          onRestore(active.id);
        }
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCursor((current) => Math.min(current + 1, Math.max(filtered.length - 1, 0)));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor((current) => Math.max(current - 1, 0));
        return;
      }

      if (event.key === 'PageDown') {
        event.preventDefault();
        setCursor((current) => Math.min(current + 12, Math.max(filtered.length - 1, 0)));
        return;
      }

      if (event.key === 'PageUp') {
        event.preventDefault();
        setCursor((current) => Math.max(current - 12, 0));
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        setCursor(0);
        return;
      }

      if (event.key === 'End') {
        event.preventDefault();
        setCursor(Math.max(filtered.length - 1, 0));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cursor, filtered, onClose, onRestore]);

  const countLabel = loading ? '…' : `${filtered.length}/${sessions.length}`;
  const footerLabel = filtered.length > 0 ? `${cursor + 1} / ${filtered.length}` : '0 / 0';
  const workspaceCount = workspaceOptions.length;
  const scopeLabel = selectedWorkspace?.label ?? 'All workspaces';

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.55)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Archived conversations"
        className="ui-dialog-shell"
        style={{ maxWidth: '920px', maxHeight: 'calc(100vh - 6rem)', overscrollBehavior: 'contain' }}
      >
        <div className="px-4 pt-3 pb-0 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-2.5 gap-3">
            <div>
              <p className="ui-section-label text-[11px]">Archived Conversations</p>
              <p className="text-[12px] text-secondary mt-1">Restore a conversation back into your open workspace.</p>
              <p className="text-[11px] text-dim mt-1">{workspaceCount} workspaces · {sessions.length} conversations total</p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-dim/70 font-mono">
              <Keycap>↑↓</Keycap>
              <span>move</span>
              <Keycap>↵</Keycap>
              <span>restore</span>
              <Pill tone="muted" mono className="tabular-nums">{countLabel}</Pill>
              <IconButton onClick={onClose} title="Close archive" aria-label="Close archive" compact>
                ✕
              </IconButton>
            </div>
          </div>

          <div className="grid gap-2 mb-2.5 md:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-elevated border border-border-subtle min-w-0">
              <span className="text-dim text-[12px]">⌕</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
                placeholder="Search title, workspace, or id…"
                aria-label="Search archived conversations"
                className="flex-1 bg-transparent text-[13px] text-primary placeholder:text-dim outline-none font-mono min-w-0"
              />
              {query && (
                <button
                  onClick={() => { setQuery(''); setCursor(0); inputRef.current?.focus(); }}
                  className="text-dim hover:text-secondary text-[11px]"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-elevated border border-border-subtle min-w-0">
              <label htmlFor="archive-workspace-filter" className="text-[11px] text-dim whitespace-nowrap">Workspace</label>
              <select
                id="archive-workspace-filter"
                value={workspace}
                onChange={(event) => { setWorkspace(event.target.value); setCursor(0); }}
                className="flex-1 truncate bg-transparent text-[12px] text-primary outline-none font-mono min-w-0"
                aria-label="Filter archived conversations by workspace"
              >
                <option value={ALL_ARCHIVE_WORKSPACES_VALUE}>All workspaces · {sessions.length}</option>
                {workspaceOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label} · {option.count}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="pb-2 text-[11px] text-dim truncate" title={scopeLabel}>
            Showing {filtered.length} conversation{filtered.length === 1 ? '' : 's'} in {scopeLabel}
          </p>
        </div>

        <div ref={listRef} className="overflow-y-auto flex-1 py-1" style={{ overscrollBehavior: 'contain' }}>
          {loading && (
            <p className="px-6 py-8 text-[12px] text-dim text-center font-mono">Loading archived conversations…</p>
          )}

          {!loading && filtered.length === 0 && (
            <p className="px-6 py-8 text-[12px] text-dim text-center font-mono">
              {query
                ? `No matches for "${query}" in ${scopeLabel}`
                : sessions.length === 0
                  ? 'No archived conversations'
                  : workspace === ALL_ARCHIVE_WORKSPACES_VALUE
                    ? 'No conversations in this archive view'
                    : `No conversations in ${scopeLabel}`}
            </p>
          )}

          {!loading && filtered.map((session, index) => {
            const isCursor = index === cursor;
            const needsAttention = attentionIds?.has(session.id) ?? false;
            return (
              <button
                key={session.id}
                data-idx={index}
                onClick={() => { onRestore(session.id); }}
                className={[
                  'group w-full flex items-start gap-3 px-5 py-2 text-left transition-colors',
                  isCursor ? 'bg-elevated' : 'hover:bg-elevated/40',
                ].join(' ')}
                title={`${formatDate(session.timestamp)} · ${session.cwd}`}
              >
                <span className={`text-[11px] shrink-0 w-2 mt-1 ${isCursor ? 'text-accent' : 'text-border-default/50'}`}>
                  {isCursor ? '▶' : '·'}
                </span>

                <span className="text-[10px] text-dim/40 shrink-0 w-7 text-right tabular-nums mt-0.5 select-none">
                  {index + 1}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-primary leading-snug truncate">{session.title}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-dim/70 min-w-0">
                    <span className="shrink-0">{timeAgo(session.timestamp)}</span>
                    <span className="shrink-0 text-dim/40">·</span>
                    <span className="truncate font-mono" title={session.cwd}>{session.cwd}</span>
                    {(session.isRunning || needsAttention) && (
                      <>
                        <span className="shrink-0 text-dim/40">·</span>
                        <ConversationStatusText
                          isRunning={session.isRunning}
                          needsAttention={needsAttention}
                          className="shrink-0"
                        />
                      </>
                    )}
                  </div>
                </div>

                <span className="shrink-0 mt-0.5 text-[11px] text-dim/50 opacity-0 group-hover:opacity-100 transition-opacity">
                  Restore
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-2.5 border-t border-border-subtle flex items-center justify-between text-[10px] text-dim/60 font-mono gap-3">
          <Pill tone="muted" mono>{footerLabel}</Pill>
          <span>Search, filter by workspace, click or ↵ to restore · esc to close</span>
        </div>
      </div>
    </div>
  );
}
