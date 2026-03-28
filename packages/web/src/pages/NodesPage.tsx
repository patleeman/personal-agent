import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { BrowserSplitLayout } from '../components/BrowserSplitLayout';
import { useApi } from '../hooks';
import { useAppData } from '../contexts';
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
import { formatUsageLabel, humanizeSkillName } from '../memoryOverview';
import type {
  MemoryData,
  MemoryDocItem,
  MemorySkillItem,
  NodeLinkKind,
  ProjectDetail,
  ProjectRecord,
  SkillDetail,
} from '../types';
import { buildNodesSearch, readNodeBrowserFilter, readSelectedNode, type NodeBrowserFilter } from '../nodeWorkspaceState';
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
import { buildRailWidthStorageKey } from '../layoutSizing';
import { timeAgo } from '../utils';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const SELECT_CLASS = `${INPUT_CLASS} sm:w-auto`;
const NODE_KIND_ORDER: NodeLinkKind[] = ['note', 'project', 'skill'];
const NODES_BROWSER_WIDTH_STORAGE_KEY = buildRailWidthStorageKey('nodes-browser');

type NodeBrowserSort = 'updated' | 'title';

type UnifiedNodeItem = {
  kind: NodeLinkKind;
  id: string;
  title: string;
  summary: string;
  sortAt: string | null;
  contextPrimary: string;
  contextSecondary: string | null;
  metaParts: string[];
  searchParts: string[];
  record: MemoryDocItem | MemorySkillItem | ProjectRecord;
};

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

function singularFilterLabel(filter: NodeBrowserFilter): string {
  switch (filter) {
    case 'note':
      return 'note';
    case 'project':
      return 'project';
    case 'skill':
      return 'skill';
    default:
      return 'node';
  }
}

function humanizeStatus(status: string): string {
  const normalized = status.replace(/[_-]+/g, ' ').trim();
  if (!normalized) {
    return 'Unknown';
  }

  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function summarizeRepoRoot(repoRoot: string | undefined): string | null {
  const normalized = repoRoot?.trim();
  if (!normalized) {
    return null;
  }

  const segments = normalized.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function projectTaskSummary(project: ProjectRecord): string {
  const tasks = project.plan.tasks ?? [];
  if (tasks.length === 0) {
    return 'No tasks';
  }

  const completed = tasks.filter((task) => task.status === 'done' || task.status === 'completed').length;
  const open = Math.max(0, tasks.length - completed);
  return `${open} open · ${completed} done`;
}

function summarizeNoteContext(memory: MemoryDocItem): string {
  const referenceCount = memory.referenceCount ?? 0;
  if (referenceCount > 0) {
    return `${referenceCount} ${referenceCount === 1 ? 'reference' : 'references'}`;
  }

  if (memory.usedInLastSession) {
    return 'Used recently';
  }

  const recentSessionCount = memory.recentSessionCount ?? 0;
  if (recentSessionCount > 0) {
    return `${recentSessionCount} recent ${recentSessionCount === 1 ? 'chat' : 'chats'}`;
  }

  return 'Shared note node';
}

function buildUnifiedNodes(memoryData: MemoryData | null, projects: ProjectRecord[] | null): UnifiedNodeItem[] {
  const noteItems = (memoryData?.memoryDocs ?? []).map((memory) => ({
    kind: 'note' as const,
    id: memory.id,
    title: memory.title,
    summary: memory.summary,
    sortAt: memory.updated ?? memory.lastUsedAt ?? null,
    contextPrimary: summarizeNoteContext(memory),
    contextSecondary: memory.status ?? 'active',
    metaParts: [
      `@${memory.id}`,
      ...(memory.path ? [memory.path] : []),
    ],
    searchParts: [
      memory.id,
      memory.title,
      memory.summary,
      summarizeNoteContext(memory),
      memory.status ?? 'active',
      memory.path ?? '',
    ],
    record: memory,
  }));

  const skillItems = (memoryData?.skills ?? []).map((skill) => ({
    kind: 'skill' as const,
    id: skill.name,
    title: humanizeSkillName(skill.name),
    summary: skill.description,
    sortAt: skill.lastUsedAt ?? null,
    contextPrimary: skill.source,
    contextSecondary: formatUsageLabel(skill.recentSessionCount, skill.lastUsedAt, skill.usedInLastSession, 'Not used recently'),
    metaParts: [`@${skill.name}`],
    searchParts: [
      skill.name,
      humanizeSkillName(skill.name),
      skill.description,
      skill.source,
      formatUsageLabel(skill.recentSessionCount, skill.lastUsedAt, skill.usedInLastSession, 'Not used recently'),
    ],
    record: skill,
  }));

  const projectItems = (projects ?? []).map((project) => {
    const repoLabel = summarizeRepoRoot(project.repoRoot);
    return {
      kind: 'project' as const,
      id: project.id,
      title: project.title,
      summary: project.summary || project.description,
      sortAt: project.updatedAt,
      contextPrimary: humanizeStatus(project.status),
      contextSecondary: [projectTaskSummary(project), project.profile ?? null].filter(Boolean).join(' · '),
      metaParts: [
        `@${project.id}`,
        ...(repoLabel ? [repoLabel] : []),
      ],
      searchParts: [
        project.id,
        project.title,
        project.summary || project.description,
        project.status,
        project.currentFocus ?? '',
        project.profile ?? '',
        repoLabel ?? '',
        projectTaskSummary(project),
      ],
      record: project,
    };
  });

  return [...noteItems, ...projectItems, ...skillItems];
}

function compareNodeItems(left: UnifiedNodeItem, right: UnifiedNodeItem, sort: NodeBrowserSort): number {
  if (sort === 'title') {
    return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  }

  const leftSort = left.sortAt ?? '';
  const rightSort = right.sortAt ?? '';
  return rightSort.localeCompare(leftSort) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}

function matchesFilter(item: UnifiedNodeItem, filter: NodeBrowserFilter, query: string): boolean {
  if (filter !== 'all' && item.kind !== filter) {
    return false;
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return item.searchParts.join('\n').toLowerCase().includes(normalizedQuery);
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

function NodeBrowserListItem({
  item,
  selected,
  locationSearch,
}: {
  item: UnifiedNodeItem;
  selected: boolean;
  locationSearch: string;
}) {
  const href = buildNodeHref(locationSearch, item);

  return (
    <ListLinkRow to={href} selected={selected}>
      <div className="flex items-start justify-between gap-3">
        <p className="ui-row-title break-words">{item.title}</p>
        <span className="shrink-0 text-[11px] text-dim">{item.sortAt ? timeAgo(item.sortAt) : '—'}</span>
      </div>
      {item.summary ? <p className="ui-row-summary">{item.summary}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">{kindLabel(item.kind)}</span>
        <span className="opacity-40">·</span>
        <span>{item.contextPrimary}</span>
        {item.contextSecondary ? (
          <>
            <span className="opacity-40">·</span>
            <span>{item.contextSecondary}</span>
          </>
        ) : null}
        <span className="opacity-40">·</span>
        <span className="font-mono" title={`@${item.id}`}>{`@${item.id}`}</span>
      </div>
    </ListLinkRow>
  );
}

function KnowledgeBrowserRail({
  nodes,
  filteredNodes,
  selected,
  locationSearch,
  filter,
  query,
  sort,
  counts,
  loading,
  error,
  refreshing,
  onRefresh,
  onQueryChange,
  onSortChange,
  onFilterChange,
}: {
  nodes: UnifiedNodeItem[];
  filteredNodes: UnifiedNodeItem[];
  selected: { kind: NodeLinkKind; id: string } | null;
  locationSearch: string;
  filter: NodeBrowserFilter;
  query: string;
  sort: NodeBrowserSort;
  counts: { all: number; note: number; project: number; skill: number };
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onQueryChange: (value: string) => void;
  onSortChange: (value: NodeBrowserSort) => void;
  onFilterChange: (value: NodeBrowserFilter) => void;
}) {
  const overviewHref = useMemo(() => buildOverviewHref(locationSearch), [locationSearch]);
  const groupedNodes = useMemo(() => {
    if (filter !== 'all') {
      return [];
    }

    return NODE_KIND_ORDER
      .map((kind) => ({
        kind,
        items: filteredNodes.filter((item) => item.kind === kind),
      }))
      .filter((entry) => entry.items.length > 0);
  }, [filter, filteredNodes]);

  const filterLabel = filter === 'all' ? 'All' : pluralKindLabel(filter);
  const filteredCountLabel = `${filteredNodes.length} visible ${filteredNodes.length === 1 ? 'node' : 'nodes'}`;
  const selectedLabel = selected ? `@${selected.id}` : 'overview';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-border-subtle px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-card-title">Knowledge Base</p>
            <p className="ui-card-meta mt-1">Browse notes, projects, and skills together.</p>
          </div>
          <ToolbarButton onClick={onRefresh} disabled={refreshing} aria-label="Refresh knowledge base">
            {refreshing ? 'Refreshing…' : '↻'}
          </ToolbarButton>
        </div>

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

        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search knowledge"
          aria-label="Search knowledge"
          className={INPUT_CLASS}
          autoComplete="off"
          spellCheck={false}
        />

        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value as NodeBrowserSort)}
            aria-label="Sort nodes"
            className={SELECT_CLASS}
          >
            <option value="updated">Recently updated</option>
            <option value="title">Title</option>
          </select>
          <p className="min-w-0 flex-1 truncate text-[11px] text-dim">
            {counts.all} total nodes
          </p>
        </div>

        {error && nodes.length > 0 ? <p className="text-[11px] text-danger">{error}</p> : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border-subtle px-4 py-2 text-[11px] text-dim">
          <div className="flex items-center justify-between gap-3">
            <span>{filteredCountLabel}</span>
            <span className="max-w-[12rem] truncate" title={selectedLabel}>{selectedLabel}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {loading && nodes.length === 0 ? <LoadingState label="Loading knowledge base…" className="px-1 py-6" /> : null}
          {error && nodes.length === 0 ? <ErrorState message={`Unable to load knowledge base: ${error}`} className="px-1 py-6" /> : null}

          {!loading && !error && nodes.length === 0 ? (
            <EmptyState
              className="py-10"
              title="No nodes yet"
              body="Create a note or project, or add a skill, to start building the shared knowledge base."
            />
          ) : null}

          {!loading && !error && nodes.length > 0 ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <SectionLabel label="Overview" className="px-3 pb-1" />
                <ListLinkRow to={overviewHref} selected={!selected}>
                  <p className="ui-row-title">Overview</p>
                  <p className="ui-row-summary">Browse the whole knowledge base and open the workspace you want.</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
                    <span>{counts.all} nodes</span>
                    <span className="opacity-40">·</span>
                    <span>{counts.note} notes</span>
                    <span className="opacity-40">·</span>
                    <span>{counts.project} projects</span>
                    <span className="opacity-40">·</span>
                    <span>{counts.skill} skills</span>
                  </div>
                </ListLinkRow>
              </div>

              {filteredNodes.length === 0 ? (
                <EmptyState
                  className="py-10"
                  title="No matching nodes"
                  body={`No ${filterLabel.toLowerCase()} match the current browser filter.`}
                />
              ) : filter === 'all' ? (
                groupedNodes.map((entry) => (
                  <div key={entry.kind} className="space-y-1">
                    <SectionLabel label={pluralKindLabel(entry.kind)} count={entry.items.length} className="px-3 pb-1" />
                    <div className="space-y-0.5">
                      {entry.items.map((item) => (
                        <NodeBrowserListItem
                          key={`${item.kind}:${item.id}`}
                          item={item}
                          selected={selected?.kind === item.kind && selected?.id === item.id}
                          locationSearch={locationSearch}
                        />
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="space-y-1">
                  <SectionLabel label={filterLabel} count={filteredNodes.length} className="px-3 pb-1" />
                  <div className="space-y-0.5">
                    {filteredNodes.map((item) => (
                      <NodeBrowserListItem
                        key={`${item.kind}:${item.id}`}
                        item={item}
                        selected={selected?.kind === item.kind && selected?.id === item.id}
                        locationSearch={locationSearch}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
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
      <div className="space-y-4">
        <Link to={overviewHref} className="ui-toolbar-button inline-flex">Back to table</Link>
        <NoteWorkspace
          detail={detail.detail}
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
      </div>
    );
  }

  if (detail.kind === 'skill') {
    return (
      <div className="space-y-4">
        <Link to={overviewHref} className="ui-toolbar-button inline-flex">Back to table</Link>
        <SkillWorkspace
          detail={detail.detail}
          selectedView={readSkillView(locationSearch)}
          selectedItem={new URLSearchParams(locationSearch).get(SKILL_ITEM_SEARCH_PARAM)?.trim() || null}
          locationSearch={locationSearch}
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
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link to={overviewHref} className="ui-toolbar-button inline-flex">Back to table</Link>
      <ProjectDetailPanel
        project={detail.detail}
        activeProfile={currentProfile ?? undefined}
        onChanged={() => {
          emitProjectsChanged();
          onRefreshAll();
        }}
        onDeleted={() => {
          emitProjectsChanged();
          navigate(overviewHref);
        }}
      />
    </div>
  );
}

function KnowledgeLandingView({
  nodes,
  filteredNodes,
  counts,
  filter,
  query,
  loading,
  error,
}: {
  nodes: UnifiedNodeItem[];
  filteredNodes: UnifiedNodeItem[];
  counts: { all: number; note: number; project: number; skill: number };
  filter: NodeBrowserFilter;
  query: string;
  loading: boolean;
  error: string | null;
}) {
  if (loading && nodes.length === 0) {
    return <LoadingState label="Loading knowledge base…" className="h-full justify-center" />;
  }

  if (error && nodes.length === 0) {
    return <ErrorState message={`Unable to load knowledge base: ${error}`} className="m-6" />;
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <EmptyState
          title="No nodes yet"
          body="Create a note or project, or add a skill, to start building the shared knowledge base."
        />
      </div>
    );
  }

  if (filteredNodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <EmptyState
          title="No matching nodes"
          body="Adjust the browser filters or try a broader search."
        />
      </div>
    );
  }

  const selectionBody = query.trim()
    ? `Showing ${filteredNodes.length} matching ${filteredNodes.length === 1 ? 'node' : 'nodes'} in the browser on the left.`
    : filter === 'all'
      ? 'Choose a note, project, or skill from the browser on the left to open its workspace.'
      : `Choose a ${singularFilterLabel(filter)} from the browser on the left to open its workspace.`;

  return (
    <div className="flex h-full items-center justify-center px-8">
      <EmptyState
        title="Select a node"
        body={`${selectionBody} ${counts.all} total nodes are available across ${counts.note} notes, ${counts.project} projects, and ${counts.skill} skills.`}
      />
    </div>
  );
}

export function NodesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projects: projectSnapshot } = useAppData();
  const { data: profileState } = useApi(api.profiles);
  const memoryApi = useApi(api.memory, 'nodes-memory');
  const projectsApi = useApi(
    () => profileState ? api.projects({ profile: profileState.currentProfile }) : Promise.resolve([]),
    profileState ? `nodes-projects:${profileState.currentProfile}` : 'nodes-projects:pending',
  );
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<NodeBrowserSort>('updated');

  const filter = useMemo(() => readNodeBrowserFilter(location.search), [location.search]);
  const selected = useMemo(() => readSelectedNode(location.search), [location.search]);
  const currentProfile = profileState?.currentProfile ?? null;
  const projects = currentProfile && projectSnapshot ? projectSnapshot : (projectsApi.data ?? null);
  const nodes = useMemo(() => buildUnifiedNodes(memoryApi.data ?? null, projects), [memoryApi.data, projects]);
  const filteredNodes = useMemo(
    () => nodes.filter((item) => matchesFilter(item, filter, query)).sort((left, right) => compareNodeItems(left, right, sort)),
    [filter, nodes, query, sort],
  );
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
  const combinedError = [memoryApi.error, projectsApi.error].filter(Boolean).join(' · ') || null;
  const dataLoading = (memoryApi.loading || projectsApi.loading) && nodes.length === 0;
  const pageMeta = useMemo(() => {
    if (dataLoading) {
      return 'Loading knowledge base…';
    }

    if (counts.all === 0) {
      return 'No notes, projects, or skills yet.';
    }

    if (query.trim() || filter !== 'all') {
      return `${filteredNodes.length} visible · ${counts.all} total nodes`;
    }

    return `${counts.all} nodes · ${counts.note} notes · ${counts.project} projects · ${counts.skill} skills`;
  }, [counts.all, counts.note, counts.project, counts.skill, dataLoading, filter, filteredNodes.length, query]);

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
          ? (selectedNode.record as ProjectRecord).profile
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
      memoryApi.refetch({ resetLoading: false }),
      projectsApi.refetch({ resetLoading: false }),
      detailApi.refetch({ resetLoading: false }),
    ]);
  }, [detailApi, memoryApi, projectsApi]);

  const handleFilterChange = useCallback((nextFilter: NodeBrowserFilter) => {
    const nextSelection = selected && (nextFilter === 'all' || selected.kind === nextFilter)
      ? selected
      : null;

    navigate(`/nodes${buildNodesSearch(location.search, {
      filter: nextFilter,
      kind: nextSelection?.kind ?? null,
      nodeId: nextSelection?.id ?? null,
    })}`, { replace: true });
  }, [location.search, navigate, selected]);

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
    <BrowserSplitLayout
      storageKey={NODES_BROWSER_WIDTH_STORAGE_KEY}
      initialWidth={340}
      minWidth={280}
      maxWidth={420}
      browser={(
        <KnowledgeBrowserRail
          nodes={nodes}
          filteredNodes={filteredNodes}
          selected={selected}
          locationSearch={location.search}
          filter={filter}
          query={query}
          sort={sort}
          counts={counts}
          loading={dataLoading}
          error={combinedError}
          refreshing={memoryApi.refreshing || projectsApi.refreshing}
          onRefresh={() => { void refreshAll(); }}
          onQueryChange={setQuery}
          onSortChange={setSort}
          onFilterChange={handleFilterChange}
        />
      )}
      browserLabel="Knowledge browser"
    >
      <div className="min-w-0 min-h-0 flex flex-1 flex-col overflow-hidden">
        <PageHeader>
          <PageHeading
            title="Knowledge Base"
            meta={pageMeta}
          />
        </PageHeader>
        <KnowledgeLandingView
          nodes={nodes}
          filteredNodes={filteredNodes}
          counts={counts}
          filter={filter}
          query={query}
          loading={dataLoading}
          error={combinedError}
        />
      </div>
    </BrowserSplitLayout>
  );
}

export default NodesPage;
