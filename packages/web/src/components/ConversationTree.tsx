import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationTreeNode as TreeNode } from '../types';
import { IconButton, Keycap, Pill, cx } from './ui';

const FILTERS = [
  { key: 'all', label: 'All', hint: '^A', test: (_label: string) => true },
  { key: 'user', label: 'User', hint: '^U', test: (label: string) => label === 'user' },
  { key: 'asst', label: 'Asst', hint: '^L', test: (label: string) => label === 'asst' || label === 'think' || label === 'compact' || label === 'branch' },
  { key: 'tools', label: 'Tools', hint: '^T', test: (label: string) => !['user', 'asst', 'think', 'compact', 'branch', 'error'].includes(label) },
  { key: 'error', label: 'Errors', hint: '^E', test: (label: string) => label === 'error' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

interface GutterInfo {
  position: number;
  show: boolean;
}

interface FlatTreeEntry extends TreeNode {
  parentId: string | null;
  indent: number;
  showConnector: boolean;
  isLast: boolean;
  gutters: GutterInfo[];
  isVirtualRootChild: boolean;
  selectable: boolean;
}

interface VisibleTreeLayout {
  entries: FlatTreeEntry[];
  multipleRoots: boolean;
}

function colorClass(entry: FlatTreeEntry): string {
  if (entry.kind === 'user') {
    return 'text-accent';
  }

  if (entry.kind === 'summary') {
    return 'text-warning';
  }

  if (entry.kind === 'thinking') {
    return 'text-steel/80';
  }

  if (entry.kind === 'tool') {
    const toolColors: Record<string, string> = {
      bash: 'text-steel',
      read: 'text-teal',
      write: 'text-accent',
      edit: 'text-accent',
      web_fetch: 'text-success',
      web_search: 'text-success',
    };
    return toolColors[entry.label] ?? 'text-secondary';
  }

  if (entry.kind === 'error') {
    return 'text-danger';
  }

  return 'text-primary';
}

function collectContainsActive(node: TreeNode, result: Map<string, boolean>): boolean {
  const childHasActive = node.children.some((child) => collectContainsActive(child, result));
  const containsActive = node.onActivePath || childHasActive;
  result.set(node.id, containsActive);
  return containsActive;
}

function prioritizeActiveNodes(nodes: TreeNode[], containsActive: Map<string, boolean>): TreeNode[] {
  const active: TreeNode[] = [];
  const inactive: TreeNode[] = [];

  for (const node of nodes) {
    if (containsActive.get(node.id)) {
      active.push(node);
    } else {
      inactive.push(node);
    }
  }

  return [...active, ...inactive];
}

function flattenTreeNodes(roots: TreeNode[]): FlatTreeEntry[] {
  const containsActive = new Map<string, boolean>();
  for (const root of roots) {
    collectContainsActive(root, containsActive);
  }

  const multipleRoots = roots.length > 1;
  const entries: FlatTreeEntry[] = [];

  function walk(
    node: TreeNode,
    parentId: string | null,
    options: {
      indent: number;
      justBranched: boolean;
      showConnector: boolean;
      isLast: boolean;
      gutters: GutterInfo[];
      isVirtualRootChild: boolean;
    },
  ) {
    entries.push({
      ...node,
      parentId,
      indent: options.indent,
      showConnector: options.showConnector,
      isLast: options.isLast,
      gutters: options.gutters,
      isVirtualRootChild: options.isVirtualRootChild,
      selectable: typeof node.blockIndex === 'number',
    });

    const orderedChildren = prioritizeActiveNodes(node.children, containsActive);
    const multipleChildren = orderedChildren.length > 1;
    const childIndent = multipleChildren
      ? options.indent + 1
      : options.justBranched && options.indent > 0
        ? options.indent + 1
        : options.indent;

    const connectorDisplayed = options.showConnector && !options.isVirtualRootChild;
    const currentDisplayIndent = multipleRoots ? Math.max(0, options.indent - 1) : options.indent;
    const connectorPosition = Math.max(0, currentDisplayIndent - 1);
    const childGutters = connectorDisplayed
      ? [...options.gutters, { position: connectorPosition, show: !options.isLast }]
      : options.gutters;

    orderedChildren.forEach((child, index) => {
      walk(child, node.id, {
        indent: childIndent,
        justBranched: multipleChildren,
        showConnector: multipleChildren,
        isLast: index === orderedChildren.length - 1,
        gutters: childGutters,
        isVirtualRootChild: false,
      });
    });
  }

  const orderedRoots = prioritizeActiveNodes(roots, containsActive);
  orderedRoots.forEach((root, index) => {
    walk(root, null, {
      indent: multipleRoots ? 1 : 0,
      justBranched: multipleRoots,
      showConnector: multipleRoots,
      isLast: index === orderedRoots.length - 1,
      gutters: [],
      isVirtualRootChild: multipleRoots,
    });
  });

  return entries;
}

function recalculateVisibleLayout(allEntries: FlatTreeEntry[], filteredEntries: FlatTreeEntry[]): VisibleTreeLayout {
  if (filteredEntries.length === 0) {
    return { entries: [], multipleRoots: false };
  }

  const nextEntries = filteredEntries.map((entry) => ({
    ...entry,
    gutters: [...entry.gutters],
  }));

  const visibleIds = new Set(nextEntries.map((entry) => entry.id));
  const byId = new Map(allEntries.map((entry) => [entry.id, entry] satisfies [string, FlatTreeEntry]));

  const findVisibleAncestor = (entryId: string): string | null => {
    let currentId = byId.get(entryId)?.parentId ?? null;
    while (currentId !== null) {
      if (visibleIds.has(currentId)) {
        return currentId;
      }
      currentId = byId.get(currentId)?.parentId ?? null;
    }
    return null;
  };

  const visibleParent = new Map<string, string | null>();
  const visibleChildren = new Map<string | null, string[]>([[null, []]]);

  for (const entry of nextEntries) {
    const parentId = findVisibleAncestor(entry.id);
    visibleParent.set(entry.id, parentId);

    const siblings = visibleChildren.get(parentId) ?? [];
    siblings.push(entry.id);
    visibleChildren.set(parentId, siblings);
  }

  const visibleRoots = visibleChildren.get(null) ?? [];
  const multipleRoots = visibleRoots.length > 1;
  const visibleById = new Map(nextEntries.map((entry) => [entry.id, entry] satisfies [string, FlatTreeEntry]));

  function walk(
    entryId: string,
    options: {
      indent: number;
      justBranched: boolean;
      showConnector: boolean;
      isLast: boolean;
      gutters: GutterInfo[];
      isVirtualRootChild: boolean;
    },
  ) {
    const entry = visibleById.get(entryId);
    if (!entry) {
      return;
    }

    entry.parentId = visibleParent.get(entryId) ?? null;
    entry.indent = options.indent;
    entry.showConnector = options.showConnector;
    entry.isLast = options.isLast;
    entry.gutters = options.gutters;
    entry.isVirtualRootChild = options.isVirtualRootChild;

    const children = visibleChildren.get(entryId) ?? [];
    const multipleChildren = children.length > 1;
    const childIndent = multipleChildren
      ? options.indent + 1
      : options.justBranched && options.indent > 0
        ? options.indent + 1
        : options.indent;

    const connectorDisplayed = options.showConnector && !options.isVirtualRootChild;
    const currentDisplayIndent = multipleRoots ? Math.max(0, options.indent - 1) : options.indent;
    const connectorPosition = Math.max(0, currentDisplayIndent - 1);
    const childGutters = connectorDisplayed
      ? [...options.gutters, { position: connectorPosition, show: !options.isLast }]
      : options.gutters;

    children.forEach((childId, index) => {
      walk(childId, {
        indent: childIndent,
        justBranched: multipleChildren,
        showConnector: multipleChildren,
        isLast: index === children.length - 1,
        gutters: childGutters,
        isVirtualRootChild: false,
      });
    });
  }

  visibleRoots.forEach((entryId, index) => {
    walk(entryId, {
      indent: multipleRoots ? 1 : 0,
      justBranched: multipleRoots,
      showConnector: multipleRoots,
      isLast: index === visibleRoots.length - 1,
      gutters: [],
      isVirtualRootChild: multipleRoots,
    });
  });

  return { entries: nextEntries, multipleRoots };
}

function buildPrefix(entry: FlatTreeEntry, multipleRoots: boolean): string {
  const displayIndent = multipleRoots ? Math.max(0, entry.indent - 1) : entry.indent;
  const connector = entry.showConnector && !entry.isVirtualRootChild;
  const connectorPosition = connector ? displayIndent - 1 : -1;
  const totalChars = displayIndent * 3;
  const chars: string[] = [];

  for (let index = 0; index < totalChars; index += 1) {
    const level = Math.floor(index / 3);
    const posInLevel = index % 3;
    const gutter = entry.gutters.find((item) => item.position === level);

    if (gutter) {
      chars.push(posInLevel === 0 ? (gutter.show ? '│' : ' ') : ' ');
      continue;
    }

    if (connector && level === connectorPosition) {
      if (posInLevel === 0) {
        chars.push(entry.isLast ? '└' : '├');
      } else if (posInLevel === 1) {
        chars.push('─');
      } else {
        chars.push(' ');
      }
      continue;
    }

    chars.push(' ');
  }

  return chars.join('');
}

interface Props {
  tree: TreeNode[];
  loading?: boolean;
  onJump: (index: number) => void;
  onClose: () => void;
  onFork?: (blockIndex: number) => void;
}

export function ConversationTree({ tree, loading = false, onJump, onClose, onFork }: Props) {
  const [query, setQuery] = useState('');
  const [filterIdx, setFilterIdx] = useState(0);
  const [cursor, setCursor] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeFilter = FILTERS[filterIdx];
  const allEntries = useMemo(() => flattenTreeNodes(tree), [tree]);
  const layout = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filteredEntries = allEntries.filter((entry) => {
      if (!activeFilter.test(entry.label)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return entry.label.includes(normalizedQuery) || entry.preview.toLowerCase().includes(normalizedQuery);
    });

    return recalculateVisibleLayout(allEntries, filteredEntries);
  }, [activeFilter, allEntries, query]);
  const filtered = layout.entries;

  useEffect(() => {
    const activeIndex = filtered.findIndex((entry) => entry.active);
    const fallbackIndex = activeIndex >= 0 ? activeIndex : filtered.findIndex((entry) => entry.selectable);
    if (fallbackIndex >= 0) {
      setCursor(fallbackIndex);
      return;
    }

    setCursor(0);
  }, [filtered]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const handleSelect = (entry: FlatTreeEntry | undefined) => {
    if (entry?.blockIndex == null) {
      return;
    }

    onJump(entry.blockIndex);
    onClose();
  };

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement).tagName;

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        handleSelect(filtered[cursor]);
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
        setCursor((current) => Math.min(current + 15, Math.max(filtered.length - 1, 0)));
        return;
      }

      if (event.key === 'PageUp') {
        event.preventDefault();
        setCursor((current) => Math.max(current - 15, 0));
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
        return;
      }

      if (event.key === 'Tab' && tag !== 'BUTTON') {
        event.preventDefault();
        setFilterIdx((current) => event.shiftKey
          ? (current - 1 + FILTERS.length) % FILTERS.length
          : (current + 1) % FILTERS.length);
        setCursor(0);
        return;
      }

      if (event.ctrlKey) {
        const shortcutMap: Record<string, number> = { a: 0, u: 1, l: 2, t: 3, e: 4 };
        const nextFilter = shortcutMap[event.key.toLowerCase()];
        if (nextFilter !== undefined) {
          event.preventDefault();
          setFilterIdx(nextFilter);
          setCursor(0);
        }
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cursor, filtered, onClose]);

  const counts = useMemo(() => {
    const result: Record<FilterKey, number> = { all: 0, user: 0, asst: 0, tools: 0, error: 0 };
    for (const filter of FILTERS) {
      result[filter.key as FilterKey] = allEntries.filter((entry) => filter.test(entry.label)).length;
    }
    return result;
  }, [allEntries]);

  const footerLabel = filtered.length > 0 ? `${cursor + 1} / ${filtered.length}` : '0 / 0';

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.55)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="ui-dialog-shell" style={{ maxWidth: '980px', maxHeight: 'calc(100vh - 6rem)' }}>
        <div className="px-4 pt-3 pb-0 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-2.5 gap-3">
            <div>
              <p className="ui-section-label text-[11px]">Session Tree</p>
              <p className="text-[12px] text-secondary mt-1">Browse the active branch without the staircase indentation.</p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-dim/70 font-mono">
              <Keycap>↑↓</Keycap>
              <span>move</span>
              <Keycap>Tab</Keycap>
              <span>filter</span>
              <Keycap>↵</Keycap>
              <span>jump</span>
              <Pill tone="muted" mono className="tabular-nums">{filtered.length}/{allEntries.length}</Pill>
              <IconButton onClick={onClose} title="Close tree" aria-label="Close tree" compact>
                ✕
              </IconButton>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-elevated border border-border-subtle mb-2.5">
            <span className="text-dim text-[12px]">⌕</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
              placeholder="Type to search…"
              className="flex-1 bg-transparent text-[13px] text-primary placeholder:text-dim outline-none font-mono"
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

          <div className="ui-segmented-control inline-flex mb-3">
            {FILTERS.map((filter, index) => {
              const active = index === filterIdx;
              const count = counts[filter.key as FilterKey];
              return (
                <button
                  key={filter.key}
                  onClick={() => { setFilterIdx(index); setCursor(0); inputRef.current?.focus(); }}
                  className={cx('ui-segmented-button', active && 'ui-segmented-button-active', 'flex items-center gap-1.5')}
                >
                  <span>{filter.label}</span>
                  {count > 0 && (
                    <span className={`tabular-nums text-[10px] ${active ? 'text-accent' : 'text-dim/50'}`}>
                      {count}
                    </span>
                  )}
                  <span className={`font-mono text-[9px] ml-0.5 ${active ? 'text-dim' : 'text-dim/30'}`}>
                    {filter.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div ref={listRef} className="overflow-y-auto flex-1 py-1">
          {loading && (
            <p className="px-6 py-8 text-[12px] text-dim text-center font-mono">Loading conversation tree…</p>
          )}

          {!loading && filtered.length === 0 && (
            <p className="px-6 py-8 text-[12px] text-dim text-center font-mono">
              {query ? `No matches for "${query}"` : allEntries.length === 0 ? 'No conversation history yet' : 'No entries in this filter'}
            </p>
          )}

          {!loading && filtered.map((entry, visibleIndex) => {
            const isCursor = visibleIndex === cursor;
            const isSelectable = entry.selectable;
            const prefix = buildPrefix(entry, layout.multipleRoots);
            return (
              <button
                key={entry.id}
                data-idx={visibleIndex}
                onClick={() => handleSelect(entry)}
                className={cx(
                  'group w-full flex items-baseline gap-3 px-5 py-1.5 text-left font-mono transition-colors',
                  isCursor ? 'bg-elevated' : 'hover:bg-elevated/40',
                  !isSelectable && 'opacity-60',
                )}
                title={entry.preview}
              >
                <span className={`text-[11px] shrink-0 w-2 ${entry.active ? 'text-accent' : entry.onActivePath ? 'text-teal' : 'text-border-default/50'}`}>
                  {entry.active ? '▶' : entry.onActivePath ? '•' : '○'}
                </span>

                <span className="shrink-0 min-w-0 text-[11px] text-dim/30 whitespace-pre">
                  {prefix || ' '}
                </span>

                <span className={`text-[11px] font-semibold shrink-0 w-16 ${colorClass(entry)}`}>
                  {entry.label}
                </span>

                <span className={cx('text-[12px] flex-1 truncate', entry.onActivePath ? 'text-secondary' : 'text-dim/70')}>
                  {entry.preview}
                </span>

                {onFork && entry.label === 'user' && entry.onActivePath && entry.blockIndex != null && (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onFork(entry.blockIndex);
                      onClose();
                    }}
                    title="Fork into a new conversation from here"
                    className="shrink-0 text-[11px] text-dim/50 hover:text-accent opacity-0 group-hover:opacity-100 transition-all px-1"
                  >
                    ⑂
                  </button>
                )}
              </button>
            );
          })}
        </div>

        <div className="px-5 py-2.5 border-t border-border-subtle flex items-center justify-between text-[10px] text-dim/60 font-mono gap-3">
          <Pill tone="muted" mono>{footerLabel}</Pill>
          <span>Only branch points deepen indentation; inactive forks stay visible but dimmer.</span>
        </div>
      </div>
    </div>
  );
}
