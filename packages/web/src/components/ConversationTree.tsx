import { useEffect, useMemo, useRef, useState } from 'react';
import type { MessageBlock } from '../types';
import { IconButton, Keycap, Pill, cx } from './ui';

// ── Filters ────────────────────────────────────────────────────────────────────

const FILTERS = [
  { key: 'all',   label: 'All',      hint: '^A', test: (_: string) => true },
  { key: 'user',  label: 'User',     hint: '^U', test: (l: string) => l === 'user' },
  { key: 'asst',  label: 'Asst',     hint: '^L', test: (l: string) => l === 'asst' || l === 'think' },
  { key: 'tools', label: 'Tools',    hint: '^T', test: (l: string) => !['user','asst','think','error','subagent','image'].includes(l) },
  { key: 'error', label: 'Errors',   hint: '^E', test: (l: string) => l === 'error' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

// ── Entry builder ──────────────────────────────────────────────────────────────

interface TreeEntry {
  index: number;
  type: MessageBlock['type'];
  label: string;
  preview: string;
  color: string;
  ts: string;
  duration?: number;
}

function buildEntries(messages: MessageBlock[]): TreeEntry[] {
  return messages.map((b, i) => {
    switch (b.type) {
      case 'user': {
        const imageCount = b.images?.length ?? 0;
        const textPreview = b.text.replace(/\n/g, ' ').slice(0, 120);
        const attachmentPreview = imageCount > 0
          ? `${imageCount} image attachment${imageCount === 1 ? '' : 's'}`
          : '';
        return {
          index: i,
          type: 'user',
          label: 'user',
          color: 'text-accent',
          preview: textPreview
            ? `${textPreview}${attachmentPreview ? ` · ${attachmentPreview}` : ''}`
            : attachmentPreview || '(empty message)',
          ts: b.ts,
        };
      }
      case 'text':
        return { index: i, type: 'text', label: 'asst',  color: 'text-primary',
          preview: b.text.replace(/\n/g, ' ').slice(0, 120), ts: b.ts };
      case 'thinking':
        return { index: i, type: 'thinking', label: 'think', color: 'text-steel/80',
          preview: b.text.replace(/\n/g, ' ').slice(0, 110), ts: b.ts };
      case 'tool_use': {
        const inp = b.input as Record<string, string>;
        const preview = inp.command ?? inp.path ?? inp.url ?? JSON.stringify(b.input).slice(0, 100);
        const colorMap: Record<string, string> = {
          bash: 'text-steel', read: 'text-teal', write: 'text-accent',
          edit: 'text-accent', web_fetch: 'text-success', web_search: 'text-success',
        };
        return { index: i, type: 'tool_use', label: b.tool,  color: colorMap[b.tool] ?? 'text-secondary',
          preview, ts: b.ts, duration: b.durationMs };
      }
      case 'subagent':
        return { index: i, type: 'subagent', label: 'subagent', color: 'text-warning',
          preview: b.name + ': ' + b.prompt.slice(0, 80), ts: b.ts };
      case 'image':
        return { index: i, type: 'image', label: 'image', color: 'text-teal',
          preview: b.alt || `${b.width}×${b.height}`, ts: b.ts };
      case 'error':
        return { index: i, type: 'error', label: 'error', color: 'text-danger',
          preview: b.message.slice(0, 100), ts: b.ts };
      default:
        return { index: i, type: b.type, label: '?', color: 'text-dim', preview: '', ts: '' };
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
  messages:      MessageBlock[];
  currentIndex?: number;
  onJump:        (index: number) => void;
  onClose:       () => void;
  /** If provided, user-message rows show a ⑂ fork button */
  onFork?:       (blockIndex: number) => void;
}

export function ConversationTree({ messages, currentIndex = 0, onJump, onClose, onFork }: Props) {
  const [query,     setQuery]     = useState('');
  const [filterIdx, setFilterIdx] = useState(0);
  const [cursor,    setCursor]    = useState(currentIndex);

  const listRef  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeFilter = FILTERS[filterIdx];

  const all = useMemo(() => buildEntries(messages), [messages]);

  const filtered = useMemo(() => {
    let entries = all.filter(e => activeFilter.test(e.label));
    if (query) {
      const q = query.toLowerCase();
      entries = entries.filter(e => e.label.includes(q) || e.preview.toLowerCase().includes(q));
    }
    return entries;
  }, [all, activeFilter, query]);

  // Clamp cursor when filter changes
  useEffect(() => { setCursor(c => Math.min(c, Math.max(0, filtered.length - 1))); }, [filtered.length]);

  // Focus on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Scroll cursor row into view
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // Keyboard
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;

      if (e.key === 'Escape')   { e.preventDefault(); onClose(); return; }
      if (e.key === 'Enter')    { e.preventDefault(); const en = filtered[cursor]; if (en) { onJump(en.index); onClose(); } return; }
      if (e.key === 'ArrowDown')  { e.preventDefault(); setCursor(c => Math.min(c + 1,  filtered.length - 1)); return; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); setCursor(c => Math.max(c - 1,  0)); return; }
      if (e.key === 'PageDown')   { e.preventDefault(); setCursor(c => Math.min(c + 15, filtered.length - 1)); return; }
      if (e.key === 'PageUp')     { e.preventDefault(); setCursor(c => Math.max(c - 15, 0)); return; }
      if (e.key === 'Home')       { e.preventDefault(); setCursor(0); return; }
      if (e.key === 'End')        { e.preventDefault(); setCursor(filtered.length - 1); return; }

      // Tab cycles filters (prevent default to avoid focus jump)
      if (e.key === 'Tab' && tag !== 'BUTTON') {
        e.preventDefault();
        setFilterIdx(i => e.shiftKey ? (i - 1 + FILTERS.length) % FILTERS.length : (i + 1) % FILTERS.length);
        setCursor(0);
        return;
      }

      // Ctrl shortcuts matching Pi's ^A ^U ^L ^T ^E
      if (e.ctrlKey) {
        const shortcutMap: Record<string, number> = { a: 0, u: 1, l: 2, t: 3, e: 4 };
        const fi = shortcutMap[e.key.toLowerCase()];
        if (fi !== undefined) { e.preventDefault(); setFilterIdx(fi); setCursor(0); }
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cursor, filtered, onJump, onClose]);

  // Count per filter for badges
  const counts = useMemo(() => {
    const result: Record<FilterKey, number> = { all: 0, user: 0, asst: 0, tools: 0, error: 0 };
    for (const f of FILTERS) {
      result[f.key as FilterKey] = all.filter(e => f.test(e.label)).length;
    }
    return result;
  }, [all]);

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.55)', backdropFilter: 'blur(2px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ui-dialog-shell" style={{ maxWidth: '900px', maxHeight: 'calc(100vh - 6rem)' }}>
        <div className="px-4 pt-3 pb-0 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-2.5 gap-3">
            <div>
              <p className="ui-section-label text-[11px]">Session Tree</p>
              <p className="text-[12px] text-secondary mt-1">Jump through the conversation without losing context.</p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-dim/70 font-mono">
              <Keycap>↑↓</Keycap>
              <span>move</span>
              <Keycap>Tab</Keycap>
              <span>filter</span>
              <Keycap>↵</Keycap>
              <span>jump</span>
              <Pill tone="muted" mono className="tabular-nums">{filtered.length}/{all.length}</Pill>
              <IconButton onClick={onClose} title="Close tree" aria-label="Close tree" compact>
                ✕
              </IconButton>
            </div>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-elevated border border-border-subtle mb-2.5">
            <span className="text-dim text-[12px]">⌕</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setCursor(0); }}
              placeholder="Type to search…"
              className="flex-1 bg-transparent text-[13px] text-primary placeholder:text-dim outline-none font-mono"
            />
            {query && (
              <button onClick={() => { setQuery(''); setCursor(0); inputRef.current?.focus(); }}
                className="text-dim hover:text-secondary text-[11px]">✕</button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="ui-segmented-control inline-flex mb-3">
            {FILTERS.map((f, i) => {
              const active = i === filterIdx;
              const count  = counts[f.key as FilterKey];
              return (
                <button
                  key={f.key}
                  onClick={() => { setFilterIdx(i); setCursor(0); inputRef.current?.focus(); }}
                  className={cx('ui-segmented-button', active && 'ui-segmented-button-active', 'flex items-center gap-1.5')}
                >
                  <span>{f.label}</span>
                  {count > 0 && (
                    <span className={`tabular-nums text-[10px] ${active ? 'text-accent' : 'text-dim/50'}`}>
                      {count}
                    </span>
                  )}
                  <span className={`font-mono text-[9px] ml-0.5 ${active ? 'text-dim' : 'text-dim/30'}`}>
                    {f.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── List ── */}
        <div ref={listRef} className="overflow-y-auto flex-1 py-1">
          {filtered.length === 0 && (
            <p className="px-6 py-8 text-[12px] text-dim text-center font-mono">
              {query ? `No matches for "${query}"` : 'No messages in this filter'}
            </p>
          )}
          {filtered.map((entry, vi) => {
            const isCursor  = vi === cursor;
            const isCurrent = entry.index === currentIndex;
            return (
              <button
                key={entry.index}
                data-idx={vi}
                onClick={() => { onJump(entry.index); onClose(); }}
                className={[
                  'group w-full flex items-baseline gap-3 px-5 py-1.5 text-left font-mono transition-colors',
                  isCursor ? 'bg-elevated' : 'hover:bg-elevated/40',
                ].join(' ')}
              >
                {/* Current pointer */}
                <span className={`text-[11px] shrink-0 w-2 ${isCurrent ? 'text-accent' : 'text-border-default/50'}`}>
                  {isCurrent ? '▶' : '·'}
                </span>

                {/* Index */}
                <span className="text-[10px] text-dim/40 shrink-0 w-7 text-right tabular-nums select-none">
                  {entry.index + 1}
                </span>

                {/* Label */}
                <span className={`text-[11px] font-semibold shrink-0 w-16 ${entry.color}`}>
                  {entry.label}
                </span>

                {/* Preview */}
                <span className="text-[12px] text-secondary flex-1 truncate">
                  {entry.preview}
                </span>

                {/* Duration */}
                {entry.duration != null && (
                  <span className="text-[10px] text-dim/60 shrink-0 tabular-nums">{fmtDuration(entry.duration)}</span>
                )}

                {/* Fork button — only for user messages when onFork provided */}
                {onFork && entry.type === 'user' && (
                  <button
                    onClick={e => { e.stopPropagation(); onFork(entry.index); onClose(); }}
                    title="Fork from here in a new tab"
                    className="shrink-0 text-[11px] text-dim/50 hover:text-accent opacity-0 group-hover:opacity-100 transition-all px-1"
                  >
                    ⑂
                  </button>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-2.5 border-t border-border-subtle flex items-center justify-between text-[10px] text-dim/60 font-mono gap-3">
          <Pill tone="muted" mono>{filtered.length > 0 ? `${cursor + 1} / ${filtered.length}` : '0 / 0'}</Pill>
          <span>Tab / Shift+Tab cycle filters · click or ↵ to jump · esc to close</span>
        </div>
      </div>
    </div>
  );
}
