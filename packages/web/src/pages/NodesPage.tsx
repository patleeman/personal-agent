import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { emitMemoriesChanged, MEMORIES_CHANGED_EVENT } from '../memoryDocEvents';
import { emitProjectsChanged, PROJECTS_CHANGED_EVENT } from '../projectEvents';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PageHeading,
  ToolbarButton,
  cx,
} from '../components/ui';
import type {
  NodeBrowserData,
  NodeBrowserSummary,
  NodeLinkKind,
  ProjectDetail,
  SkillDetail,
} from '../types';
import {
  buildNodeCreateSearch,
  buildNodesSearch,
  getNodeGroupValue,
  matchesNodeBrowserQuery,
  readCreateNodeKind,
  readCreateNodeParent,
  readCreatingNode,
  readNodeBrowserDateField,
  readNodeBrowserDateRange,
  readNodeBrowserDensity,
  readNodeBrowserFilter,
  readNodeBrowserGroupBy,
  readNodeBrowserQuery,
  readNodeBrowserSort,
  readSelectedNode,
  type NodeBrowserDateField,
  type NodeBrowserDensity,
  type NodeBrowserFilter,
  type NodeBrowserGroupBy,
  type NodeBrowserSort,
} from '../nodeWorkspaceState';
import { buildOpenNodeShelfId, ensureOpenResourceShelfItem } from '../openResourceShelves';
import { ProjectDetailPanel } from '../components/ProjectDetailPanel';
import { RichMarkdownEditor } from '../components/editor/RichMarkdownEditor';
import { NoteWorkspace } from './MemoriesPage';
import { NOTE_ID_SEARCH_PARAM } from '../noteWorkspaceState';
import {
  buildSkillsSearch,
  readSkillView,
  SKILL_ITEM_SEARCH_PARAM,
  SKILL_SEARCH_PARAM,
  SKILL_VIEW_SEARCH_PARAM,
} from '../skillWorkspaceState';
import { SkillWorkspace } from './SkillsPage';
import { timeAgo } from '../utils';
import type { SavedNodeBrowserView } from '../types';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const SELECT_CLASS = `${INPUT_CLASS} sm:w-auto`;
const QUERY_INPUT_CLASS = `${INPUT_CLASS} font-mono text-[12px]`;
const PAGE_GROUP_ORDER = ['page', 'skill'] as const;
const GROUP_BY_OPTIONS: Array<{ value: NodeBrowserGroupBy; label: string }> = [
  { value: 'kind', label: 'Doc type' },
  { value: 'none', label: 'No grouping' },
  { value: 'status', label: 'Status' },
  { value: 'profile', label: 'Profile' },
  { value: 'area', label: 'Area' },
];
const SORT_OPTIONS: Array<{ value: NodeBrowserSort; label: string }> = [
  { value: 'updated_desc', label: 'Recently updated' },
  { value: 'updated_asc', label: 'Least recently updated' },
  { value: 'created_desc', label: 'Recently created' },
  { value: 'created_asc', label: 'Least recently created' },
  { value: 'title_asc', label: 'Title (A–Z)' },
  { value: 'title_desc', label: 'Title (Z–A)' },
  { value: 'status_asc', label: 'Status' },
];
const BUILT_IN_VIEW_OPTIONS: Array<{ value: NodeBrowserFilter; label: string }> = [
  { value: 'all', label: 'All docs' },
  { value: 'page', label: 'Docs' },
  { value: 'skill', label: 'Skills' },
];
const CORE_QUERY_FIELDS = [
  { key: 'type', detail: 'page or skill' },
  { key: 'status', detail: 'active, inbox, done, archived…' },
  { key: 'profile', detail: 'profile ownership tag' },
  { key: 'area', detail: 'domain or work area' },
  { key: 'parent', detail: 'parent page id' },
  { key: 'tag', detail: 'raw tag value' },
  { key: 'id', detail: 'page id' },
  { key: 'title', detail: 'title text' },
] as const;

type SelectedNodeDetail =
  | { kind: 'note'; detail: Awaited<ReturnType<typeof api.noteDoc>> }
  | { kind: 'skill'; detail: SkillDetail }
  | { kind: 'project'; detail: ProjectDetail };

type GroupedNodeEntry = { key: string; label: string; items: NodeBrowserSummary[] };

function kindLabel(kind: NodeLinkKind | 'page'): string {
  switch (kind) {
    case 'skill':
      return 'Skill';
    case 'note':
    case 'project':
    case 'page':
      return 'Doc';
  }
}

function pluralKindLabel(kind: NodeLinkKind | 'page'): string {
  switch (kind) {
    case 'skill':
      return 'Skills';
    case 'note':
    case 'project':
    case 'page':
      return 'Docs';
  }
}

function formatPageRoleCount(kind: NodeLinkKind | 'page', count: number): string {
  const label = count === 1 ? kindLabel(kind).toLowerCase() : pluralKindLabel(kind).toLowerCase();
  return `${count} ${label}`;
}

function humanizeStatus(status: string): string {
  const normalized = status.replace(/[_-]+/g, ' ').trim();
  if (!normalized) {
    return 'Unknown';
  }
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stripWorkspaceParams(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(SKILL_SEARCH_PARAM);
  params.delete(SKILL_VIEW_SEARCH_PARAM);
  params.delete(SKILL_ITEM_SEARCH_PARAM);
  params.delete(NOTE_ID_SEARCH_PARAM);
  params.delete('memory');
  params.delete('item');
  params.delete('view');
  params.delete('new');
  params.delete('createType');
  const next = params.toString();
  return next ? `?${next}` : '';
}

function summarizeNodeContext(node: NodeBrowserSummary): { primary: string; secondary: string | null; tags: string[] } {
  const visibleTags = node.tags
    .filter((tag) => !/^(type|status):/i.test(tag))
    .slice(0, 3);

  switch (node.kind) {
    case 'note': {
      const referenceCount = node.note?.referenceCount ?? 0;
      const primary = referenceCount > 0 ? `${referenceCount} ${referenceCount === 1 ? 'reference' : 'references'}` : 'Doc';
      return { primary, secondary: humanizeStatus(node.status), tags: visibleTags };
    }
    case 'skill': {
      const usage = node.skill?.usedInLastSession
        ? 'Used recently'
        : node.skill?.lastUsedAt
          ? `Used ${timeAgo(node.skill.lastUsedAt)}`
          : 'Not used recently';
      return { primary: node.skill?.source ?? 'skill', secondary: usage, tags: visibleTags };
    }
    case 'project': {
      const open = node.project?.openTaskCount ?? 0;
      const done = node.project?.doneTaskCount ?? 0;
      const taskSummary = `${open} open · ${done} done`;
      const secondary = [taskSummary, node.project?.profile ?? null].filter(Boolean).join(' · ');
      return { primary: humanizeStatus(node.status), secondary, tags: visibleTags };
    }
  }
}

function compareNodeItems(left: NodeBrowserSummary, right: NodeBrowserSummary, sort: NodeBrowserSort): number {
  switch (sort) {
    case 'updated_asc':
      return (left.updatedAt ?? '').localeCompare(right.updatedAt ?? '') || left.title.localeCompare(right.title);
    case 'created_desc':
      return (right.createdAt ?? '').localeCompare(left.createdAt ?? '') || left.title.localeCompare(right.title);
    case 'created_asc':
      return (left.createdAt ?? '').localeCompare(right.createdAt ?? '') || left.title.localeCompare(right.title);
    case 'title_desc':
      return right.title.localeCompare(left.title) || right.id.localeCompare(left.id);
    case 'status_asc':
      return left.status.localeCompare(right.status) || left.title.localeCompare(right.title);
    case 'title_asc':
      return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
    case 'updated_desc':
    default:
      return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '') || left.title.localeCompare(right.title);
  }
}

function matchesDateRange(node: NodeBrowserSummary, field: NodeBrowserDateField, from: string | null, to: string | null): boolean {
  if (!from && !to) {
    return true;
  }

  const rawValue = field === 'created' ? node.createdAt : node.updatedAt;
  if (!rawValue) {
    return false;
  }

  const dateValue = new Date(rawValue);
  if (Number.isNaN(dateValue.getTime())) {
    return false;
  }

  if (from) {
    const start = new Date(`${from}T00:00:00`);
    if (dateValue < start) {
      return false;
    }
  }

  if (to) {
    const end = new Date(`${to}T23:59:59.999`);
    if (dateValue > end) {
      return false;
    }
  }

  return true;
}

function matchesBrowserFilters(
  node: NodeBrowserSummary,
  filter: NodeBrowserFilter,
  query: string,
  dateField: NodeBrowserDateField,
  dateRange: { from: string | null; to: string | null },
): boolean {
  if (filter === 'skill' && node.kind !== 'skill') {
    return false;
  }
  if (filter === 'page' && node.kind === 'skill') {
    return false;
  }
  if (!matchesNodeBrowserQuery(node, query)) {
    return false;
  }
  return matchesDateRange(node, dateField, dateRange.from, dateRange.to);
}

function normalizeGroupKind(kind: NodeLinkKind): 'page' | 'skill' {
  return kind === 'skill' ? 'skill' : 'page';
}

function sortGroupEntries(left: { key: string }, right: { key: string }, groupBy: NodeBrowserGroupBy): number {
  if (groupBy === 'kind') {
    return PAGE_GROUP_ORDER.indexOf(left.key as (typeof PAGE_GROUP_ORDER)[number]) - PAGE_GROUP_ORDER.indexOf(right.key as (typeof PAGE_GROUP_ORDER)[number]);
  }
  return left.key.localeCompare(right.key);
}

function buildGroupedNodes(nodes: NodeBrowserSummary[], groupBy: NodeBrowserGroupBy): GroupedNodeEntry[] {
  if (groupBy === 'none') {
    return [{ key: 'all', label: 'All docs', items: nodes }];
  }

  const map = new Map<string, NodeBrowserSummary[]>();
  for (const node of nodes) {
    const key = groupBy === 'kind' ? normalizeGroupKind(node.kind) : getNodeGroupValue(node, groupBy);
    const existing = map.get(key) ?? [];
    existing.push(node);
    map.set(key, existing);
  }

  return [...map.entries()]
    .map(([key, items]) => ({
      key,
      label: groupBy === 'kind'
        ? pluralKindLabel(key as NodeLinkKind | 'page')
        : groupBy === 'status'
          ? humanizeStatus(key)
          : key === 'untagged'
            ? 'Untagged'
            : key,
      items,
    }))
    .sort((left, right) => sortGroupEntries(left, right, groupBy));
}

function buildNodeHref(locationSearch: string, item: { kind: NodeLinkKind; id: string }): string {
  const baseSearch = stripWorkspaceParams(locationSearch);
  return `/pages${buildNodesSearch(baseSearch, {
    kind: item.kind,
    nodeId: item.id,
  })}`;
}

function buildOverviewHref(locationSearch: string): string {
  const baseSearch = stripWorkspaceParams(locationSearch);
  return `/pages${buildNodesSearch(baseSearch, {
    kind: null,
    nodeId: null,
  })}`;
}

function buildSavedBrowserViewSearch(locationSearch: string): string {
  const baseSearch = stripWorkspaceParams(locationSearch);
  return buildNodesSearch(baseSearch, {
    kind: null,
    nodeId: null,
  });
}

function readQueryToken(query: string, cursor: number) {
  const clampedCursor = Math.max(0, Math.min(cursor, query.length));
  const beforeCursor = query.slice(0, clampedCursor);
  const match = beforeCursor.match(/(^|[\s(])([^\s()]*)$/);
  const token = match?.[2] ?? '';
  return {
    start: clampedCursor - token.length,
    end: clampedCursor,
    token,
  };
}

function buildQueryFieldInsertion(query: string, cursor: number, fieldKey: string) {
  const snippet = `${fieldKey}:`;
  const { start, end, token } = readQueryToken(query, cursor);
  const normalizedToken = token.replace(/^[+-]/, '');
  const shouldReplaceToken = normalizedToken.length > 0 && !normalizedToken.includes(':');
  const insertStart = shouldReplaceToken ? start : end;
  const prefix = query.slice(0, insertStart);
  const suffix = query.slice(end);
  const separator = prefix.length > 0 && !/[\s(]$/.test(prefix) ? ' ' : '';
  const nextQuery = `${prefix}${separator}${snippet}${suffix}`;
  return {
    nextQuery,
    nextCursor: prefix.length + separator.length + snippet.length,
  };
}

function LuceneQueryInput({
  query,
  visibleCount,
  onQueryChange,
}: {
  query: string;
  visibleCount: number;
  onQueryChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);

  const suggestions = useMemo(() => {
    if (!focused) {
      return [];
    }
    const { token } = readQueryToken(query, cursor ?? query.length);
    const normalizedToken = token.replace(/^[+-]/, '').toLowerCase();
    if (normalizedToken.includes(':')) {
      return [];
    }
    return CORE_QUERY_FIELDS.filter((field) => normalizedToken.length === 0 || field.key.startsWith(normalizedToken));
  }, [cursor, focused, query]);

  useEffect(() => {
    if (suggestions.length === 0) {
      setActiveSuggestionIndex(0);
      return;
    }
    setActiveSuggestionIndex((current) => Math.min(current, suggestions.length - 1));
  }, [suggestions]);

  const applyField = useCallback((fieldKey: string) => {
    const currentCursor = inputRef.current?.selectionStart ?? cursor ?? query.length;
    const insertion = buildQueryFieldInsertion(query, currentCursor, fieldKey);
    onQueryChange(insertion.nextQuery);
    setCursor(insertion.nextCursor);
    setActiveSuggestionIndex(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(insertion.nextCursor, insertion.nextCursor);
    });
  }, [cursor, onQueryChange, query]);

  const activeSuggestion = suggestions[activeSuggestionIndex] ?? null;

  return (
    <div className="space-y-2">
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Lucene query</span>
        <div className="relative">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setCursor(event.target.selectionStart ?? event.target.value.length);
              onQueryChange(event.target.value);
            }}
            onFocus={(event) => {
              setFocused(true);
              setCursor(event.target.selectionStart ?? event.target.value.length);
            }}
            onClick={(event) => setCursor(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
            onKeyDown={(event) => {
              event.stopPropagation();

              if (suggestions.length === 0) {
                return;
              }

              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveSuggestionIndex((current) => (current + 1) % suggestions.length);
                return;
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
                return;
              }

              if ((event.key === 'Enter' || event.key === 'Tab') && activeSuggestion) {
                event.preventDefault();
                applyField(activeSuggestion.key);
                return;
              }

              if (event.key === 'Escape') {
                event.preventDefault();
                setFocused(false);
                setActiveSuggestionIndex(0);
              }
            }}
            onKeyUp={(event) => setCursor(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
            onBlur={() => setFocused(false)}
            placeholder='type:page AND status:active AND area:architecture'
            aria-label="Lucene query"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            aria-activedescendant={activeSuggestion ? `lucene-query-suggestion-${activeSuggestion.key}` : undefined}
            className={QUERY_INPUT_CLASS}
            autoComplete="off"
            spellCheck={false}
          />
          {suggestions.length > 0 ? (
            <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-border-default bg-surface shadow-lg shadow-black/20" role="listbox" aria-label="Lucene query field suggestions">
              {suggestions.map((field, index) => {
                const selected = index === activeSuggestionIndex;
                return (
                  <button
                    key={field.key}
                    id={`lucene-query-suggestion-${field.key}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveSuggestionIndex(index)}
                    onClick={() => applyField(field.key)}
                    className={cx(
                      'flex w-full items-start justify-between gap-3 border-t border-border-subtle px-3 py-2 text-left first:border-t-0 hover:bg-surface-hover',
                      selected && 'bg-surface-hover',
                    )}
                  >
                    <span className="font-mono text-[12px] text-primary">{field.key}:</span>
                    <span className="text-[11px] text-dim">{field.detail}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </label>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-dim">
        <span>{visibleCount} visible</span>
        <span className="opacity-40">·</span>
        <span>Insert field</span>
        {CORE_QUERY_FIELDS.map((field) => (
          <button
            key={field.key}
            type="button"
            onClick={() => applyField(field.key)}
            className="font-mono text-secondary transition-colors hover:text-primary"
          >
            {field.key}:
          </button>
        ))}
      </div>
    </div>
  );
}

const TABLE_ACTION_ICON_CLASS = 'inline-flex h-8 w-8 items-center justify-center rounded-full border border-border-subtle bg-base/40 text-secondary transition-colors hover:bg-surface hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-base disabled:cursor-default disabled:opacity-40';

function TableActionIcon({ paths }: { paths: string[] }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

function NodeActionIconLink({
  to,
  label,
  tone = 'default',
  children,
}: {
  to: string;
  label: string;
  tone?: 'default' | 'danger';
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className={cx(
        TABLE_ACTION_ICON_CLASS,
        tone === 'danger' && 'text-danger hover:bg-danger/10 hover:text-danger',
      )}
    >
      {children}
    </Link>
  );
}

function NodeActionIconButton({
  label,
  tone = 'default',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        TABLE_ACTION_ICON_CLASS,
        tone === 'danger' && 'text-danger hover:bg-danger/10 hover:text-danger',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function NodesTable({
  groups,
  groupBy,
  locationSearch,
  density,
  deletingKey,
  onDelete,
}: {
  groups: GroupedNodeEntry[];
  groupBy: NodeBrowserGroupBy;
  locationSearch: string;
  density: NodeBrowserDensity;
  deletingKey: string | null;
  onDelete: (item: NodeBrowserSummary) => Promise<void> | void;
}) {
  const cellClassName = density === 'dense' ? 'px-3 py-2 align-top' : 'px-3 py-3 align-top';
  const showGroupHeaders = groupBy !== 'none';

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle">
      <table className="min-w-full border-collapse text-left text-[12px]">
        <thead className="bg-base/70 text-[10px] uppercase tracking-[0.12em] text-dim">
          <tr>
            <th className="px-3 py-2.5 font-medium">Title</th>
            <th className="px-3 py-2.5 font-medium">Role</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 font-medium">Updated</th>
            <th className="px-3 py-2.5 font-medium">Context</th>
            <th className="px-3 py-2.5 font-medium">Tags</th>
            <th className="w-[7.5rem] px-3 py-2.5 font-medium text-right whitespace-nowrap">Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group, groupIndex) => (
            <Fragment key={group.key}>
              {showGroupHeaders ? (
                <tr className={cx(groupIndex > 0 && 'border-t border-border-default')}>
                  <th colSpan={7} className="bg-base/35 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">
                    <div className="flex items-center justify-between gap-3">
                      <span>{group.label}</span>
                      <span className="font-mono text-[10px] text-dim">{group.items.length}</span>
                    </div>
                  </th>
                </tr>
              ) : null}

              {group.items.map((item) => {
                const context = summarizeNodeContext(item);
                const rowKey = `${item.kind}:${item.id}`;
                const canDelete = item.kind !== 'skill';
                const deleting = deletingKey === rowKey;

                return (
                  <tr key={rowKey} className="border-t border-border-subtle">
                    <td className={cellClassName}>
                      <Link to={buildNodeHref(locationSearch, item)} className="font-medium text-primary hover:underline">
                        {item.title}
                      </Link>
                      <div className="mt-0.5 font-mono text-[11px] text-dim">@{item.id}</div>
                      {item.summary ? <div className="mt-1 text-[12px] text-secondary">{item.summary}</div> : null}
                    </td>
                    <td className={cellClassName}>
                      <span className="text-secondary">{kindLabel(item.kind)}</span>
                    </td>
                    <td className={cellClassName}>
                      <span className="text-secondary">{humanizeStatus(item.status)}</span>
                    </td>
                    <td className={cellClassName}>
                      <span className="text-secondary">{item.updatedAt ? timeAgo(item.updatedAt) : '—'}</span>
                    </td>
                    <td className={cellClassName}>
                      <div className="text-secondary">{context.primary}</div>
                      {context.secondary ? <div className="mt-0.5 text-[11px] text-dim">{context.secondary}</div> : null}
                    </td>
                    <td className={cellClassName}>
                      {context.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-dim">
                          {context.tags.map((tag) => (
                            <span key={`${rowKey}:${tag}`} className="font-mono">{tag}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-dim">—</span>
                      )}
                    </td>
                    <td className={`${cellClassName} w-[7.5rem] text-right`}>
                      <div className="flex justify-end gap-1 whitespace-nowrap">
                        <NodeActionIconLink to={buildNodeHref(locationSearch, item)} label="Open page">
                          <TableActionIcon paths={[
                            'M2.06 12.35C3.43 9.51 6.52 6 12 6s8.57 3.51 9.94 5.65c.09.14.09.56 0 .7C20.57 14.49 17.48 18 12 18s-8.57-3.51-9.94-5.65a.75.75 0 0 1 0-.7Z',
                            'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
                          ]} />
                        </NodeActionIconLink>
                        {canDelete ? (
                          <NodeActionIconButton
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void onDelete(item);
                            }}
                            disabled={deleting}
                            label={deleting ? 'Deleting page' : 'Delete page'}
                            tone="danger"
                          >
                            <span className={deleting ? 'animate-pulse' : undefined}>
                              <TableActionIcon paths={['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6']} />
                            </span>
                          </NodeActionIconButton>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SavedViewsBar({
  savedViews,
  selectedView,
  activeSavedViewId,
  savingView,
  savingName,
  onViewChange,
  onStartSave,
  onCancelSave,
  onSavingNameChange,
  onSave,
  onDelete,
}: {
  savedViews: SavedNodeBrowserView[];
  selectedView: string;
  activeSavedViewId: string | null;
  savingView: boolean;
  savingName: string;
  onViewChange: (value: string) => void;
  onStartSave: () => void;
  onCancelSave: () => void;
  onSavingNameChange: (value: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-dim">
        <span className="font-semibold uppercase tracking-[0.12em] text-dim">View</span>
        <select
          value={selectedView}
          onChange={(event) => onViewChange(event.target.value)}
          aria-label="Docs view"
          className={SELECT_CLASS}
        >
          {BUILT_IN_VIEW_OPTIONS.map((view) => (
            <option key={view.value} value={`builtin:${view.value}`}>{view.label}</option>
          ))}
          {savedViews.length > 0 ? (
            <optgroup label="Saved views">
              {savedViews.map((view) => (
                <option key={view.id} value={`saved:${view.id}`}>{view.name}</option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <ToolbarButton onClick={onStartSave}>Save view</ToolbarButton>
        <ToolbarButton onClick={onDelete} disabled={!activeSavedViewId}>Delete view</ToolbarButton>
      </div>

      {savingView ? (
        <div className="flex w-full max-w-md items-center gap-2">
          <input
            value={savingName}
            onChange={(event) => onSavingNameChange(event.target.value)}
            placeholder="View name"
            aria-label="View name"
            className={INPUT_CLASS}
          />
          <ToolbarButton onClick={onSave} className="text-accent">Save</ToolbarButton>
          <ToolbarButton onClick={onCancelSave}>Cancel</ToolbarButton>
        </div>
      ) : null}
    </div>
  );
}

function NodeCreatePage({
  createKind,
  initialParent,
  currentProfile,
  busy,
  error,
  onCreate,
  onCancel,
  onCreateKindChange,
}: {
  createKind: NodeLinkKind;
  initialParent: string | null;
  currentProfile: string | null;
  busy: boolean;
  error: string | null;
  onCreate: (input: { kind: NodeLinkKind; title: string; summary: string; body: string; repoRoot: string; parent: string }) => void;
  onCancel: () => void;
  onCreateKindChange: (value: NodeLinkKind) => void;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [repoRoot, setRepoRoot] = useState('');
  const [parent, setParent] = useState(initialParent ?? '');

  useEffect(() => {
    setParent(initialParent ?? '');
  }, [initialParent]);

  const heading = 'New doc';
  const parentMeta = parent.trim() ? ` under @${parent.trim().toLowerCase()}` : '';
  const meta = createKind === 'project'
    ? `Start a tracked doc${parentMeta}${currentProfile ? ` for profile ${currentProfile}` : ''}.`
    : createKind === 'skill'
      ? `Create a reusable workflow doc${parentMeta}.`
      : `Create a doc${parentMeta}.`;
  const summaryLabel = createKind === 'project' ? 'Summary' : 'Description';
  const summaryPlaceholder = createKind === 'project'
    ? 'Short summary shown in doc lists.'
    : createKind === 'skill'
      ? 'What this skill is for and when to use it.'
      : 'What this doc is for and how the agent should use it.';
  const bodyPlaceholder = createKind === 'project'
    ? 'Optional. Add the initial plan, context, or working notes.'
    : createKind === 'skill'
      ? 'Document the workflow, steps, and sharp edges.'
      : 'Optional. Add the initial doc content.';

  return (
    <div className="min-h-0 flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
          <PageHeader
            actions={(
              <div className="flex items-center gap-2">
                <ToolbarButton onClick={onCancel}>Cancel</ToolbarButton>
                <ToolbarButton
                  onClick={() => onCreate({ kind: createKind, title, summary, body, repoRoot, parent })}
                  disabled={busy || title.trim().length === 0}
                  className="text-accent"
                >
                  {busy ? 'Creating…' : 'Create doc'}
                </ToolbarButton>
              </div>
            )}
          >
            <PageHeading title={heading} meta={meta} />
          </PageHeader>

          <div className="space-y-4 rounded-2xl border border-border-subtle px-5 py-5">
            <label className="flex max-w-xs flex-col gap-1.5 text-[12px] text-dim">
              <span>Doc type</span>
              <select
                value={createKind}
                onChange={(event) => onCreateKindChange(event.target.value as NodeLinkKind)}
                className={SELECT_CLASS}
                aria-label="Doc type"
              >
                <option value="note">Doc</option>
                <option value="project">Tracked doc</option>
                <option value="skill">Skill</option>
              </select>
            </label>

            <div className="space-y-1.5">
              <label className="text-[12px] text-dim" htmlFor="new-node-title">Title</label>
              <input
                id="new-node-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className={INPUT_CLASS}
                placeholder={createKind === 'project' ? 'Short doc title' : createKind === 'skill' ? 'Skill title' : 'Doc title'}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] text-dim" htmlFor="new-node-summary">{summaryLabel}</label>
              <textarea
                id="new-node-summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                rows={3}
                className={`${INPUT_CLASS} resize-y leading-relaxed`}
                placeholder={summaryPlaceholder}
              />
            </div>

            {createKind === 'project' ? (
              <div className="space-y-1.5">
                <label className="text-[12px] text-dim" htmlFor="new-node-repo-root">Repo root</label>
                <input
                  id="new-node-repo-root"
                  value={repoRoot}
                  onChange={(event) => setRepoRoot(event.target.value)}
                  className={INPUT_CLASS}
                  placeholder="Optional. Absolute path or a path relative to the repo."
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label className="text-[12px] text-dim" htmlFor="new-node-parent">Parent doc</label>
              <input
                id="new-node-parent"
                value={parent}
                onChange={(event) => setParent(event.target.value)}
                className={`${INPUT_CLASS} font-mono`}
                placeholder="Optional parent page id"
                spellCheck={false}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] text-dim">Body</label>
              <RichMarkdownEditor value={body} onChange={setBody} placeholder={bodyPlaceholder} variant="panel" />
            </div>

            {error ? <p className="text-[12px] text-danger">{error}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function KnowledgeBrowserPage({
  data,
  filteredNodes,
  groupedNodes,
  locationSearch,
  filter,
  query,
  sort,
  groupBy,
  dateField,
  dateRange,
  density,
  loading,
  error,
  refreshing,
  pageMeta,
  savedViews,
  selectedView,
  activeSavedViewId,
  savingView,
  savingName,
  actionError,
  deletingKey,
  onRefresh,
  onQueryChange,
  onSortChange,
  onGroupByChange,
  onDateFieldChange,
  onDateFromChange,
  onDateToChange,
  onDensityChange,
  onViewChange,
  onDeleteNode,
  onCreateNode,
  onStartSaveView,
  onCancelSaveView,
  onSavingNameChange,
  onSaveView,
  onDeleteView,
}: {
  data: NodeBrowserData | null;
  filteredNodes: NodeBrowserSummary[];
  groupedNodes: Array<{ key: string; label: string; items: NodeBrowserSummary[] }>;
  locationSearch: string;
  filter: NodeBrowserFilter;
  query: string;
  sort: NodeBrowserSort;
  groupBy: NodeBrowserGroupBy;
  dateField: NodeBrowserDateField;
  dateRange: { from: string | null; to: string | null };
  density: NodeBrowserDensity;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  pageMeta: string;
  savedViews: SavedNodeBrowserView[];
  selectedView: string;
  activeSavedViewId: string | null;
  savingView: boolean;
  savingName: string;
  actionError: string | null;
  deletingKey: string | null;
  onRefresh: () => void;
  onQueryChange: (value: string) => void;
  onSortChange: (value: NodeBrowserSort) => void;
  onGroupByChange: (value: NodeBrowserGroupBy) => void;
  onDateFieldChange: (value: NodeBrowserDateField) => void;
  onDateFromChange: (value: string | null) => void;
  onDateToChange: (value: string | null) => void;
  onDensityChange: (value: NodeBrowserDensity) => void;
  onViewChange: (value: string) => void;
  onDeleteNode: (item: NodeBrowserSummary) => void;
  onCreateNode: () => void;
  onStartSaveView: () => void;
  onCancelSaveView: () => void;
  onSavingNameChange: (value: string) => void;
  onSaveView: () => void;
  onDeleteView: () => void;
}) {
  const filterLabel = filter === 'all' ? 'All' : pluralKindLabel(filter);
  const tagGroupOptions = (data?.tagKeys ?? [])
    .filter((key) => !['area', 'profile', 'status', 'type'].includes(key))
    .map((key) => ({ value: `tag:${key}` as NodeBrowserGroupBy, label: `Tag: ${key}` }));

  return (
    <div className="min-h-0 flex h-full flex-col overflow-hidden">
      <PageHeader
        actions={(
          <div className="flex items-center gap-2">
            <ToolbarButton onClick={onCreateNode} className="text-accent">New doc</ToolbarButton>
            <ToolbarButton onClick={onRefresh} disabled={refreshing} aria-label="Refresh docs">
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </ToolbarButton>
          </div>
        )}
      >
        <PageHeading title="Docs" meta={pageMeta} />
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">
          <SavedViewsBar
            savedViews={savedViews}
            selectedView={selectedView}
            activeSavedViewId={activeSavedViewId}
            savingView={savingView}
            savingName={savingName}
            onViewChange={onViewChange}
            onStartSave={onStartSaveView}
            onCancelSave={onCancelSaveView}
            onSavingNameChange={onSavingNameChange}
            onSave={onSaveView}
            onDelete={onDeleteView}
          />

          <LuceneQueryInput query={query} visibleCount={filteredNodes.length} onQueryChange={onQueryChange} />

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-dim">
              <span>Sort</span>
              <select value={sort} onChange={(event) => onSortChange(event.target.value as NodeBrowserSort)} className={SELECT_CLASS} aria-label="Sort docs">
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-dim">
              <span>Group by</span>
              <select value={groupBy} onChange={(event) => onGroupByChange(event.target.value as NodeBrowserGroupBy)} className={SELECT_CLASS} aria-label="Group docs">
                {[...GROUP_BY_OPTIONS, ...tagGroupOptions].map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-dim">
              <span>Density</span>
              <select value={density} onChange={(event) => onDensityChange(event.target.value as NodeBrowserDensity)} className={SELECT_CLASS} aria-label="Doc density">
                <option value="comfortable">Comfortable</option>
                <option value="dense">Dense table</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-dim">
              <span>Date field</span>
              <select value={dateField} onChange={(event) => onDateFieldChange(event.target.value as NodeBrowserDateField)} className={SELECT_CLASS} aria-label="Date field">
                <option value="updated">Updated</option>
                <option value="created">Created</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-dim">
              <span>From</span>
              <input type="date" value={dateRange.from ?? ''} onChange={(event) => onDateFromChange(event.target.value || null)} className={SELECT_CLASS} aria-label="From date" />
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-dim">
              <span>To</span>
              <input type="date" value={dateRange.to ?? ''} onChange={(event) => onDateToChange(event.target.value || null)} className={SELECT_CLASS} aria-label="To date" />
            </label>
          </div>

          {error && data && data.nodes.length > 0 ? <p className="text-[11px] text-danger">{error}</p> : null}
          {actionError ? <p className="text-[11px] text-danger">{actionError}</p> : null}

          {loading && !data ? <LoadingState label="Loading docs…" className="py-10" /> : null}
          {error && !data ? <ErrorState message={`Unable to load docs: ${error}`} className="py-10" /> : null}

          {!loading && !error && data && data.nodes.length === 0 ? (
            <EmptyState
              className="py-10"
              title="No docs yet"
              body="Create a note, project, or skill doc to start shaping your durable layer."
            />
          ) : null}

          {!loading && !error && data && data.nodes.length > 0 && filteredNodes.length === 0 ? (
            <EmptyState
              className="py-10"
              title="No matching docs"
              body={`No ${filterLabel.toLowerCase()} match the current query, grouping, and date range.`}
            />
          ) : null}

          {!loading && !error && filteredNodes.length > 0 ? (
            <NodesTable
              groups={groupBy === 'none' ? [{ key: 'all', label: 'All docs', items: filteredNodes }] : groupedNodes}
              groupBy={groupBy}
              locationSearch={locationSearch}
              density={density}
              deletingKey={deletingKey}
              onDelete={onDeleteNode}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SelectedNodeView({
  selection,
  detail,
  loading,
  error,
  locationSearch,
  currentProfile,
  onRefreshAll,
}: {
  selection: { kind: NodeLinkKind; id: string };
  detail: SelectedNodeDetail | null;
  loading: boolean;
  error: string | null;
  locationSearch: string;
  currentProfile: string | null;
  onRefreshAll: () => void;
}) {
  const navigate = useNavigate();
  const baseSearch = useMemo(() => stripWorkspaceParams(locationSearch), [locationSearch]);
  const overviewHref = `/pages${buildNodesSearch(baseSearch, { kind: null, nodeId: null })}`;

  if (loading && !detail) {
    return <LoadingState label="Loading doc…" className="min-h-[18rem]" />;
  }

  if (error || !detail) {
    return (
      <div className="space-y-3">
        <ErrorState message={`Failed to load vault doc: ${error ?? `@${selection.id} not found.`}`} />
        <Link to={overviewHref} className="ui-toolbar-button inline-flex">Back to docs</Link>
      </div>
    );
  }

  if (detail.kind === 'note') {
    return (
      <NoteWorkspace
        detail={detail.detail}
        backHref={overviewHref}
        backLabel="Back to docs"
        onNavigate={(updates, replace) => {
          const nextMemoryId = updates.memoryId === undefined ? detail.detail.memory.id : updates.memoryId;
          navigate(`/pages${buildNodesSearch(baseSearch, {
            kind: nextMemoryId ? 'note' : null,
            nodeId: nextMemoryId ?? null,
          })}`, { replace });
        }}
        onRefetched={onRefreshAll}
        onSaved={() => {
          void Promise.resolve(onRefreshAll());
        }}
      />
    );
  }

  if (detail.kind === 'skill') {
    return (
      <SkillWorkspace
        detail={detail.detail}
        backHref={overviewHref}
        backLabel="Back to docs"
        selectedView={readSkillView(locationSearch)}
        selectedItem={new URLSearchParams(locationSearch).get(SKILL_ITEM_SEARCH_PARAM)?.trim() || null}
        onNavigate={(updates, replace) => {
          const nextSkillName = updates.skillName === undefined ? detail.detail.skill.name : updates.skillName;
          const nextSkillSearch = buildSkillsSearch(locationSearch, updates);
          navigate(`/pages${buildNodesSearch(nextSkillSearch, {
            kind: nextSkillName ? 'skill' : null,
            nodeId: nextSkillName ?? null,
          })}`, { replace });
        }}
        onRefetched={onRefreshAll}
      />
    );
  }

  return (
    <ProjectDetailPanel
      project={detail.detail}
      activeProfile={currentProfile ?? undefined}
      backHref={overviewHref}
      backLabel="Back to docs"
      onChanged={() => {
        emitProjectsChanged();
        onRefreshAll();
      }}
      onDeleted={() => {
        emitProjectsChanged();
        navigate(overviewHref);
      }}
    />
  );
}

export function NodesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: profileState } = useApi(api.profiles);
  const currentProfile = profileState?.currentProfile ?? null;
  const nodesApi = useApi(
    () => profileState ? api.nodes({ profile: profileState.currentProfile }) : Promise.resolve(null),
    profileState ? `nodes-browser:${profileState.currentProfile}` : 'nodes-browser:pending',
  );

  const filter = useMemo(() => readNodeBrowserFilter(location.search), [location.search]);
  const selected = useMemo(() => readSelectedNode(location.search), [location.search]);
  const creatingNode = useMemo(() => readCreatingNode(location.search), [location.search]);
  const createKind = useMemo(() => readCreateNodeKind(location.search), [location.search]);
  const createParent = useMemo(() => readCreateNodeParent(location.search), [location.search]);
  const query = useMemo(() => readNodeBrowserQuery(location.search), [location.search]);
  const sort = useMemo(() => readNodeBrowserSort(location.search), [location.search]);
  const groupBy = useMemo(() => readNodeBrowserGroupBy(location.search), [location.search]);
  const dateField = useMemo(() => readNodeBrowserDateField(location.search), [location.search]);
  const dateRange = useMemo(() => readNodeBrowserDateRange(location.search), [location.search]);
  const density = useMemo(() => readNodeBrowserDensity(location.search), [location.search]);
  const nodeViewsApi = useApi(api.nodeViews, 'node-browser-views');
  const [savingView, setSavingView] = useState(false);
  const [savingName, setSavingName] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const data = nodesApi.data ?? null;
  const savedViews = nodeViewsApi.data?.views ?? [];
  const currentBrowserSearch = useMemo(() => buildSavedBrowserViewSearch(location.search), [location.search]);
  const matchedSavedView = useMemo(
    () => savedViews.find((view) => view.search === currentBrowserSearch) ?? null,
    [currentBrowserSearch, savedViews],
  );
  const selectedView = matchedSavedView ? `saved:${matchedSavedView.id}` : `builtin:${filter}`;
  const nodes = data?.nodes ?? [];
  const filteredNodes = useMemo(
    () => nodes
      .filter((node) => matchesBrowserFilters(node, filter, query, dateField, dateRange))
      .sort((left, right) => compareNodeItems(left, right, sort)),
    [dateField, dateRange, filter, nodes, query, sort],
  );
  const groupedNodes = useMemo(() => buildGroupedNodes(filteredNodes, groupBy), [filteredNodes, groupBy]);
  const selectedNode = useMemo(
    () => selected ? nodes.find((item) => item.kind === selected.kind && item.id === selected.id) ?? null : null,
    [nodes, selected],
  );
  const counts = useMemo(() => ({
    all: nodes.length,
    note: nodes.filter((item) => item.kind === 'note').length,
    project: nodes.filter((item) => item.kind === 'project').length,
    skill: nodes.filter((item) => item.kind === 'skill').length,
  }), [nodes]);
  const combinedError = nodesApi.error || null;
  const dataLoading = nodesApi.loading && nodes.length === 0;
  const pageMeta = useMemo(() => {
    if (dataLoading) {
      return 'Loading knowledge base…';
    }
    if (counts.all === 0) {
      return 'No docs yet.';
    }
    if (query.trim() || filter !== 'all' || dateRange.from || dateRange.to || groupBy !== 'kind' || sort !== 'updated_desc') {
      return `${filteredNodes.length} visible · ${counts.all} total docs`;
    }
    return `${counts.all} total · ${formatPageRoleCount('page', counts.note + counts.project)} · ${formatPageRoleCount('skill', counts.skill)}`;
  }, [counts.all, counts.note, counts.project, counts.skill, dataLoading, dateRange.from, dateRange.to, filter, filteredNodes.length, groupBy, query, sort]);

  const detailApi = useApi(async () => {
    if (!selected) {
      return null;
    }

    switch (selected.kind) {
      case 'note':
        return { kind: 'note', detail: await api.noteDoc(selected.id) } satisfies SelectedNodeDetail;
      case 'skill':
        return { kind: 'skill', detail: await api.skillDetail(selected.id) } satisfies SelectedNodeDetail;
      case 'project': {
        const projectProfile = selectedNode?.kind === 'project'
          ? selectedNode.project?.profile
          : currentProfile ?? undefined;
        return {
          kind: 'project',
          detail: await api.projectById(selected.id, projectProfile ? { profile: projectProfile } : undefined),
        } satisfies SelectedNodeDetail;
      }
    }
  }, `nodes-detail:${selected?.kind ?? 'none'}:${selected?.id ?? 'none'}:${currentProfile ?? ''}`);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      nodesApi.refetch({ resetLoading: false }),
      detailApi.refetch({ resetLoading: false }),
    ]);
  }, [detailApi, nodesApi]);

  const navigateBrowser = useCallback((updates: Parameters<typeof buildNodesSearch>[1]) => {
    navigate(`/pages${buildNodesSearch(location.search, updates)}`, { replace: true });
  }, [location.search, navigate]);

  const handleOpenCreateNode = useCallback(() => {
    navigate(`/pages${buildNodeCreateSearch(location.search, { creating: true, createKind: 'note' })}`, { replace: true });
  }, [location.search, navigate]);

  const handleCancelCreateNode = useCallback(() => {
    setCreateError(null);
    navigate(`/pages${buildNodeCreateSearch(location.search, { creating: false, createKind: null })}`, { replace: true });
  }, [location.search, navigate]);

  const handleSaveView = useCallback(async () => {
    const result = await api.saveNodeView({
      name: savingName,
      search: currentBrowserSearch,
    });
    nodeViewsApi.replaceData(result);
    setSavingView(false);
    setSavingName('');
  }, [currentBrowserSearch, nodeViewsApi, savingName]);

  const handleDeleteView = useCallback(async () => {
    if (!matchedSavedView) {
      return;
    }
    const result = await api.deleteNodeView(matchedSavedView.id);
    nodeViewsApi.replaceData(result);
  }, [matchedSavedView, nodeViewsApi]);

  const handleViewChange = useCallback((value: string) => {
    if (value.startsWith('saved:')) {
      const viewId = value.slice('saved:'.length);
      const view = savedViews.find((entry) => entry.id === viewId);
      if (view) {
        navigate(`/pages${view.search}`, { replace: true });
      }
      return;
    }

    const nextFilter = value.replace(/^builtin:/, '') as NodeBrowserFilter;
    navigateBrowser({ filter: nextFilter, kind: null, nodeId: null });
  }, [navigate, navigateBrowser, savedViews]);

  const handleDeleteNode = useCallback(async (item: NodeBrowserSummary) => {
    if (item.kind === 'skill') {
      return;
    }

    const rowKey = `${item.kind}:${item.id}`;
    if (!window.confirm(`Delete page @${item.id}?`)) {
      return;
    }

    setActionError(null);
    setDeletingKey(rowKey);
    try {
      if (item.kind === 'note') {
        await api.deleteNoteDoc(item.id);
        emitMemoriesChanged({ memoryId: item.id });
      } else {
        const projectProfile = item.project?.profile ?? currentProfile ?? undefined;
        await api.deleteProject(item.id, projectProfile ? { profile: projectProfile } : undefined);
        emitProjectsChanged();
      }

      if (data) {
        nodesApi.replaceData({
          ...data,
          nodes: data.nodes.filter((node) => !(node.kind === item.kind && node.id === item.id)),
        });
      }

      await refreshAll();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingKey(null);
    }
  }, [data, nodesApi, refreshAll]);

  const handleCreateNode = useCallback(async (input: {
    kind: NodeLinkKind;
    title: string;
    summary: string;
    body: string;
    repoRoot: string;
    parent: string;
  }) => {
    const title = input.title.trim();
    if (!title) {
      return;
    }

    setCreateBusy(true);
    setCreateError(null);
    try {
      const parent = input.parent.trim().toLowerCase();

      if (input.kind === 'note') {
        const created = await api.createNoteDoc({
          title,
          summary: input.summary.trim() || undefined,
          description: input.summary.trim() || undefined,
          body: input.body.trim() || undefined,
        });
        if (parent) {
          await api.saveNodeDetail(created.memory.id, { parent });
        }
        emitMemoriesChanged({ memoryId: created.memory.id });
        await refreshAll();
        navigate(`/pages${buildNodesSearch('', { kind: 'note', nodeId: created.memory.id })}`, { replace: true });
        return;
      }

      if (input.kind === 'project') {
        const created = await api.createProject({
          title,
          description: input.summary.trim() || title,
          summary: input.summary.trim() || undefined,
          documentContent: input.body.trim() || undefined,
          repoRoot: input.repoRoot.trim() || undefined,
        }, currentProfile ? { profile: currentProfile } : undefined);
        if (parent) {
          await api.saveNodeDetail(created.project.id, { parent }, currentProfile ? { profile: currentProfile } : undefined);
        }
        emitProjectsChanged();
        await refreshAll();
        navigate(`/pages${buildNodesSearch('', { kind: 'project', nodeId: created.project.id })}`, { replace: true });
        return;
      }

      const created = await api.createSkill({
        title,
        description: input.summary.trim() || undefined,
        body: input.body.trim() || undefined,
      });
      if (parent) {
        await api.saveNodeDetail(created.skill.name, { parent });
      }
      await refreshAll();
      navigate(`/pages${buildNodesSearch('', { kind: 'skill', nodeId: created.skill.name })}`, { replace: true });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
      setCreateBusy(false);
    }
  }, [currentProfile, navigate, refreshAll]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    ensureOpenResourceShelfItem('node', buildOpenNodeShelfId(selected.kind, selected.id));
  }, [selected]);

  useEffect(() => {
    const handleNodesChanged = () => {
      void refreshAll();
    };
    window.addEventListener(MEMORIES_CHANGED_EVENT, handleNodesChanged);
    window.addEventListener(PROJECTS_CHANGED_EVENT, handleNodesChanged);
    return () => {
      window.removeEventListener(MEMORIES_CHANGED_EVENT, handleNodesChanged);
      window.removeEventListener(PROJECTS_CHANGED_EVENT, handleNodesChanged);
    };
  }, [currentProfile, refreshAll]);

  useEffect(() => {
    if (!selected || nodes.length === 0) {
      return;
    }
    const exists = nodes.some((item) => item.kind === selected.kind && item.id === selected.id);
    if (!exists) {
      navigate(buildOverviewHref(location.search), { replace: true });
    }
  }, [location.search, navigate, nodes, selected]);

  if (selected) {
    return (
      <div className="min-h-0 flex h-full flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto w-full max-w-[1440px]">
            <SelectedNodeView
              selection={selected}
              detail={detailApi.data ?? null}
              loading={detailApi.loading}
              error={detailApi.error}
              locationSearch={location.search}
              currentProfile={currentProfile}
              onRefreshAll={() => { void refreshAll(); }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (creatingNode) {
    return (
      <NodeCreatePage
        createKind={createKind}
        initialParent={createParent}
        currentProfile={currentProfile}
        busy={createBusy}
        error={createError}
        onCreate={(input) => { void handleCreateNode(input); }}
        onCancel={handleCancelCreateNode}
        onCreateKindChange={(value) => {
          setCreateError(null);
          navigate(`/pages${buildNodeCreateSearch(location.search, { creating: true, createKind: value, parent: createParent })}`, { replace: true });
        }}
      />
    );
  }

  return (
    <KnowledgeBrowserPage
      data={data}
      filteredNodes={filteredNodes}
      groupedNodes={groupedNodes}
      locationSearch={location.search}
      filter={filter}
      query={query}
      sort={sort}
      groupBy={groupBy}
      dateField={dateField}
      dateRange={dateRange}
      density={density}
      loading={dataLoading}
      error={combinedError}
      refreshing={nodesApi.refreshing}
      pageMeta={pageMeta}
      savedViews={savedViews}
      selectedView={selectedView}
      activeSavedViewId={matchedSavedView?.id ?? null}
      savingView={savingView}
      savingName={savingName}
      actionError={actionError}
      deletingKey={deletingKey}
      onRefresh={() => { void refreshAll(); }}
      onQueryChange={(value) => navigateBrowser({ query: value })}
      onSortChange={(value) => navigateBrowser({ sort: value })}
      onGroupByChange={(value) => navigateBrowser({ groupBy: value })}
      onDateFieldChange={(value) => navigateBrowser({ dateField: value })}
      onDateFromChange={(value) => navigateBrowser({ dateFrom: value })}
      onDateToChange={(value) => navigateBrowser({ dateTo: value })}
      onDensityChange={(value) => navigateBrowser({ density: value })}
      onViewChange={handleViewChange}
      onDeleteNode={handleDeleteNode}
      onCreateNode={handleOpenCreateNode}
      onStartSaveView={() => setSavingView(true)}
      onCancelSaveView={() => { setSavingView(false); setSavingName(''); }}
      onSavingNameChange={setSavingName}
      onSaveView={handleSaveView}
      onDeleteView={handleDeleteView}
    />
  );
}

export default NodesPage;
