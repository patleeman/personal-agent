import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { MEMORIES_CHANGED_EVENT } from '../memoryDocEvents';
import { emitProjectsChanged, PROJECTS_CHANGED_EVENT } from '../projectEvents';
import {
  EmptyState,
  ErrorState,
  ListLinkRow,
  LoadingState,
  PageHeader,
  PageHeading,
  SectionLabel,
  ToolbarButton,
} from '../components/ui';
import type {
  NodeBrowserData,
  NodeBrowserSummary,
  NodeLinkKind,
  ProjectDetail,
  SkillDetail,
} from '../types';
import {
  buildNodesSearch,
  getNodeGroupValue,
  matchesNodeBrowserQuery,
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
import { ensureOpenResourceShelfItem } from '../openResourceShelves';
import { ProjectDetailPanel } from '../components/ProjectDetailPanel';
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
const NODE_KIND_ORDER: NodeLinkKind[] = ['note', 'project', 'skill'];
const GROUP_BY_OPTIONS: Array<{ value: NodeBrowserGroupBy; label: string }> = [
  { value: 'kind', label: 'Kind' },
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

type SelectedNodeDetail =
  | { kind: 'note'; detail: Awaited<ReturnType<typeof api.noteDoc>> }
  | { kind: 'skill'; detail: SkillDetail }
  | { kind: 'project'; detail: ProjectDetail };

function kindLabel(kind: NodeLinkKind): string {
  switch (kind) {
    case 'note':
      return 'Note';
    case 'project':
      return 'Project';
    case 'skill':
      return 'Skill';
  }
}

function pluralKindLabel(kind: NodeLinkKind): string {
  switch (kind) {
    case 'note':
      return 'Notes';
    case 'project':
      return 'Projects';
    case 'skill':
      return 'Skills';
  }
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
  const next = params.toString();
  return next ? `?${next}` : '';
}

function extractTagValue(tags: string[], key: string): string | null {
  for (const tag of tags) {
    const match = tag.match(new RegExp(`^${key}:(.+)$`, 'i'));
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  return null;
}

function summarizeNodeContext(node: NodeBrowserSummary): { primary: string; secondary: string | null; tags: string[] } {
  const visibleTags = node.tags
    .filter((tag) => !/^(type|status):/i.test(tag))
    .slice(0, 3);

  switch (node.kind) {
    case 'note': {
      const referenceCount = node.note?.referenceCount ?? 0;
      const primary = referenceCount > 0 ? `${referenceCount} ${referenceCount === 1 ? 'reference' : 'references'}` : 'Shared note node';
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
  if (filter !== 'all' && node.kind !== filter) {
    return false;
  }
  if (!matchesNodeBrowserQuery(node, query)) {
    return false;
  }
  return matchesDateRange(node, dateField, dateRange.from, dateRange.to);
}

function sortGroupEntries(left: { key: string }, right: { key: string }, groupBy: NodeBrowserGroupBy): number {
  if (groupBy === 'kind') {
    return NODE_KIND_ORDER.indexOf(left.key as NodeLinkKind) - NODE_KIND_ORDER.indexOf(right.key as NodeLinkKind);
  }
  return left.key.localeCompare(right.key);
}

function buildGroupedNodes(nodes: NodeBrowserSummary[], groupBy: NodeBrowserGroupBy): Array<{ key: string; label: string; items: NodeBrowserSummary[] }> {
  if (groupBy === 'none') {
    return [{ key: 'all', label: 'All nodes', items: nodes }];
  }

  const map = new Map<string, NodeBrowserSummary[]>();
  for (const node of nodes) {
    const key = getNodeGroupValue(node, groupBy);
    const existing = map.get(key) ?? [];
    existing.push(node);
    map.set(key, existing);
  }

  return [...map.entries()]
    .map(([key, items]) => ({
      key,
      label: groupBy === 'kind'
        ? pluralKindLabel(key as NodeLinkKind)
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
  return `/nodes${buildNodesSearch(baseSearch, {
    kind: item.kind,
    nodeId: item.id,
  })}`;
}

function buildOverviewHref(locationSearch: string): string {
  const baseSearch = stripWorkspaceParams(locationSearch);
  return `/nodes${buildNodesSearch(baseSearch, {
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

function NodeBrowserListItem({
  item,
  selected,
  locationSearch,
}: {
  item: NodeBrowserSummary;
  selected: boolean;
  locationSearch: string;
}) {
  const href = buildNodeHref(locationSearch, item);
  const context = summarizeNodeContext(item);

  return (
    <ListLinkRow to={href} selected={selected}>
      <div className="flex items-start justify-between gap-3">
        <p className="ui-row-title break-words">{item.title}</p>
        <span className="shrink-0 text-[11px] text-dim">{item.updatedAt ? timeAgo(item.updatedAt) : '—'}</span>
      </div>
      {item.summary ? <p className="ui-row-summary">{item.summary}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">{kindLabel(item.kind)}</span>
        <span className="opacity-40">·</span>
        <span>{context.primary}</span>
        {context.secondary ? (
          <>
            <span className="opacity-40">·</span>
            <span>{context.secondary}</span>
          </>
        ) : null}
        <span className="opacity-40">·</span>
        <span className="font-mono" title={`@${item.id}`}>{`@${item.id}`}</span>
        {context.tags.map((tag) => (
          <span key={`${item.kind}:${item.id}:${tag}`} className="contents">
            <span className="opacity-40">·</span>
            <span className="font-mono">{tag}</span>
          </span>
        ))}
      </div>
    </ListLinkRow>
  );
}

function DenseNodeTable({
  items,
  locationSearch,
}: {
  items: NodeBrowserSummary[];
  locationSearch: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle">
      <table className="min-w-full border-collapse text-left text-[12px]">
        <thead className="bg-base/70 text-[10px] uppercase tracking-[0.12em] text-dim">
          <tr>
            <th className="px-3 py-2.5 font-medium">Title</th>
            <th className="px-3 py-2.5 font-medium">Kind</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 font-medium">Updated</th>
            <th className="px-3 py-2.5 font-medium">Context</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const context = summarizeNodeContext(item);
            return (
              <tr key={`${item.kind}:${item.id}`} className="border-t border-border-subtle align-top">
                <td className="px-3 py-2.5">
                  <Link to={buildNodeHref(locationSearch, item)} className="font-medium text-primary hover:underline">
                    {item.title}
                  </Link>
                  <div className="mt-0.5 font-mono text-[11px] text-dim">@{item.id}</div>
                </td>
                <td className="px-3 py-2.5 text-secondary">{kindLabel(item.kind)}</td>
                <td className="px-3 py-2.5 text-secondary">{humanizeStatus(item.status)}</td>
                <td className="px-3 py-2.5 text-secondary">{item.updatedAt ? timeAgo(item.updatedAt) : '—'}</td>
                <td className="px-3 py-2.5 text-secondary">
                  <div>{context.primary}</div>
                  {context.secondary ? <div className="mt-0.5 text-[11px] text-dim">{context.secondary}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SavedViewsBar({
  savedViews,
  activeViewId,
  savingView,
  savingName,
  onActiveViewChange,
  onStartSave,
  onCancelSave,
  onSavingNameChange,
  onSave,
  onDelete,
}: {
  savedViews: SavedNodeBrowserView[];
  activeViewId: string;
  savingView: boolean;
  savingName: string;
  onActiveViewChange: (value: string) => void;
  onStartSave: () => void;
  onCancelSave: () => void;
  onSavingNameChange: (value: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-dim">
        <span className="font-semibold uppercase tracking-[0.12em] text-dim">Views</span>
        <select
          value={activeViewId}
          onChange={(event) => onActiveViewChange(event.target.value)}
          aria-label="Saved views"
          className={SELECT_CLASS}
        >
          <option value="">Current view</option>
          {savedViews.map((view) => (
            <option key={view.id} value={view.id}>{view.name}</option>
          ))}
        </select>
        <ToolbarButton onClick={onStartSave}>Save view</ToolbarButton>
        <ToolbarButton onClick={onDelete} disabled={!activeViewId}>Delete view</ToolbarButton>
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
  activeViewId,
  savingView,
  savingName,
  onRefresh,
  onQueryChange,
  onSortChange,
  onGroupByChange,
  onDateFieldChange,
  onDateFromChange,
  onDateToChange,
  onDensityChange,
  onFilterChange,
  onCreateNote,
  onCreateProject,
  onCreateSkill,
  onActiveViewChange,
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
  activeViewId: string;
  savingView: boolean;
  savingName: string;
  onRefresh: () => void;
  onQueryChange: (value: string) => void;
  onSortChange: (value: NodeBrowserSort) => void;
  onGroupByChange: (value: NodeBrowserGroupBy) => void;
  onDateFieldChange: (value: NodeBrowserDateField) => void;
  onDateFromChange: (value: string | null) => void;
  onDateToChange: (value: string | null) => void;
  onDensityChange: (value: NodeBrowserDensity) => void;
  onFilterChange: (value: NodeBrowserFilter) => void;
  onCreateNote: () => void;
  onCreateProject: () => void;
  onCreateSkill: () => void;
  onActiveViewChange: (value: string) => void;
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
            <ToolbarButton onClick={onCreateNote} className="text-accent">New note</ToolbarButton>
            <ToolbarButton onClick={onCreateProject}>New project</ToolbarButton>
            <ToolbarButton onClick={onCreateSkill}>New skill</ToolbarButton>
            <ToolbarButton onClick={onRefresh} disabled={refreshing} aria-label="Refresh knowledge base">
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </ToolbarButton>
          </div>
        )}
      >
        <PageHeading title="Knowledge Base" meta={pageMeta} />
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">
          <SavedViewsBar
            savedViews={savedViews}
            activeViewId={activeViewId}
            savingView={savingView}
            savingName={savingName}
            onActiveViewChange={onActiveViewChange}
            onStartSave={onStartSaveView}
            onCancelSave={onCancelSaveView}
            onSavingNameChange={onSavingNameChange}
            onSave={onSaveView}
            onDelete={onDeleteView}
          />

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Lucene query</span>
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder='type:project AND status:active AND area:architecture'
                aria-label="Lucene query"
                className={QUERY_INPUT_CLASS}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="text-[11px] text-dim xl:pl-4 xl:text-right">
              <p>{filteredNodes.length} visible</p>
              <p className="font-mono text-[10px] text-dim">Fields: type, status, profile, area, parent, tag, id, title</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="ui-segmented-control" role="group" aria-label="Node filter">
              {([
                ['all', 'All'],
                ['note', 'Notes'],
                ['project', 'Projects'],
                ['skill', 'Skills'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onFilterChange(value)}
                  className={filter === value ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-dim">
                <span>Sort</span>
                <select value={sort} onChange={(event) => onSortChange(event.target.value as NodeBrowserSort)} className={SELECT_CLASS} aria-label="Sort nodes">
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-[11px] text-dim">
                <span>Group by</span>
                <select value={groupBy} onChange={(event) => onGroupByChange(event.target.value as NodeBrowserGroupBy)} className={SELECT_CLASS} aria-label="Group nodes">
                  {[...GROUP_BY_OPTIONS, ...tagGroupOptions].map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-[11px] text-dim">
                <span>Density</span>
                <select value={density} onChange={(event) => onDensityChange(event.target.value as NodeBrowserDensity)} className={SELECT_CLASS} aria-label="Node density">
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
          </div>

          {error && data && data.nodes.length > 0 ? <p className="text-[11px] text-danger">{error}</p> : null}

          {loading && !data ? <LoadingState label="Loading knowledge base…" className="py-10" /> : null}
          {error && !data ? <ErrorState message={`Unable to load knowledge base: ${error}`} className="py-10" /> : null}

          {!loading && !error && data && data.nodes.length === 0 ? (
            <EmptyState
              className="py-10"
              title="No nodes yet"
              body="Create a note or project, or add a skill, to start building the shared knowledge base."
            />
          ) : null}

          {!loading && !error && data && data.nodes.length > 0 && filteredNodes.length === 0 ? (
            <EmptyState
              className="py-10"
              title="No matching nodes"
              body={`No ${filterLabel.toLowerCase()} match the current query, grouping, and date range.`}
            />
          ) : null}

          {!loading && !error && filteredNodes.length > 0 ? (
            groupBy === 'none' ? (
              density === 'dense' ? (
                <DenseNodeTable items={filteredNodes} locationSearch={locationSearch} />
              ) : (
                <div className="space-y-0.5">
                  {filteredNodes.map((item) => (
                    <NodeBrowserListItem key={`${item.kind}:${item.id}`} item={item} selected={false} locationSearch={locationSearch} />
                  ))}
                </div>
              )
            ) : (
              <div className="space-y-5">
                {groupedNodes.map((entry) => (
                  <div key={entry.key} className="space-y-1">
                    <SectionLabel label={entry.label} count={entry.items.length} className="px-3 pb-1" />
                    {density === 'dense' ? (
                      <DenseNodeTable items={entry.items} locationSearch={locationSearch} />
                    ) : (
                      <div className="space-y-0.5">
                        {entry.items.map((item) => (
                          <NodeBrowserListItem key={`${entry.key}:${item.kind}:${item.id}`} item={item} selected={false} locationSearch={locationSearch} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
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
  const overviewHref = `/nodes${buildNodesSearch(baseSearch, { kind: null, nodeId: null })}`;

  if (loading && !detail) {
    return <LoadingState label="Loading node…" className="min-h-[18rem]" />;
  }

  if (error || !detail) {
    return (
      <div className="space-y-3">
        <ErrorState message={`Failed to load node: ${error ?? `@${selection.id} not found.`}`} />
        <Link to={overviewHref} className="ui-toolbar-button inline-flex">Back to table</Link>
      </div>
    );
  }

  if (detail.kind === 'note') {
    return (
      <NoteWorkspace
        detail={detail.detail}
        backHref={overviewHref}
        backLabel="Back to table"
        onNavigate={(updates, replace) => {
          const nextMemoryId = updates.memoryId === undefined ? detail.detail.memory.id : updates.memoryId;
          navigate(`/nodes${buildNodesSearch(baseSearch, {
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
        backLabel="Back to table"
        selectedView={readSkillView(locationSearch)}
        selectedItem={new URLSearchParams(locationSearch).get(SKILL_ITEM_SEARCH_PARAM)?.trim() || null}
        onNavigate={(updates, replace) => {
          const nextSkillName = updates.skillName === undefined ? detail.detail.skill.name : updates.skillName;
          const nextSkillSearch = buildSkillsSearch(locationSearch, updates);
          navigate(`/nodes${buildNodesSearch(nextSkillSearch, {
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
      backLabel="Back to table"
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
  const query = useMemo(() => readNodeBrowserQuery(location.search), [location.search]);
  const sort = useMemo(() => readNodeBrowserSort(location.search), [location.search]);
  const groupBy = useMemo(() => readNodeBrowserGroupBy(location.search), [location.search]);
  const dateField = useMemo(() => readNodeBrowserDateField(location.search), [location.search]);
  const dateRange = useMemo(() => readNodeBrowserDateRange(location.search), [location.search]);
  const density = useMemo(() => readNodeBrowserDensity(location.search), [location.search]);
  const nodeViewsApi = useApi(api.nodeViews, 'node-browser-views');
  const [activeViewId, setActiveViewId] = useState('');
  const [savingView, setSavingView] = useState(false);
  const [savingName, setSavingName] = useState('');

  const data = nodesApi.data ?? null;
  const savedViews = nodeViewsApi.data?.views ?? [];
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
      return 'No nodes yet.';
    }
    if (query.trim() || filter !== 'all' || dateRange.from || dateRange.to || groupBy !== 'kind' || sort !== 'updated_desc') {
      return `${filteredNodes.length} visible · ${counts.all} total nodes`;
    }
    return `${counts.all} nodes · ${counts.note} notes · ${counts.project} projects · ${counts.skill} skills`;
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
    navigate(`/nodes${buildNodesSearch(location.search, updates)}`, { replace: true });
  }, [location.search, navigate]);

  const handleFilterChange = useCallback((nextFilter: NodeBrowserFilter) => {
    const nextSelection = selected && (nextFilter === 'all' || selected.kind === nextFilter) ? selected : null;
    navigateBrowser({ filter: nextFilter, kind: nextSelection?.kind ?? null, nodeId: nextSelection?.id ?? null });
  }, [navigateBrowser, selected]);

  const handleCreateNote = useCallback(() => navigate('/notes?creating=true'), [navigate]);
  const handleCreateProject = useCallback(() => navigate('/projects?creating=true'), [navigate]);
  const handleCreateSkill = useCallback(() => navigate('/skills?creating=true'), [navigate]);

  const handleSaveView = useCallback(async () => {
    const result = await api.saveNodeView({
      name: savingName,
      search: buildSavedBrowserViewSearch(location.search),
    });
    nodeViewsApi.replaceData(result);
    const nextActive = result.views.find((view) => view.name.toLowerCase() === savingName.trim().toLowerCase());
    setActiveViewId(nextActive?.id ?? '');
    setSavingView(false);
    setSavingName('');
  }, [location.search, nodeViewsApi, savingName]);

  const handleDeleteView = useCallback(async () => {
    if (!activeViewId) {
      return;
    }
    const result = await api.deleteNodeView(activeViewId);
    nodeViewsApi.replaceData(result);
    setActiveViewId('');
  }, [activeViewId, nodeViewsApi]);

  const handleActiveViewChange = useCallback((value: string) => {
    setActiveViewId(value);
    if (!value) {
      return;
    }
    const view = savedViews.find((entry) => entry.id === value);
    if (view) {
      navigate(`/nodes${view.search}`, { replace: true });
    }
  }, [navigate, savedViews]);

  useEffect(() => {
    if (savedViews.some((view) => view.id === activeViewId)) {
      return;
    }
    if (!activeViewId) {
      return;
    }
    setActiveViewId('');
  }, [activeViewId, savedViews]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    ensureOpenResourceShelfItem(selected.kind, selected.id);
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
  }, [refreshAll]);

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
      activeViewId={activeViewId}
      savingView={savingView}
      savingName={savingName}
      onRefresh={() => { void refreshAll(); }}
      onQueryChange={(value) => navigateBrowser({ query: value })}
      onSortChange={(value) => navigateBrowser({ sort: value })}
      onGroupByChange={(value) => navigateBrowser({ groupBy: value })}
      onDateFieldChange={(value) => navigateBrowser({ dateField: value })}
      onDateFromChange={(value) => navigateBrowser({ dateFrom: value })}
      onDateToChange={(value) => navigateBrowser({ dateTo: value })}
      onDensityChange={(value) => navigateBrowser({ density: value })}
      onFilterChange={handleFilterChange}
      onCreateNote={handleCreateNote}
      onCreateProject={handleCreateProject}
      onCreateSkill={handleCreateSkill}
      onActiveViewChange={handleActiveViewChange}
      onStartSaveView={() => setSavingView(true)}
      onCancelSaveView={() => { setSavingView(false); setSavingName(''); }}
      onSavingNameChange={setSavingName}
      onSaveView={handleSaveView}
      onDeleteView={handleDeleteView}
    />
  );
}

export default NodesPage;
