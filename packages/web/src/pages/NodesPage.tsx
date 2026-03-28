import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { useAppData } from '../contexts';
import { MEMORIES_CHANGED_EVENT } from '../memoryDocEvents';
import { PROJECTS_CHANGED_EVENT } from '../projectEvents';
import { PageHeader, PageHeading, BrowserRecordRow, EmptyState, ErrorState, LoadingState, Pill, ToolbarButton, SurfacePanel, cx } from '../components/ui';
import { humanizeSkillName, formatUsageLabel } from '../memoryOverview';
import type { MemoryData, MemoryDocDetail, MemoryDocItem, MemorySkillItem, NodeLinkKind, ProjectDetail, ProjectRecord, SkillDetail } from '../types';
import { buildNoteSearch } from '../noteWorkspaceState';
import { buildProjectsHref } from '../projectWorkspaceState';
import { buildSkillsSearch } from '../skillWorkspaceState';
import { buildNodesHref, buildNodesSearch, readNodeBrowserFilter, readSelectedNode, type NodeBrowserFilter } from '../nodeWorkspaceState';
import { ensureOpenResourceShelfItem } from '../openResourceShelves';
import { timeAgo } from '../utils';
import { NodeLinkList, UnresolvedNodeLinks } from '../components/NodeLinksSection';
import { NodeInspectorSection, NodeMetadataList, NodePrimaryToolbar, NodeWorkspaceBody, NodeWorkspaceShell } from '../components/NodeWorkspace';
import { readEditableNoteBody } from '../noteDocument';
import { splitMarkdownFrontmatter } from '../markdownDocument';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

type UnifiedNodeItem = {
  kind: NodeLinkKind;
  id: string;
  title: string;
  summary: string;
  sortAt: string | null;
  metaParts: string[];
  record: MemoryDocItem | MemorySkillItem | ProjectRecord;
};

type SelectedNodeDetail =
  | { kind: 'note'; detail: MemoryDocDetail }
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

function kindTone(kind: NodeLinkKind): 'accent' | 'teal' | 'warning' {
  switch (kind) {
    case 'note':
      return 'accent';
    case 'project':
      return 'teal';
    case 'skill':
      return 'warning';
  }
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
    metaParts: [
      `@${memory.id}`,
      summarizeNoteContext(memory),
      ...(memory.path ? [memory.path] : []),
    ],
    record: memory,
  }));

  const skillItems = (memoryData?.skills ?? []).map((skill) => ({
    kind: 'skill' as const,
    id: skill.name,
    title: humanizeSkillName(skill.name),
    summary: skill.description,
    sortAt: skill.lastUsedAt ?? null,
    metaParts: [
      `@${skill.name}`,
      skill.source,
      formatUsageLabel(skill.recentSessionCount, skill.lastUsedAt, skill.usedInLastSession, 'Not used recently'),
    ],
    record: skill,
  }));

  const projectItems = (projects ?? []).map((project) => ({
    kind: 'project' as const,
    id: project.id,
    title: project.title,
    summary: project.summary || project.description,
    sortAt: project.updatedAt,
    metaParts: [
      `@${project.id}`,
      project.status,
      projectTaskSummary(project),
      ...(project.profile ? [project.profile] : []),
    ],
    record: project,
  }));

  return [...projectItems, ...noteItems, ...skillItems].sort((left, right) => {
    const leftSort = left.sortAt ?? '';
    const rightSort = right.sortAt ?? '';
    return rightSort.localeCompare(leftSort) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  });
}

function matchesFilter(item: UnifiedNodeItem, filter: NodeBrowserFilter, query: string): boolean {
  if (filter !== 'all' && item.kind !== filter) {
    return false;
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [
    item.id,
    item.title,
    item.summary,
    ...item.metaParts,
  ].join('\n').toLowerCase().includes(normalizedQuery);
}

function summarizeDetailContent(kind: NodeLinkKind, content: string, title: string): string | null {
  if (!content.trim()) {
    return null;
  }

  const body = kind === 'note'
    ? readEditableNoteBody(content, title)
    : splitMarkdownFrontmatter(content).body.replace(/^\n+/, '');
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > 420 ? `${normalized.slice(0, 419).trimEnd()}…` : normalized;
}

function ReferenceList({
  references,
}: {
  references: Array<{ title: string; summary: string; relativePath: string }>;
}) {
  if (references.length === 0) {
    return <p className="text-[12px] text-dim">No supporting references yet.</p>;
  }

  return (
    <div className="space-y-px">
      {references.map((reference) => (
        <div key={reference.relativePath} className="ui-list-row -mx-1 px-2 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-primary">{reference.title}</p>
            <p className="mt-0.5 text-[11px] text-dim">{reference.relativePath}</p>
            {reference.summary ? <p className="mt-1 text-[12px] leading-relaxed text-secondary">{reference.summary}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectConversationList({
  conversations,
}: {
  conversations: ProjectDetail['linkedConversations'];
}) {
  if (conversations.length === 0) {
    return <p className="text-[12px] text-dim">No linked conversations yet.</p>;
  }

  return (
    <div className="space-y-px">
      {conversations.slice(0, 5).map((conversation) => (
        <Link key={conversation.conversationId} to={`/conversations/${encodeURIComponent(conversation.conversationId)}`} className="ui-list-row ui-list-row-hover -mx-1 px-2 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-primary">{conversation.title}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-secondary">{conversation.snippet || 'Open this conversation for the full narrative context.'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
              <span>{conversation.isRunning ? 'running' : 'saved'}</span>
              {conversation.lastActivityAt ? (
                <>
                  <span className="opacity-40">·</span>
                  <span>{timeAgo(conversation.lastActivityAt)}</span>
                </>
              ) : null}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function NodesBrowser({
  items,
  filter,
  query,
  locationSearch,
  refreshing,
  onFilterChange,
  onQueryChange,
  onRefresh,
  selected,
}: {
  items: UnifiedNodeItem[];
  filter: NodeBrowserFilter;
  query: string;
  locationSearch: string;
  refreshing: boolean;
  onFilterChange: (next: NodeBrowserFilter) => void;
  onQueryChange: (next: string) => void;
  onRefresh: () => void;
  selected: { kind: NodeLinkKind; id: string } | null;
}) {
  const counts = useMemo(() => ({
    all: items.length,
    note: items.filter((item) => item.kind === 'note').length,
    project: items.filter((item) => item.kind === 'project').length,
    skill: items.filter((item) => item.kind === 'skill').length,
  }), [items]);

  const filterTabs: Array<{ id: NodeBrowserFilter; label: string }> = [
    { id: 'all', label: `All (${counts.all})` },
    { id: 'note', label: `Notes (${counts.note})` },
    { id: 'project', label: `Projects (${counts.project})` },
    { id: 'skill', label: `Skills (${counts.skill})` },
  ];

  return (
    <SurfacePanel muted className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="border-b border-border-subtle px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[15px] font-medium text-primary">Browse nodes</p>
            <p className="text-[12px] leading-relaxed text-secondary">Notes, projects, and skills in one place. Type is a filter, not a page boundary.</p>
          </div>
          <ToolbarButton onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</ToolbarButton>
        </div>
        <div className="mt-4 space-y-3">
          <div className="ui-segmented-control" role="tablist" aria-label="Node type filter">
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onFilterChange(tab.id)}
                className={cx('ui-segmented-button', filter === tab.id && 'ui-segmented-button-active')}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search nodes…"
            aria-label="Search nodes"
            className={INPUT_CLASS}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {items.length === 0 ? (
          <EmptyState
            className="min-h-[16rem]"
            title="No matching nodes"
            body={query.trim() ? 'Try a broader search across ids, titles, and summaries.' : 'Create a note or project, or add a skill, to start building the shared node layer.'}
          />
        ) : (
          <div className="space-y-px">
            {items.map((item) => {
              const href = `/nodes${buildNodesSearch(locationSearch, {
                filter,
                kind: item.kind,
                nodeId: item.id,
              })}`;
              const selectedRow = selected?.kind === item.kind && selected?.id === item.id;

              return (
                <BrowserRecordRow
                  key={`${item.kind}:${item.id}`}
                  to={href}
                  selected={selectedRow}
                  label={<Pill tone={kindTone(item.kind)}>{kindLabel(item.kind)}</Pill>}
                  aside={item.sortAt ? timeAgo(item.sortAt) : '—'}
                  heading={item.title}
                  summary={item.summary}
                  meta={(
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
                      {item.metaParts.map((part, index) => (
                        <span key={`${item.kind}:${item.id}:${index}`} className={index === 0 ? 'font-mono text-accent' : undefined}>{part}</span>
                      ))}
                    </div>
                  )}
                />
              );
            })}
          </div>
        )}
      </div>
    </SurfacePanel>
  );
}

function NodeDetailInspector({
  selected,
  detail,
  loading,
  error,
}: {
  selected: UnifiedNodeItem | null;
  detail: SelectedNodeDetail | null;
  loading: boolean;
  error: string | null;
}) {
  if (!selected) {
    return (
      <SurfacePanel muted className="flex h-full min-h-0 items-center justify-center rounded-2xl px-8 py-10">
        <EmptyState
          title="Select a node"
          body="Browse notes, projects, and skills together, then inspect one here without bouncing between separate knowledge surfaces."
        />
      </SurfacePanel>
    );
  }

  if (loading && !detail) {
    return <LoadingState label="Loading node…" className="h-full justify-center" />;
  }

  if (error || !detail) {
    return <ErrorState message={`Failed to load node: ${error ?? 'Node not found.'}`} />;
  }

  const dedicatedHref = detail.kind === 'note'
    ? `/notes${buildNoteSearch('', { memoryId: detail.detail.memory.id, creating: false })}`
    : detail.kind === 'skill'
      ? `/skills${buildSkillsSearch('', { skillName: detail.detail.skill.name, view: 'definition', item: null })}`
      : buildProjectsHref(detail.detail.profile, detail.detail.project.id);

  const title = detail.kind === 'note'
    ? detail.detail.memory.title
    : detail.kind === 'skill'
      ? humanizeSkillName(detail.detail.skill.name)
      : detail.detail.project.title;
  const summary = detail.kind === 'note'
    ? detail.detail.memory.summary
    : detail.kind === 'skill'
      ? detail.detail.skill.description
      : detail.detail.project.summary || detail.detail.project.description;
  const meta = detail.kind === 'note'
    ? [
        `@${detail.detail.memory.id}`,
        detail.detail.memory.path,
        detail.detail.memory.updated ? `updated ${timeAgo(detail.detail.memory.updated)}` : null,
      ]
    : detail.kind === 'skill'
      ? [
          `@${detail.detail.skill.name}`,
          detail.detail.skill.source,
          detail.detail.skill.path,
        ]
      : [
          `@${detail.detail.project.id}`,
          detail.detail.profile,
          detail.detail.project.repoRoot ?? null,
          `updated ${timeAgo(detail.detail.project.updatedAt)}`,
        ];

  const contentPreview = detail.kind === 'note'
    ? summarizeDetailContent('note', detail.detail.content, detail.detail.memory.title)
    : detail.kind === 'skill'
      ? summarizeDetailContent('skill', detail.detail.content, title)
      : null;

  return (
    <SurfacePanel muted className="h-full min-h-0 overflow-hidden rounded-2xl px-6 py-6">
      <NodeWorkspaceShell
        eyebrow={<Pill tone={kindTone(detail.kind)}>{kindLabel(detail.kind)}</Pill>}
        title={title}
        summary={summary}
        meta={meta.filter(Boolean).map((item) => <span key={item as string}>{item}</span>)}
        actions={(
          <NodePrimaryToolbar>
            <Link to={dedicatedHref} className="ui-toolbar-button">Open dedicated page</Link>
          </NodePrimaryToolbar>
        )}
        compactTitle={false}
      >
        <NodeWorkspaceBody className="px-0 py-6">
          <div className="space-y-6">
            {detail.kind === 'note' ? (
              <>
                {detail.detail.memory.description ? (
                  <NodeInspectorSection title="For the agent">
                    <p className="text-[13px] leading-relaxed text-secondary">{detail.detail.memory.description}</p>
                  </NodeInspectorSection>
                ) : null}
                {contentPreview ? (
                  <NodeInspectorSection title="Preview">
                    <p className="text-[13px] leading-relaxed text-secondary">{contentPreview}</p>
                  </NodeInspectorSection>
                ) : null}
                <NodeInspectorSection title="Metadata">
                  <NodeMetadataList items={[
                    { label: 'Kind', value: kindLabel('note') },
                    { label: 'Context', value: summarizeNoteContext(detail.detail.memory) },
                    { label: 'Status', value: detail.detail.memory.status ?? 'active' },
                  ]} />
                </NodeInspectorSection>
                <NodeInspectorSection title="References" meta={`${detail.detail.references.length}`}>
                  <ReferenceList references={detail.detail.references} />
                </NodeInspectorSection>
                <NodeInspectorSection title="Links">
                  <div className="space-y-4">
                    <NodeLinkList title="Links to" items={detail.detail.links?.outgoing} surface="main" emptyText="This note does not reference other nodes yet." />
                    <NodeLinkList title="Linked from" items={detail.detail.links?.incoming} surface="main" emptyText="No other nodes link to this note yet." />
                    <UnresolvedNodeLinks ids={detail.detail.links?.unresolved} />
                  </div>
                </NodeInspectorSection>
              </>
            ) : null}

            {detail.kind === 'skill' ? (
              <>
                {contentPreview ? (
                  <NodeInspectorSection title="Preview">
                    <p className="text-[13px] leading-relaxed text-secondary">{contentPreview}</p>
                  </NodeInspectorSection>
                ) : null}
                <NodeInspectorSection title="Metadata">
                  <NodeMetadataList items={[
                    { label: 'Kind', value: kindLabel('skill') },
                    { label: 'Source', value: detail.detail.skill.source },
                    { label: 'Usage', value: formatUsageLabel(detail.detail.skill.recentSessionCount, detail.detail.skill.lastUsedAt, detail.detail.skill.usedInLastSession, 'Not used recently') },
                  ]} />
                </NodeInspectorSection>
                <NodeInspectorSection title="References" meta={`${detail.detail.references.length}`}>
                  <ReferenceList references={detail.detail.references} />
                </NodeInspectorSection>
                <NodeInspectorSection title="Links">
                  <div className="space-y-4">
                    <NodeLinkList title="Links to" items={detail.detail.links?.outgoing} surface="main" emptyText="This skill does not reference other nodes yet." />
                    <NodeLinkList title="Linked from" items={detail.detail.links?.incoming} surface="main" emptyText="No other nodes link to this skill yet." />
                    <UnresolvedNodeLinks ids={detail.detail.links?.unresolved} />
                  </div>
                </NodeInspectorSection>
              </>
            ) : null}

            {detail.kind === 'project' ? (
              <>
                <NodeInspectorSection title="Metadata">
                  <NodeMetadataList items={[
                    { label: 'Kind', value: kindLabel('project') },
                    { label: 'Status', value: detail.detail.project.status },
                    { label: 'Tasks', value: projectTaskSummary(detail.detail.project) },
                  ]} />
                </NodeInspectorSection>
                {detail.detail.project.currentFocus ? (
                  <NodeInspectorSection title="Current focus">
                    <p className="text-[13px] leading-relaxed text-secondary">{detail.detail.project.currentFocus}</p>
                  </NodeInspectorSection>
                ) : null}
                {detail.detail.project.blockers.length > 0 ? (
                  <NodeInspectorSection title="Blockers">
                    <ul className="space-y-2 text-[13px] leading-relaxed text-secondary">
                      {detail.detail.project.blockers.map((blocker) => <li key={blocker}>• {blocker}</li>)}
                    </ul>
                  </NodeInspectorSection>
                ) : null}
                {detail.detail.project.recentProgress.length > 0 ? (
                  <NodeInspectorSection title="Recent progress">
                    <ul className="space-y-2 text-[13px] leading-relaxed text-secondary">
                      {detail.detail.project.recentProgress.map((entry) => <li key={entry}>• {entry}</li>)}
                    </ul>
                  </NodeInspectorSection>
                ) : null}
                <NodeInspectorSection title="Linked conversations" meta={`${detail.detail.linkedConversations.length}`}>
                  <ProjectConversationList conversations={detail.detail.linkedConversations} />
                </NodeInspectorSection>
                <NodeInspectorSection title="Links">
                  <div className="space-y-4">
                    <NodeLinkList title="Links to" items={detail.detail.links?.outgoing} surface="main" emptyText="This project does not reference other nodes yet." />
                    <NodeLinkList title="Linked from" items={detail.detail.links?.incoming} surface="main" emptyText="No other nodes link to this project yet." />
                    <UnresolvedNodeLinks ids={detail.detail.links?.unresolved} />
                  </div>
                </NodeInspectorSection>
              </>
            ) : null}
          </div>
        </NodeWorkspaceBody>
      </NodeWorkspaceShell>
    </SurfacePanel>
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

  const filter = useMemo(() => readNodeBrowserFilter(location.search), [location.search]);
  const selected = useMemo(() => readSelectedNode(location.search), [location.search]);
  const currentProfile = profileState?.currentProfile ?? null;
  const projects = currentProfile && projectSnapshot ? projectSnapshot : (projectsApi.data ?? null);
  const nodes = useMemo(() => buildUnifiedNodes(memoryApi.data ?? null, projects), [memoryApi.data, projects]);
  const filteredNodes = useMemo(
    () => nodes.filter((item) => matchesFilter(item, filter, query)),
    [filter, nodes, query],
  );
  const selectedNode = useMemo(
    () => selected ? nodes.find((item) => item.kind === selected.kind && item.id === selected.id) ?? null : null,
    [nodes, selected],
  );

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
      navigate(`/nodes${buildNodesSearch(location.search, { kind: null, nodeId: null })}`, { replace: true });
    }
  }, [location.search, navigate, nodes, selected]);

  return (
    <div className="min-h-0 flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-5">
          <PageHeader
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Link to="/notes" className="ui-toolbar-button">Notes workspace</Link>
                <Link to="/projects" className="ui-toolbar-button">Projects workspace</Link>
                <Link to="/skills" className="ui-toolbar-button">Skills workspace</Link>
              </div>
            )}
          >
            <PageHeading
              title="Nodes"
              meta="Browse notes, projects, and skills together, then open the dedicated workspace only when you need type-specific editing."
            />
          </PageHeader>

          {memoryApi.loading && !memoryApi.data && !projects ? (
            <LoadingState label="Loading nodes…" className="min-h-[18rem]" />
          ) : memoryApi.error ? (
            <ErrorState message={`Unable to load nodes: ${memoryApi.error}`} />
          ) : (
            <div className="grid min-h-0 gap-6 xl:grid-cols-[minmax(22rem,34rem)_minmax(0,1fr)]">
              <div className="min-h-[28rem] xl:min-h-[calc(100vh-14rem)]">
                <NodesBrowser
                  items={filteredNodes}
                  filter={filter}
                  query={query}
                  locationSearch={location.search}
                  refreshing={memoryApi.refreshing || projectsApi.refreshing || detailApi.refreshing}
                  onFilterChange={(next) => navigate(`/nodes${buildNodesSearch(location.search, { filter: next })}`, { replace: true })}
                  onQueryChange={setQuery}
                  onRefresh={() => { void refreshAll(); }}
                  selected={selected}
                />
              </div>
              <div className="min-h-[28rem] xl:min-h-[calc(100vh-14rem)]">
                <NodeDetailInspector
                  selected={selectedNode}
                  detail={detailApi.data ?? null}
                  loading={detailApi.loading}
                  error={detailApi.error}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
