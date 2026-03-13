import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationCheckpointSummary } from '../types';
import { timeAgo } from '../utils';
import { IconButton, Keycap, Pill, cx } from './ui';

type CheckpointScope = 'conversation' | 'all';

interface Props {
  conversationId: string;
  checkpoints: ConversationCheckpointSummary[];
  loading?: boolean;
  scope: CheckpointScope;
  busyCheckpointId?: string | null;
  onScopeChange: (scope: CheckpointScope) => void;
  onStart: (checkpointId: string) => void;
  onDelete: (checkpointId: string) => void;
  onClose: () => void;
}

function scopeLabel(scope: CheckpointScope): string {
  return scope === 'conversation' ? 'This conversation' : 'All conversations';
}

function filterCheckpoints(checkpoints: ConversationCheckpointSummary[], query: string): ConversationCheckpointSummary[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return checkpoints;
  }

  return checkpoints.filter((checkpoint) => {
    const haystack = [
      checkpoint.id,
      checkpoint.title,
      checkpoint.note,
      checkpoint.summary,
      checkpoint.source.conversationId,
      checkpoint.source.conversationTitle,
      checkpoint.anchor.preview,
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join('\n')
      .toLowerCase();

    return haystack.includes(normalized);
  });
}

export function ConversationCheckpointsModal({
  conversationId,
  checkpoints,
  loading = false,
  scope,
  busyCheckpointId = null,
  onScopeChange,
  onStart,
  onDelete,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterCheckpoints(checkpoints, query), [checkpoints, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setCursor((current) => {
      if (filtered.length === 0) {
        return 0;
      }

      return Math.min(current, filtered.length - 1);
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
        if (active && !active.snapshotMissing) {
          onStart(active.id);
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
        setCursor((current) => Math.min(current + 10, Math.max(filtered.length - 1, 0)));
        return;
      }

      if (event.key === 'PageUp') {
        event.preventDefault();
        setCursor((current) => Math.max(current - 10, 0));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cursor, filtered, onClose, onStart]);

  const countLabel = loading ? '…' : `${filtered.length}/${checkpoints.length}`;

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.55)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Conversation checkpoints"
        className="ui-dialog-shell"
        style={{ maxWidth: '960px', maxHeight: 'calc(100vh - 6rem)', overscrollBehavior: 'contain' }}
      >
        <div className="px-4 pt-3 pb-0 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-2.5 gap-3">
            <div>
              <p className="ui-section-label text-[11px]">Conversation checkpoints</p>
              <p className="text-[12px] text-secondary mt-1">Start a new conversation from any saved checkpoint.</p>
              <p className="text-[11px] text-dim mt-1 font-mono">conversation={conversationId}</p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-dim/70 font-mono">
              <Keycap>↑↓</Keycap>
              <span>move</span>
              <Keycap>↵</Keycap>
              <span>start</span>
              <Pill tone="muted" mono className="tabular-nums">{countLabel}</Pill>
              <IconButton onClick={onClose} title="Close checkpoints" aria-label="Close checkpoints" compact>
                ✕
              </IconButton>
            </div>
          </div>

          <div className="grid gap-2 mb-2.5 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-elevated border border-border-subtle min-w-0">
              <span className="text-dim text-[12px]">⌕</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
                placeholder="Search checkpoints…"
                aria-label="Search checkpoints"
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

            <div className="ui-segmented-control inline-flex">
              <button
                type="button"
                onClick={() => { onScopeChange('conversation'); setCursor(0); }}
                className={cx('ui-segmented-button', scope === 'conversation' && 'ui-segmented-button-active')}
              >
                This conversation
              </button>
              <button
                type="button"
                onClick={() => { onScopeChange('all'); setCursor(0); }}
                className={cx('ui-segmented-button', scope === 'all' && 'ui-segmented-button-active')}
              >
                All
              </button>
            </div>
          </div>

          <p className="pb-2 text-[11px] text-dim">Showing {filtered.length} checkpoints in {scopeLabel(scope)}.</p>
        </div>

        <div ref={listRef} className="overflow-y-auto flex-1 py-1" style={{ overscrollBehavior: 'contain' }}>
          {loading && (
            <p className="px-6 py-8 text-[12px] text-dim text-center font-mono">Loading checkpoints…</p>
          )}

          {!loading && filtered.length === 0 && (
            <p className="px-6 py-8 text-[12px] text-dim text-center font-mono">
              {query ? `No checkpoints match "${query}"` : 'No checkpoints yet. Save one from any message.'}
            </p>
          )}

          {!loading && filtered.map((checkpoint, index) => {
            const isCursor = index === cursor;
            const isBusy = busyCheckpointId === checkpoint.id;
            const sourceTitle = checkpoint.source.conversationTitle || checkpoint.source.conversationId;

            return (
              <button
                key={checkpoint.id}
                data-idx={index}
                onClick={() => {
                  if (!checkpoint.snapshotMissing) {
                    onStart(checkpoint.id);
                  }
                }}
                className={cx(
                  'group w-full flex items-start gap-3 px-5 py-2 text-left transition-colors',
                  isCursor ? 'bg-elevated' : 'hover:bg-elevated/40',
                )}
              >
                <span className={`text-[11px] shrink-0 w-2 mt-1 ${isCursor ? 'text-accent' : 'text-border-default/50'}`}>
                  {isCursor ? '▶' : '·'}
                </span>

                <span className="text-[10px] text-dim/40 shrink-0 w-7 text-right tabular-nums mt-0.5 select-none">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-primary leading-snug truncate">{checkpoint.title}</p>
                  <p className="mt-0.5 text-[11px] text-secondary truncate" title={checkpoint.anchor.preview}>
                    {checkpoint.anchor.preview || '(no preview)'}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-dim/70 min-w-0">
                    <span className="shrink-0">{timeAgo(checkpoint.updatedAt)}</span>
                    <span className="shrink-0 text-dim/40">·</span>
                    <span className="truncate" title={sourceTitle}>{sourceTitle}</span>
                    <span className="shrink-0 text-dim/40">·</span>
                    <span className="font-mono shrink-0">{checkpoint.snapshot.messageCount} msgs</span>
                    {checkpoint.snapshotMissing && (
                      <>
                        <span className="shrink-0 text-dim/40">·</span>
                        <span className="shrink-0 text-danger">snapshot missing</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!checkpoint.snapshotMissing) {
                        onStart(checkpoint.id);
                      }
                    }}
                    disabled={isBusy || checkpoint.snapshotMissing}
                    className="ui-action-button"
                    title={checkpoint.snapshotMissing ? 'Checkpoint snapshot is missing' : 'Start new conversation from this checkpoint'}
                  >
                    start
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onDelete(checkpoint.id);
                    }}
                    disabled={isBusy}
                    className="ui-action-button text-danger"
                    title="Delete checkpoint"
                  >
                    delete
                  </button>
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-2.5 border-t border-border-subtle flex items-center justify-between text-[10px] text-dim/60 font-mono gap-3">
          <Pill tone="muted" mono>{filtered.length > 0 ? `${cursor + 1} / ${filtered.length}` : '0 / 0'}</Pill>
          <span>Search checkpoints · start a new branch from saved anchors · esc to close</span>
        </div>
      </div>
    </div>
  );
}
