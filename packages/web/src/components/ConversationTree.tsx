import { useEffect, useRef, useState, useMemo } from 'react';
import type { MessageBlock } from '../data/mockConversations';

// ── Helpers ────────────────────────────────────────────────────────────────────

interface TreeEntry {
  index:    number;
  label:    string;   // type label shown in col 1
  preview:  string;   // truncated content
  color:    string;   // tailwind text color class
  ts:       string;
  duration?: number;
}

function buildEntries(messages: MessageBlock[]): TreeEntry[] {
  return messages.map((b, i) => {
    switch (b.type) {
      case 'user':
        return { index: i, label: 'user', color: 'text-accent',
          preview: b.text.replace(/\n/g, ' ').slice(0, 100), ts: b.ts };

      case 'text':
        return { index: i, label: 'asst', color: 'text-primary',
          preview: b.text.replace(/\n/g, ' ').slice(0, 100), ts: b.ts };

      case 'thinking':
        return { index: i, label: 'think', color: 'text-steel/80',
          preview: b.text.replace(/\n/g, ' ').slice(0, 90), ts: b.ts };

      case 'tool_use': {
        const inp = b.input as Record<string, string>;
        const preview = inp.command ?? inp.path ?? inp.url ?? JSON.stringify(b.input).slice(0, 80);
        const colorMap: Record<string, string> = {
          bash: 'text-steel', read: 'text-teal', write: 'text-accent',
          edit: 'text-accent', web_fetch: 'text-success', web_search: 'text-success',
        };
        return { index: i, label: b.tool, color: colorMap[b.tool] ?? 'text-secondary',
          preview, ts: b.ts, duration: b.durationMs };
      }

      case 'subagent':
        return { index: i, label: 'subagent', color: 'text-warning',
          preview: b.name + ': ' + b.prompt.slice(0, 70), ts: b.ts };

      case 'image':
        return { index: i, label: 'image', color: 'text-teal',
          preview: b.alt || `${b.width}×${b.height}`, ts: b.ts };

      case 'error':
        return { index: i, label: 'error', color: 'text-danger',
          preview: b.message.slice(0, 90), ts: b.ts };

      default:
        return { index: i, label: '?', color: 'text-dim', preview: '', ts: '' };
    }
  });
}

function fmtDuration(ms?: number) {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  messages: MessageBlock[];
  currentIndex?: number;
  onJump: (index: number) => void;
  onClose: () => void;
}

export function ConversationTree({ messages, currentIndex = 0, onJump, onClose }: Props) {
  const [query,    setQuery]    = useState('');
  const [cursor,   setCursor]   = useState(currentIndex);
  const listRef  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const all      = useMemo(() => buildEntries(messages), [messages]);
  const filtered = useMemo(() => {
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter(e => e.label.includes(q) || e.preview.toLowerCase().includes(q));
  }, [all, query]);

  // Focus input on mount, clamp cursor
  useEffect(() => {
    inputRef.current?.focus();
    setCursor(c => Math.min(c, filtered.length - 1));
  }, [filtered.length]);

  // Scroll cursor row into view
  useEffect(() => {
    const row = listRef.current?.querySelector(`[data-idx="${cursor}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // Keyboard
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape')     { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown')  { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); return; }
      if (e.key === 'PageDown')   { e.preventDefault(); setCursor(c => Math.min(c + 10, filtered.length - 1)); return; }
      if (e.key === 'PageUp')     { e.preventDefault(); setCursor(c => Math.max(c - 10, 0)); return; }
      if (e.key === 'Enter')      { e.preventDefault(); const e2 = filtered[cursor]; if (e2) { onJump(e2.index); onClose(); } return; }
      if (e.key === 'Home')       { e.preventDefault(); setCursor(0); return; }
      if (e.key === 'End')        { e.preventDefault(); setCursor(filtered.length - 1); return; }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cursor, filtered, onJump, onClose]);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16"
      style={{ background: 'rgb(0 0 0 / 0.55)', backdropFilter: 'blur(2px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div className="w-full max-w-2xl mx-4 rounded-2xl shadow-2xl overflow-hidden flex flex-col bg-surface border border-border-default"
        style={{ maxHeight: 'calc(100vh - 8rem)' }}>

        {/* Header */}
        <div className="px-4 pt-3 pb-2 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-dim">Session Tree</p>
            <div className="flex items-center gap-3 text-[10px] text-dim/60">
              <span>↑↓ move</span>
              <span>↵ jump</span>
              <span>esc close</span>
              <span className="tabular-nums">{filtered.length}/{all.length}</span>
            </div>
          </div>
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-elevated border border-border-subtle">
            <span className="text-dim text-[12px]">⌕</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setCursor(0); }}
              placeholder="Type to search…"
              className="flex-1 bg-transparent text-[13px] text-primary placeholder:text-dim outline-none"
            />
            {query && (
              <button onClick={() => { setQuery(''); setCursor(0); }} className="text-dim hover:text-secondary text-[11px]">✕</button>
            )}
          </div>
        </div>

        {/* List */}
        <div ref={listRef} className="overflow-y-auto flex-1 py-1">
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-[12px] text-dim text-center">No matches</p>
          )}
          {filtered.map((entry, vi) => {
            const isCursor = vi === cursor;
            const isCurrent = entry.index === currentIndex;
            return (
              <button
                key={entry.index}
                data-idx={vi}
                onClick={() => { onJump(entry.index); onClose(); }}
                className={[
                  'w-full flex items-baseline gap-2.5 px-4 py-1.5 text-left font-mono transition-colors',
                  isCursor ? 'bg-elevated' : 'hover:bg-elevated/50',
                ].join(' ')}
              >
                {/* Pointer */}
                <span className={`text-[11px] shrink-0 w-2 ${isCurrent ? 'text-accent' : 'text-border-default'}`}>
                  {isCurrent ? '▶' : '·'}
                </span>

                {/* Index */}
                <span className="text-[10px] text-dim/50 shrink-0 w-6 text-right tabular-nums">
                  {entry.index + 1}
                </span>

                {/* Label */}
                <span className={`text-[11px] font-semibold shrink-0 w-14 ${entry.color}`}>
                  {entry.label}
                </span>

                {/* Preview */}
                <span className="text-[12px] text-secondary flex-1 truncate">
                  {entry.preview}
                </span>

                {/* Duration */}
                {entry.duration != null && (
                  <span className="text-[10px] text-dim shrink-0">{fmtDuration(entry.duration)}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border-subtle flex items-center justify-between text-[10px] text-dim">
          <span>{cursor + 1} / {filtered.length}</span>
          <span className="opacity-60">click or ↵ to jump · esc to close</span>
        </div>
      </div>
    </div>
  );
}
