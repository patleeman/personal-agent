import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  formatProjectStatus,
  hasMeaningfulBlockers,
  isProjectArchived,
  summarizeProjectPreview,
} from '../contextRailProject';
import { useApi } from '../hooks';
import {
  buildCapabilityCards,
  buildIdentitySummary,
  buildKnowledgeSections,
  formatUsageLabel,
  humanizeSkillName,
} from '../memoryOverview';
import {
  buildKnowledgeSearch,
  getKnowledgeInstructionPath,
  getKnowledgeMemoryId,
  getKnowledgeProjectId,
  getKnowledgeSection,
  getKnowledgeSkillName,
  type KnowledgeSection,
} from '../knowledgeSelection';
import type { MemoryAgentsItem, MemoryDocItem, MemorySkillItem, ProjectRecord } from '../types';
import { timeAgo } from '../utils';
import {
  EmptyState,
  ErrorState,
  ListLinkRow,
  LoadingState,
  PageHeader,
  PageHeading,
  ToolbarButton,
} from '../components/ui';

type ProjectListFilter = 'active' | 'archived' | 'all';
const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const PROJECT_FILTER_OPTIONS: Array<{ value: ProjectListFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];
const SECTION_OPTIONS: Array<{ value: KnowledgeSection; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'projects', label: 'Projects' },
  { value: 'memories', label: 'Memories' },
  { value: 'skills', label: 'Skills' },
  { value: 'instructions', label: 'Instructions' },
];

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}


function matchesProject(project: ProjectRecord, query: string): boolean {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return true;
  }

  const haystack = [
    project.id,
    project.title,
    project.summary,
    project.description,
    project.status,
    project.currentFocus,
    project.repoRoot,
    project.planSummary,
    ...project.blockers,
    ...project.recentProgress,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .toLowerCase();

  return haystack.includes(normalized);
}

function matchesMemory(memory: MemoryDocItem, query: string): boolean {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return true;
  }

  const haystack = [
    memory.id,
    memory.title,
    memory.summary,
    memory.type,
    memory.status,
    memory.area,
    memory.role,
    memory.parent,
    memory.searchText,
    ...(memory.related ?? []),
    ...memory.tags,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .toLowerCase();

  return haystack.includes(normalized);
}

function matchesSkill(skill: MemorySkillItem, query: string): boolean {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return true;
  }

  const haystack = [
    skill.name,
    humanizeSkillName(skill.name),
    skill.description,
    skill.source,
  ].join('\n').toLowerCase();

  return haystack.includes(normalized);
}

function matchesInstruction(item: MemoryAgentsItem, query: string): boolean {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return true;
  }

  const haystack = [
    item.source,
    item.path,
    item.content,
  ].join('\n').toLowerCase();

  return haystack.includes(normalized);
}

function sortProjects(items: ProjectRecord[]): ProjectRecord[] {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title));
}

function sortMemories(items: MemoryDocItem[]): MemoryDocItem[] {
  return [...items].sort((left, right) => {
    const leftTimestamp = left.updated ?? left.lastUsedAt ?? '';
    const rightTimestamp = right.updated ?? right.lastUsedAt ?? '';
    return rightTimestamp.localeCompare(leftTimestamp) || left.title.localeCompare(right.title);
  });
}

function sortSkills(items: MemorySkillItem[]): MemorySkillItem[] {
  return [...items].sort((left, right) => {
    const leftUsage = Number(left.usedInLastSession) * 10 + (left.recentSessionCount ?? 0);
    const rightUsage = Number(right.usedInLastSession) * 10 + (right.recentSessionCount ?? 0);
    return rightUsage - leftUsage
      || (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? '')
      || humanizeSkillName(left.name).localeCompare(humanizeSkillName(right.name));
  });
}

function SectionTabs({
  locationSearch,
  section,
  onNavigate,
}: {
  locationSearch: string;
  section: KnowledgeSection;
  onNavigate: (search: string) => void;
}) {
  return (
    <div className="ui-segmented-control" role="group" aria-label="Knowledge base section">
      {SECTION_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onNavigate(buildKnowledgeSearch(locationSearch, {
            section: option.value,
            projectId: null,
            memoryId: null,
            skillName: null,
            instructionPath: null,
          }))}
          className={section === option.value ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function OverviewSection({
  label,
  title,
  body,
  children,
}: {
  label: string;
  title: string;
  body?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 border-t border-border-subtle pt-5 first:border-t-0 first:pt-0">
      <div className="space-y-1">
        <p className="ui-section-label">{label}</p>
        <p className="text-[14px] font-medium text-primary">{title}</p>
        {body && <p className="ui-card-body max-w-3xl">{body}</p>}
      </div>
      {children}
    </section>
  );
}

export function KnowledgeBasePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<ProjectListFilter>('active');
  const {
    data: memoryData,
    loading: memoryLoading,
    refreshing: memoryRefreshing,
    error: memoryError,
    refetch: refetchMemory,
  } = useApi(api.memory, 'knowledge-memory');
  const {
    data: projectsData,
    loading: projectsLoading,
    refreshing: projectsRefreshing,
    error: projectsError,
    refetch: refetchProjects,
  } = useApi(api.projects, 'knowledge-projects');

  const section = useMemo<KnowledgeSection>(() => getKnowledgeSection(location.search), [location.search]);
  const selectedProjectId = useMemo(() => getKnowledgeProjectId(location.search), [location.search]);
  const selectedMemoryId = useMemo(() => getKnowledgeMemoryId(location.search), [location.search]);
  const selectedSkillName = useMemo(() => getKnowledgeSkillName(location.search), [location.search]);
  const selectedInstructionPath = useMemo(() => getKnowledgeInstructionPath(location.search), [location.search]);

  const projects = useMemo(() => sortProjects(projectsData ?? []), [projectsData]);
  const activeProjects = useMemo(() => projects.filter((project) => !isProjectArchived(project)), [projects]);
  const archivedProjects = useMemo(() => projects.filter((project) => isProjectArchived(project)), [projects]);
  const memories = useMemo(() => sortMemories(memoryData?.memoryDocs ?? []), [memoryData?.memoryDocs]);
  const skills = useMemo(() => sortSkills(memoryData?.skills ?? []), [memoryData?.skills]);
  const instructions = useMemo(
    () => (memoryData?.agentsMd ?? []).filter((item) => item.exists).sort((left, right) => left.source.localeCompare(right.source)),
    [memoryData?.agentsMd],
  );
  const identity = useMemo(() => memoryData ? buildIdentitySummary(memoryData) : null, [memoryData]);
  const capabilityCards = useMemo(() => memoryData ? buildCapabilityCards(memoryData) : [], [memoryData]);
  const knowledgeSections = useMemo(() => memoryData ? buildKnowledgeSections(memoryData) : null, [memoryData]);

  const filteredProjects = useMemo(() => {
    const base = projectFilter === 'archived'
      ? archivedProjects
      : projectFilter === 'all'
        ? projects
        : activeProjects;
    return base.filter((project) => matchesProject(project, query));
  }, [activeProjects, archivedProjects, projectFilter, projects, query]);
  const filteredMemories = useMemo(() => memories.filter((memory) => matchesMemory(memory, query)), [memories, query]);
  const filteredSkills = useMemo(() => skills.filter((skill) => matchesSkill(skill, query)), [query, skills]);
  const filteredInstructions = useMemo(() => instructions.filter((item) => matchesInstruction(item, query)), [instructions, query]);

  const totalItems = projects.length + memories.length + skills.length + instructions.length;
  const refreshAll = useCallback(async () => {
    await Promise.all([
      refetchMemory({ resetLoading: false }),
      refetchProjects({ resetLoading: false }),
    ]);
  }, [refetchMemory, refetchProjects]);

  function navigateSearch(search: string) {
    navigate(`/knowledge${search}`);
  }

  const pageMeta = `${activeProjects.length} active projects · ${memories.length} memories · ${skills.length} skills · ${instructions.length} instruction sources`;
  const loading = !memoryData && !projectsData && (memoryLoading || projectsLoading);
  const errorMessage = [memoryError, projectsError].filter(Boolean).join(' · ');

  const searchPlaceholder = section === 'projects'
    ? 'Search projects, summaries, blockers, or repo roots'
    : section === 'memories'
      ? 'Search memories, summaries, tags, or metadata'
      : section === 'skills'
        ? 'Search skills, descriptions, or names'
        : section === 'instructions'
          ? 'Search instruction sources and content'
          : 'Search this knowledge base section';

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        className="flex-wrap items-start gap-y-3"
        actions={(
          <ToolbarButton onClick={() => { void refreshAll(); }} disabled={memoryRefreshing || projectsRefreshing}>
            {(memoryRefreshing || projectsRefreshing) ? 'Refreshing…' : '↻ Refresh'}
          </ToolbarButton>
        )}
      >
        <PageHeading title="Knowledge Base" meta={pageMeta} />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && <LoadingState label="Loading knowledge base…" />}
        {!loading && errorMessage && totalItems === 0 && <ErrorState message={`Unable to load knowledge base: ${errorMessage}`} />}

        {!loading && !errorMessage && totalItems === 0 && (
          <EmptyState
            title="No knowledge base items yet."
            body="Add projects, memory packages, skills, or instruction files to build up the durable context for this profile."
          />
        )}

        {!loading && totalItems > 0 && (
          <div className="space-y-5 pb-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionTabs locationSearch={location.search} section={section} onNavigate={navigateSearch} />
              {section !== 'overview' && (
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  className={`${INPUT_CLASS} max-w-xl`}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </div>

            {errorMessage && <p className="text-[12px] text-danger/80">{errorMessage}</p>}

            {section === 'overview' && memoryData && identity && knowledgeSections ? (
              <div className="space-y-8">
                <OverviewSection
                  label="Identity"
                  title={identity.role}
                  body={`The active profile currently contributes ${identity.ruleCount} durable behavior rule${identity.ruleCount === 1 ? '' : 's'} across ${instructions.length} instruction source${instructions.length === 1 ? '' : 's'}.`}
                >
                  <div className="space-y-2">
                    {identity.boundaries.length > 0 ? identity.boundaries.map((rule) => (
                      <p key={rule} className="text-[12px] leading-relaxed text-secondary">• {rule}</p>
                    )) : (
                      <p className="text-[12px] leading-relaxed text-secondary">No explicit boundary rules extracted yet.</p>
                    )}
                    <div className="pt-1">
                      <button
                        type="button"
                        className="ui-toolbar-button"
                        onClick={() => navigateSearch(buildKnowledgeSearch(location.search, { section: 'instructions', instructionPath: instructions[0]?.path ?? null }))}
                      >
                        Open instructions
                      </button>
                    </div>
                  </div>
                </OverviewSection>

                <div className="grid gap-8 xl:grid-cols-2">
                  <OverviewSection
                    label="Projects"
                    title={activeProjects.length > 0 ? 'Active workspaces' : 'No active projects'}
                    body="Projects keep the current work context, plans, blockers, and linked conversations together."
                  >
                    {activeProjects.length > 0 ? (
                      <div className="space-y-px">
                        {activeProjects.slice(0, 5).map((project) => (
                          <ListLinkRow
                            key={project.id}
                            to={`/knowledge${buildKnowledgeSearch(location.search, { section: 'projects', projectId: project.id })}`}
                            leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${hasMeaningfulBlockers(project.blockers) ? 'bg-warning' : 'bg-teal'}`} />}
                          >
                            <p className="ui-row-title">{project.title}</p>
                            <p className="ui-row-summary">{summarizeProjectPreview(project)}</p>
                            <p className="ui-row-meta">{formatProjectStatus(project.status)} · updated {timeAgo(project.updatedAt)}</p>
                          </ListLinkRow>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-secondary">No active projects right now.</p>
                    )}
                  </OverviewSection>

                  <OverviewSection
                    label="Skills"
                    title={capabilityCards.length > 0 ? 'Frequently used workflows' : 'No skills available'}
                    body="Skills are reusable procedures the agent can invoke when the topic matches."
                  >
                    {capabilityCards.length > 0 ? (
                      <div className="space-y-px">
                        {capabilityCards.slice(0, 5).map((card) => (
                          <ListLinkRow
                            key={card.item.name}
                            to={`/knowledge${buildKnowledgeSearch(location.search, { section: 'skills', skillName: card.item.name })}`}
                            leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${card.item.usedInLastSession ? 'bg-accent' : 'bg-teal'}`} />}
                          >
                            <p className="ui-row-title">{card.title}</p>
                            <p className="ui-row-summary">{card.whenToUse}</p>
                            <p className="ui-row-meta">{card.usageLabel} · {card.sourceLabel}</p>
                          </ListLinkRow>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-secondary">No skills are currently available to this profile.</p>
                    )}
                  </OverviewSection>
                </div>

                <div className="grid gap-8 xl:grid-cols-2">
                  <OverviewSection
                    label="Memories"
                    title={memories.length > 0 ? 'Recent durable knowledge' : 'No memory packages'}
                    body="Memories capture reusable knowledge, references, and distilled notes that outlive a single project or conversation."
                  >
                    {knowledgeSections.recent.length > 0 ? (
                      <div className="space-y-px">
                        {knowledgeSections.recent.map((item) => (
                          <ListLinkRow
                            key={item.item.id}
                            to={`/knowledge${buildKnowledgeSearch(location.search, { section: 'memories', memoryId: item.item.id })}`}
                            leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.item.usedInLastSession ? 'bg-accent' : 'bg-teal'}`} />}
                          >
                            <p className="ui-row-title">{item.title}</p>
                            <p className="ui-row-summary">{item.summary || '(no summary)'}</p>
                            <p className="ui-row-meta">{item.usageLabel}</p>
                          </ListLinkRow>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-secondary">No recent memory usage yet.</p>
                    )}
                  </OverviewSection>

                  <OverviewSection
                    label="Instructions"
                    title={instructions.length > 0 ? 'Instruction sources in effect' : 'No instruction sources'}
                    body="Instructions define the durable behavior and operating policy the active profile runs with."
                  >
                    {instructions.length > 0 ? (
                      <div className="space-y-px">
                        {instructions.map((item) => (
                          <ListLinkRow
                            key={item.path}
                            to={`/knowledge${buildKnowledgeSearch(location.search, { section: 'instructions', instructionPath: item.path })}`}
                            leading={<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal" />}
                          >
                            <p className="ui-row-title">{item.source}</p>
                            <p className="ui-row-summary">{item.path}</p>
                            <p className="ui-row-meta">{item.content ? `${item.content.length.toLocaleString()} chars` : 'No content'}</p>
                          </ListLinkRow>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-secondary">No AGENTS/instruction sources are loaded for this profile.</p>
                    )}
                  </OverviewSection>
                </div>
              </div>
            ) : section === 'projects' ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  {archivedProjects.length > 0 && (
                    <div className="ui-segmented-control" role="group" aria-label="Project filter">
                      {PROJECT_FILTER_OPTIONS.map((option) => {
                        const count = option.value === 'active' ? activeProjects.length : option.value === 'archived' ? archivedProjects.length : projects.length;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setProjectFilter(option.value)}
                            className={projectFilter === option.value ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
                          >
                            {option.label}
                            <span className="ml-1 text-dim/70">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <span className="ui-card-meta">Projects keep tracked work state in the knowledge base. Inspect the selected project in the right sidebar.</span>
                </div>

                {filteredProjects.length === 0 ? (
                  <EmptyState
                    title="No projects in this view"
                    body={query.trim() ? 'Try a broader search across project titles, summaries, and blockers.' : 'Switch filters or create a new project from the dedicated project editor.'}
                    action={<Link to="/projects" className="ui-toolbar-button">Open project editor</Link>}
                  />
                ) : (
                  <div className="space-y-px">
                    {filteredProjects.map((project) => {
                      const archived = isProjectArchived(project);
                      const blocked = hasMeaningfulBlockers(project.blockers);
                      return (
                        <ListLinkRow
                          key={project.id}
                          to={`/knowledge${buildKnowledgeSearch(location.search, { section: 'projects', projectId: project.id })}`}
                          selected={project.id === selectedProjectId}
                          leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${archived ? 'bg-border-default' : blocked ? 'bg-warning' : 'bg-teal'}`} />}
                        >
                          <p className="ui-row-title">{project.title}</p>
                          <p className="ui-row-summary">{summarizeProjectPreview(project)}</p>
                          <p className="ui-row-meta break-words">
                            {formatProjectStatus(project.status)} · {project.id} · updated {timeAgo(project.updatedAt)}
                            {archived && project.archivedAt ? ` · archived ${timeAgo(project.archivedAt)}` : ''}
                          </p>
                        </ListLinkRow>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : section === 'memories' ? (
              <div className="space-y-5">
                <p className="ui-card-meta">Memory packages store reusable knowledge, references, and distilled notes. Inspect the selected package in the right sidebar.</p>

                {filteredMemories.length === 0 ? (
                  <EmptyState
                    title="No memory packages in this view"
                    body={query.trim() ? 'Try a broader search across titles, summaries, tags, and related packages.' : 'Create or distill a memory package to add reusable knowledge.'}
                  />
                ) : (
                  <div className="space-y-px">
                    {filteredMemories.map((memory) => (
                      <ListLinkRow
                        key={memory.id}
                        to={`/knowledge${buildKnowledgeSearch(location.search, { section: 'memories', memoryId: memory.id })}`}
                        selected={memory.id === selectedMemoryId}
                        leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${memory.usedInLastSession ? 'bg-accent' : memory.status === 'archived' ? 'bg-border-default' : 'bg-teal'}`} />}
                      >
                        <p className="ui-row-title">{memory.title}</p>
                        <p className="ui-row-summary">{memory.summary || '(no summary)'}</p>
                        <p className="ui-row-meta break-words">
                          {(memory.referenceCount ?? 0)} references · @{memory.id}
                          {memory.updated ? ` · updated ${timeAgo(memory.updated)}` : ''}
                          {memory.tags.length > 0 ? ` · ${memory.tags.slice(0, 3).join(' · ')}` : ''}
                        </p>
                      </ListLinkRow>
                    ))}
                  </div>
                )}
              </div>
            ) : section === 'skills' ? (
              <div className="space-y-5">
                <p className="ui-card-meta">Skills are reusable procedures and workflows the agent can invoke when the topic matches. Inspect the selected skill in the right sidebar.</p>

                {filteredSkills.length === 0 ? (
                  <EmptyState
                    title="No skills in this view"
                    body={query.trim() ? 'Try a broader search across skill names and descriptions.' : 'No skills are currently available to this profile.'}
                  />
                ) : (
                  <div className="space-y-px">
                    {filteredSkills.map((skill) => (
                      <ListLinkRow
                        key={skill.name}
                        to={`/knowledge${buildKnowledgeSearch(location.search, { section: 'skills', skillName: skill.name })}`}
                        selected={skill.name === selectedSkillName}
                        leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${skill.usedInLastSession ? 'bg-accent' : 'bg-teal'}`} />}
                      >
                        <p className="ui-row-title">{humanizeSkillName(skill.name)}</p>
                        <p className="ui-row-summary">{skill.description}</p>
                        <p className="ui-row-meta break-words">{formatUsageLabel(skill.recentSessionCount, skill.lastUsedAt, skill.usedInLastSession, 'Not used recently')} · {skill.source}</p>
                      </ListLinkRow>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                <p className="ui-card-meta">Instructions define the durable role, operating policy, and behavioral boundaries for the active profile. Inspect the selected source in the right sidebar.</p>

                {filteredInstructions.length === 0 ? (
                  <EmptyState
                    title="No instructions in this view"
                    body={query.trim() ? 'Try a broader search across source names, paths, and instruction content.' : 'No instruction files are loaded for this profile.'}
                  />
                ) : (
                  <div className="space-y-px">
                    {filteredInstructions.map((item) => (
                      <ListLinkRow
                        key={item.path}
                        to={`/knowledge${buildKnowledgeSearch(location.search, { section: 'instructions', instructionPath: item.path })}`}
                        selected={item.path === selectedInstructionPath}
                        leading={<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal" />}
                      >
                        <p className="ui-row-title">{item.source}</p>
                        <p className="ui-row-summary">{item.path}</p>
                        <p className="ui-row-meta">{item.content ? `${item.content.length.toLocaleString()} chars` : 'No content loaded'}</p>
                      </ListLinkRow>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
