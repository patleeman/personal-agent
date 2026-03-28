import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { useAppData } from '../contexts';
import { MEMORIES_CHANGED_EVENT } from '../memoryDocEvents';
import { PROJECTS_CHANGED_EVENT } from '../projectEvents';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PageHeading,
  SectionLabel,
  ToolbarButton,
} from '../components/ui';
import { formatUsageLabel, humanizeSkillName } from '../memoryOverview';
import type {
  MemoryData,
  MemoryDocDetail,
  MemoryDocItem,
  MemorySkillItem,
  NodeLinkKind,
  ProjectDetail,
  ProjectRecord,
  SkillDetail,
} from '../types';
import { buildNoteSearch } from '../noteWorkspaceState';
import { buildNodesSearch, readNodeBrowserFilter, readSelectedNode, type NodeBrowserFilter } from '../nodeWorkspaceState';
import { ensureOpenResourceShelfItem } from '../openResourceShelves';
import { buildProjectsHref } from '../projectWorkspaceState';
import { buildSkillsSearch } from '../skillWorkspaceState';
import { NodeLinkList, UnresolvedNodeLinks } from '../components/NodeLinksSection';
import {
  NodeInspectorSection,
  NodePrimaryToolbar,
  NodePropertyList,
  NodeRailSection,
  NodeWorkspaceBody,
  NodeWorkspaceShell,
} from '../components/NodeWorkspace';
import { splitMarkdownFrontmatter } from '../markdownDocument';
import { readEditableNoteBody } from '../noteDocument';
import { timeAgo } from '../utils';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const SELECT_CLASS = `${INPUT_CLASS} sm:w-auto`;
const NODE_KIND_ORDER: NodeLinkKind[] = ['note', 'project', 'skill'];

type NodeBrowserSort = 'updated' | 'title';
type NodeBrowserGroup = 'none' | 'type';

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

function KnowledgeBaseTable({
  items,
  locationSearch,
}: {
  items: UnifiedNodeItem[];
  locationSearch: string;
}) {
  const navigate = useNavigate();

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border-subtle bg-surface/10">
      <table className="min-w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-base/95 backdrop-blur">
          <tr className="border-b border-border-subtle text-[10px] uppercase tracking-[0.14em] text-dim">
            <th className="px-4 py-2.5 font-medium">Node</th>
            <th className="px-3 py-2.5 font-medium">Type</th>
            <th className="px-3 py-2.5 font-medium">Context</th>
            <th className="px-4 py-2.5 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const nodeHref = `/nodes${buildNodesSearch(locationSearch, {
              kind: item.kind,
              nodeId: item.id,
            })}`;

            return (
              <tr
                key={`${item.kind}:${item.id}`}
                className="cursor-pointer border-b border-border-subtle align-top transition-colors hover:bg-surface/35"
                tabIndex={0}
                onClick={() => navigate(nodeHref)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(nodeHref);
                  }
                }}
              >
                <td className="px-4 py-3">
                  <div className="space-y-1.5">
                    <Link
                      to={nodeHref}
                      className="text-[14px] font-medium text-primary transition-colors hover:text-accent"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {item.title}
                    </Link>
                    {item.summary ? <p className="max-w-3xl text-[12px] leading-relaxed text-secondary">{item.summary}</p> : null}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
                      {item.metaParts.map((part, index) => (
                        <span key={`${item.kind}:${item.id}:${index}`} className={index === 0 ? 'font-mono' : undefined}>
                          {part}
                        </span>
                      ))}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-secondary">{kindLabel(item.kind)}</td>
                <td className="px-3 py-3">
                  <div className="text-[12px] text-primary">{item.contextPrimary}</div>
                  <div className="mt-0.5 text-[11px] text-dim">{item.contextSecondary || '—'}</div>
                </td>
                <td className="px-4 py-3 text-[12px] text-secondary">{item.sortAt ? timeAgo(item.sortAt) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NoteWorkspaceContent({ detail }: { detail: MemoryDocDetail }) {
  const preview = summarizeDetailContent('note', detail.content, detail.memory.title);

  return (
    <div className="space-y-6">
      {detail.memory.description ? (
        <NodeInspectorSection title="For the agent">
          <p className="text-[13px] leading-relaxed text-secondary">{detail.memory.description}</p>
        </NodeInspectorSection>
      ) : null}

      {preview ? (
        <NodeInspectorSection title="Preview">
          <p className="text-[13px] leading-relaxed text-secondary">{preview}</p>
        </NodeInspectorSection>
      ) : null}
    </div>
  );
}

function NoteWorkspaceInspector({ detail }: { detail: MemoryDocDetail }) {
  return (
    <>
      <NodeRailSection title="Properties">
        <NodePropertyList items={[
          { label: 'ID', value: <span className="font-mono text-[12px]">{detail.memory.id}</span> },
          { label: 'Kind', value: 'Note' },
          { label: 'Context', value: summarizeNoteContext(detail.memory) },
          { label: 'Status', value: detail.memory.status ?? 'active' },
          { label: 'Updated', value: detail.memory.updated ? timeAgo(detail.memory.updated) : '—' },
          { label: 'Path', value: <span className="break-all font-mono text-[12px]">{detail.memory.path}</span> },
        ]} />
      </NodeRailSection>
      <NodeRailSection title="References" meta={`${detail.references.length}`}>
        <ReferenceList references={detail.references} />
      </NodeRailSection>
      <NodeRailSection title="Relationships">
        <div className="space-y-4">
          <NodeLinkList title="Links to" items={detail.links?.outgoing} surface="main" emptyText="This note does not reference other nodes yet." />
          <NodeLinkList title="Linked from" items={detail.links?.incoming} surface="main" emptyText="No other nodes link to this note yet." />
          <UnresolvedNodeLinks ids={detail.links?.unresolved} />
        </div>
      </NodeRailSection>
    </>
  );
}

function SkillWorkspaceContent({ detail }: { detail: SkillDetail }) {
  const preview = summarizeDetailContent('skill', detail.content, humanizeSkillName(detail.skill.name));

  return (
    <div className="space-y-6">
      {preview ? (
        <NodeInspectorSection title="Definition preview">
          <p className="text-[13px] leading-relaxed text-secondary">{preview}</p>
        </NodeInspectorSection>
      ) : null}
    </div>
  );
}

function SkillWorkspaceInspector({ detail }: { detail: SkillDetail }) {
  return (
    <>
      <NodeRailSection title="Properties">
        <NodePropertyList items={[
          { label: 'Name', value: detail.skill.name },
          { label: 'Kind', value: 'Skill' },
          { label: 'Source', value: detail.skill.source },
          { label: 'Usage', value: formatUsageLabel(detail.skill.recentSessionCount, detail.skill.lastUsedAt, detail.skill.usedInLastSession, 'Not used recently') },
          { label: 'Path', value: <span className="break-all font-mono text-[12px]">{detail.skill.path}</span> },
        ]} />
      </NodeRailSection>
      <NodeRailSection title="References" meta={`${detail.references.length}`}>
        <ReferenceList references={detail.references} />
      </NodeRailSection>
      <NodeRailSection title="Relationships">
        <div className="space-y-4">
          <NodeLinkList title="Links to" items={detail.links?.outgoing} surface="main" emptyText="This skill does not reference other nodes yet." />
          <NodeLinkList title="Linked from" items={detail.links?.incoming} surface="main" emptyText="No other nodes link to this skill yet." />
          <UnresolvedNodeLinks ids={detail.links?.unresolved} />
        </div>
      </NodeRailSection>
    </>
  );
}

function ProjectWorkspaceContent({ detail }: { detail: ProjectDetail }) {
  return (
    <div className="space-y-6">
      {detail.project.currentFocus ? (
        <NodeInspectorSection title="Current focus">
          <p className="text-[13px] leading-relaxed text-secondary">{detail.project.currentFocus}</p>
        </NodeInspectorSection>
      ) : null}

      {detail.project.blockers.length > 0 ? (
        <NodeInspectorSection title="Blockers">
          <ul className="space-y-2 text-[13px] leading-relaxed text-secondary">
            {detail.project.blockers.map((blocker) => <li key={blocker}>• {blocker}</li>)}
          </ul>
        </NodeInspectorSection>
      ) : null}

      {detail.project.recentProgress.length > 0 ? (
        <NodeInspectorSection title="Recent progress">
          <ul className="space-y-2 text-[13px] leading-relaxed text-secondary">
            {detail.project.recentProgress.map((entry) => <li key={entry}>• {entry}</li>)}
          </ul>
        </NodeInspectorSection>
      ) : null}
    </div>
  );
}

function ProjectWorkspaceInspector({ detail }: { detail: ProjectDetail }) {
  return (
    <>
      <NodeRailSection title="Properties">
        <NodePropertyList items={[
          { label: 'ID', value: <span className="font-mono text-[12px]">{detail.project.id}</span> },
          { label: 'Kind', value: 'Project' },
          { label: 'Status', value: humanizeStatus(detail.project.status) },
          { label: 'Tasks', value: projectTaskSummary(detail.project) },
          { label: 'Profile', value: detail.profile },
          { label: 'Updated', value: timeAgo(detail.project.updatedAt) },
          { label: 'Repo root', value: detail.project.repoRoot ? <span className="break-all font-mono text-[12px]">{detail.project.repoRoot}</span> : '—' },
        ]} />
      </NodeRailSection>
      <NodeRailSection title="Linked conversations" meta={`${detail.linkedConversations.length}`}>
        <ProjectConversationList conversations={detail.linkedConversations} />
      </NodeRailSection>
      <NodeRailSection title="Relationships">
        <div className="space-y-4">
          <NodeLinkList title="Links to" items={detail.links?.outgoing} surface="main" emptyText="This project does not reference other nodes yet." />
          <NodeLinkList title="Linked from" items={detail.links?.incoming} surface="main" emptyText="No other nodes link to this project yet." />
          <UnresolvedNodeLinks ids={detail.links?.unresolved} />
        </div>
      </NodeRailSection>
    </>
  );
}

function SelectedNodeWorkspace({
  selected,
  detail,
  loading,
  error,
  refreshing,
  locationSearch,
  onRefresh,
}: {
  selected: UnifiedNodeItem | null;
  detail: SelectedNodeDetail | null;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  locationSearch: string;
  onRefresh: () => void;
}) {
  const backHref = `/nodes${buildNodesSearch(locationSearch, { kind: null, nodeId: null })}`;

  if (!selected) {
    return <ErrorState message="Node not found." className="min-h-[18rem]" />;
  }

  if (loading && !detail) {
    return <LoadingState label="Loading node…" className="min-h-[18rem]" />;
  }

  if (error || !detail) {
    return (
      <div className="space-y-3">
        <ErrorState message={`Failed to load node: ${error ?? 'Node not found.'}`} />
        <Link to={backHref} className="ui-toolbar-button inline-flex">Back to table</Link>
      </div>
    );
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
        kindLabel('note'),
        `@${detail.detail.memory.id}`,
        detail.detail.memory.updated ? `updated ${timeAgo(detail.detail.memory.updated)}` : null,
      ]
    : detail.kind === 'skill'
      ? [
          kindLabel('skill'),
          `@${detail.detail.skill.name}`,
          formatUsageLabel(detail.detail.skill.recentSessionCount, detail.detail.skill.lastUsedAt, detail.detail.skill.usedInLastSession, 'Not used recently'),
        ]
      : [
          kindLabel('project'),
          `@${detail.detail.project.id}`,
          humanizeStatus(detail.detail.project.status),
          detail.detail.project.updatedAt ? `updated ${timeAgo(detail.detail.project.updatedAt)}` : null,
        ];

  return (
    <NodeWorkspaceShell
      eyebrow="Knowledge Base"
      title={title}
      summary={summary}
      meta={meta.filter(Boolean).map((item) => <span key={item as string}>{item}</span>)}
      actions={(
        <NodePrimaryToolbar>
          <Link to={backHref} className="ui-toolbar-button">Back to table</Link>
          <ToolbarButton onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</ToolbarButton>
          <Link to={dedicatedHref} className="ui-toolbar-button">Open dedicated page</Link>
        </NodePrimaryToolbar>
      )}
      inspector={(
        <>
          {detail.kind === 'note' ? <NoteWorkspaceInspector detail={detail.detail} /> : null}
          {detail.kind === 'skill' ? <SkillWorkspaceInspector detail={detail.detail} /> : null}
          {detail.kind === 'project' ? <ProjectWorkspaceInspector detail={detail.detail} /> : null}
        </>
      )}
    >
      <NodeWorkspaceBody className="px-0 py-0">
        <div className="mx-auto max-w-4xl">
          {detail.kind === 'note' ? <NoteWorkspaceContent detail={detail.detail} /> : null}
          {detail.kind === 'skill' ? <SkillWorkspaceContent detail={detail.detail} /> : null}
          {detail.kind === 'project' ? <ProjectWorkspaceContent detail={detail.detail} /> : null}
        </div>
      </NodeWorkspaceBody>
    </NodeWorkspaceShell>
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
  const [group, setGroup] = useState<NodeBrowserGroup>('none');

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
  const groupedNodes = useMemo(() => {
    if (group === 'none') {
      return [];
    }

    return NODE_KIND_ORDER
      .map((kind) => ({
        kind,
        items: filteredNodes.filter((item) => item.kind === kind),
      }))
      .filter((entry) => entry.items.length > 0);
  }, [filteredNodes, group]);

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
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
          {selected ? (
            <SelectedNodeWorkspace
              selected={selectedNode}
              detail={detailApi.data ?? null}
              loading={detailApi.loading}
              error={detailApi.error}
              refreshing={memoryApi.refreshing || projectsApi.refreshing || detailApi.refreshing}
              locationSearch={location.search}
              onRefresh={() => { void refreshAll(); }}
            />
          ) : (
            <>
              <PageHeader
                actions={(
                  <ToolbarButton onClick={() => { void refreshAll(); }} disabled={memoryApi.refreshing || projectsApi.refreshing}>
                    {memoryApi.refreshing || projectsApi.refreshing ? 'Refreshing…' : 'Refresh'}
                  </ToolbarButton>
                )}
              >
                <PageHeading
                  title="Knowledge Base"
                  meta="Browse notes, projects, and skills together, then open the one you want to work on."
                />
              </PageHeader>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] text-secondary">
                    {query.trim() ? `Showing ${filteredNodes.length} of ${nodes.length} nodes.` : `${nodes.length} nodes.`}
                  </span>
                  <select
                    value={filter}
                    onChange={(event) => navigate(`/nodes${buildNodesSearch(location.search, { filter: event.target.value as NodeBrowserFilter })}`, { replace: true })}
                    aria-label="Filter nodes by type"
                    className={SELECT_CLASS}
                  >
                    <option value="all">All nodes ({counts.all})</option>
                    <option value="note">Notes ({counts.note})</option>
                    <option value="project">Projects ({counts.project})</option>
                    <option value="skill">Skills ({counts.skill})</option>
                  </select>
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as NodeBrowserSort)}
                    aria-label="Sort nodes"
                    className={SELECT_CLASS}
                  >
                    <option value="updated">Recently updated</option>
                    <option value="title">Title</option>
                  </select>
                  <select
                    value={group}
                    onChange={(event) => setGroup(event.target.value as NodeBrowserGroup)}
                    aria-label="Group nodes"
                    className={SELECT_CLASS}
                  >
                    <option value="none">Ungrouped</option>
                    <option value="type">Group by type</option>
                  </select>
                </div>

                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search knowledge"
                  aria-label="Search knowledge"
                  className={`${INPUT_CLASS} sm:w-[22rem]`}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              {memoryApi.loading && !memoryApi.data && !projects ? <LoadingState label="Loading knowledge base…" className="min-h-[18rem]" /> : null}
              {memoryApi.error && !memoryApi.data ? <ErrorState message={`Unable to load knowledge base: ${memoryApi.error}`} /> : null}

              {!memoryApi.loading && !memoryApi.error && nodes.length === 0 ? (
                <EmptyState
                  className="min-h-[18rem]"
                  title="No nodes yet"
                  body="Create a note or project, or add a skill, to start building the shared knowledge base."
                />
              ) : null}

              {!memoryApi.loading && !memoryApi.error && filteredNodes.length === 0 && nodes.length > 0 ? (
                <EmptyState
                  className="min-h-[18rem]"
                  title="No matching nodes"
                  body="Try a broader search or another type filter."
                />
              ) : null}

              {!memoryApi.loading && !memoryApi.error && filteredNodes.length > 0 ? (
                group === 'type' ? (
                  <div className="space-y-5">
                    {groupedNodes.map((entry) => (
                      <div key={entry.kind} className="space-y-2">
                        <SectionLabel label={pluralKindLabel(entry.kind)} count={entry.items.length} />
                        <KnowledgeBaseTable items={entry.items} locationSearch={location.search} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <KnowledgeBaseTable items={filteredNodes} locationSearch={location.search} />
                )
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default NodesPage;
