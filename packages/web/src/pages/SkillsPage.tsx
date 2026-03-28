import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { getKnowledgeSkillName } from '../knowledgeSelection';
import type { MemorySkillItem, SkillDetail } from '../types';
import { formatUsageLabel, humanizeSkillName } from '../memoryOverview';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PageHeading,
  ToolbarButton,
} from '../components/ui';
import { RichMarkdownEditor } from '../components/editor/RichMarkdownEditor';
import {
  NodePrimaryToolbar,
  NodePropertyList,
  NodeRailSection,
  NodeWorkspaceShell,
  WorkspaceActionNotice,
} from '../components/NodeWorkspace';
import { NodeLinkList, UnresolvedNodeLinks } from '../components/NodeLinksSection';
import {
  buildSkillsSearch,
  matchesSkill,
  readSkillView,
  SKILL_ITEM_SEARCH_PARAM,
  type SkillWorkspaceView,
  sortSkills,
} from '../skillWorkspaceState';
import { ensureOpenResourceShelfItem } from '../openResourceShelves';
import { joinMarkdownFrontmatter, normalizeMarkdownValue, splitMarkdownFrontmatter } from '../markdownDocument';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

function SkillReferencesList({
  detail,
  locationSearch,
}: {
  detail: SkillDetail;
  locationSearch: string;
}) {
  if (detail.references.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8 py-10">
        <EmptyState
          title="No references yet"
          body="This skill does not have supporting reference files yet."
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-border-subtle bg-surface/10">
        <div className="divide-y divide-border-subtle">
          {detail.references.map((reference) => (
            <Link
              key={reference.path}
              to={`/skills${buildSkillsSearch(locationSearch, { skillName: detail.skill.name, view: 'references', item: reference.relativePath })}`}
              className="block px-4 py-3 transition-colors hover:bg-surface/35"
            >
              <p className="text-[14px] font-medium text-primary">{reference.title}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-secondary">{reference.summary || 'Open this reference to inspect or edit it.'}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
                <span>{reference.relativePath}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function SkillLinksView({ detail }: { detail: SkillDetail }) {
  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <NodeLinkList title="Links to" items={detail.links?.outgoing} surface="main" emptyText="This skill does not reference other nodes yet." />
        <NodeLinkList title="Linked from" items={detail.links?.incoming} surface="main" emptyText="No other nodes link to this skill yet." />
        <UnresolvedNodeLinks ids={detail.links?.unresolved} />
      </div>
    </div>
  );
}

function SkillWorkspace({
  detail,
  selectedView,
  selectedItem,
  locationSearch,
  onNavigate,
  onRefetched,
}: {
  detail: SkillDetail;
  selectedView: SkillWorkspaceView;
  selectedItem: string | null;
  locationSearch: string;
  onNavigate: (updates: { skillName?: string | null; view?: SkillWorkspaceView | null; item?: string | null }, replace?: boolean) => void;
  onRefetched: () => void;
}) {
  const selectedReference = detail.references.find((reference) => reference.relativePath === selectedItem) ?? null;
  const initialContentParts = useMemo(() => splitMarkdownFrontmatter(detail.content), [detail.content]);
  const [savedContent, setSavedContent] = useState(normalizeMarkdownValue(initialContentParts.body));
  const [draft, setDraft] = useState(normalizeMarkdownValue(initialContentParts.body));
  const [selectedFrontmatter, setSelectedFrontmatter] = useState<string | null>(initialContentParts.frontmatter);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'accent' | 'danger' | 'warning'; text: string } | null>(null);
  const selectedPath = selectedReference?.path ?? detail.skill.path;
  const selectedLabel = selectedReference?.title ?? humanizeSkillName(detail.skill.name);
  const selectedSummary = selectedReference?.summary ?? detail.skill.description;
  const dirty = draft !== savedContent;
  const resourceTabs = [
    {
      id: 'definition',
      label: 'Definition',
      to: `/skills${buildSkillsSearch(locationSearch, { skillName: detail.skill.name, view: 'definition', item: null })}`,
      selected: selectedView === 'definition',
    },
    {
      id: 'references',
      label: `References${detail.references.length > 0 ? ` (${detail.references.length})` : ''}`,
      to: `/skills${buildSkillsSearch(locationSearch, { skillName: detail.skill.name, view: 'references', item: selectedReference?.relativePath ?? null })}`,
      selected: selectedView === 'references',
    },
    {
      id: 'links',
      label: 'Links',
      to: `/skills${buildSkillsSearch(locationSearch, { skillName: detail.skill.name, view: 'links', item: null })}`,
      selected: selectedView === 'links',
    },
  ];

  useEffect(() => {
    if (selectedView !== 'references' || !selectedItem) {
      return;
    }

    if (!selectedReference) {
      onNavigate({ item: null }, true);
    }
  }, [onNavigate, selectedItem, selectedReference, selectedView]);

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedContent() {
      if (selectedView === 'links' || (selectedView === 'references' && !selectedReference)) {
        setSavedContent('');
        setDraft('');
        setSelectedFrontmatter(null);
        setContentError(null);
        setContentLoading(false);
        return;
      }

      if (selectedView === 'definition') {
        const parts = splitMarkdownFrontmatter(detail.content);
        const normalizedBody = normalizeMarkdownValue(parts.body);
        setSavedContent(normalizedBody);
        setDraft(normalizedBody);
        setSelectedFrontmatter(parts.frontmatter);
        setContentError(null);
        setContentLoading(false);
        return;
      }

      setContentLoading(true);
      setContentError(null);
      try {
        if (!selectedReference) {
          return;
        }

        const result = await api.memoryFile(selectedReference.path);
        if (cancelled) {
          return;
        }
        const parts = splitMarkdownFrontmatter(result.content);
        const normalizedBody = normalizeMarkdownValue(parts.body);
        setSavedContent(normalizedBody);
        setDraft(normalizedBody);
        setSelectedFrontmatter(parts.frontmatter);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setContentError(error instanceof Error ? error.message : String(error));
        setSelectedFrontmatter(null);
        setSavedContent('');
        setDraft('');
      } finally {
        if (!cancelled) {
          setContentLoading(false);
        }
      }
    }

    void loadSelectedContent();
    return () => {
      cancelled = true;
    };
  }, [detail.content, selectedReference, selectedView]);

  useEffect(() => {
    if (selectedView === 'links' || (selectedView === 'references' && !selectedReference)) {
      return undefined;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty, selectedReference, selectedView]);

  useEffect(() => {
    if (selectedView === 'links' || (selectedView === 'references' && !selectedReference)) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  async function handleSave() {
    if (saveBusy || !dirty || selectedView === 'links' || (selectedView === 'references' && !selectedReference)) {
      return;
    }

    setSaveBusy(true);
    setNotice(null);

    try {
      const path = selectedReference?.path ?? detail.skill.path;
      await api.memoryFileSave(path, joinMarkdownFrontmatter(selectedFrontmatter, draft));
      setSavedContent(draft);
      setNotice({ tone: 'accent', text: selectedReference ? `Saved ${selectedReference.relativePath}.` : 'Saved skill definition.' });
      onRefetched();
    } catch (error) {
      setNotice({ tone: 'danger', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleReload() {
    if (contentLoading) {
      return;
    }

    if (selectedReference) {
      setContentLoading(true);
      try {
        const result = await api.memoryFile(selectedReference.path);
        const parts = splitMarkdownFrontmatter(result.content);
        const normalizedBody = normalizeMarkdownValue(parts.body);
        setSavedContent(normalizedBody);
        setDraft(normalizedBody);
        setSelectedFrontmatter(parts.frontmatter);
        setContentError(null);
      } catch (error) {
        setContentError(error instanceof Error ? error.message : String(error));
      } finally {
        setContentLoading(false);
      }
      return;
    }

    onRefetched();
  }

  return (
    <NodeWorkspaceShell
      eyebrow="Skills"
      title={selectedLabel}
      summary={selectedSummary}
      meta={(
        <>
          <span>{detail.skill.source}</span>
          <span className="opacity-40">·</span>
          <span>{formatUsageLabel(detail.skill.recentSessionCount, detail.skill.lastUsedAt, detail.skill.usedInLastSession, 'Not used recently')}</span>
          {dirty && (
            <>
              <span className="opacity-40">·</span>
              <span className="text-warning">Unsaved changes</span>
            </>
          )}
        </>
      )}
      resourceTabs={resourceTabs}
      actions={(
        <NodePrimaryToolbar>
          {(selectedView !== 'links' && !(selectedView === 'references' && !selectedReference)) && (
            <>
              <ToolbarButton onClick={() => { void handleReload(); }} disabled={contentLoading || saveBusy}>
                {contentLoading ? 'Loading…' : 'Reload'}
              </ToolbarButton>
              <ToolbarButton onClick={() => { void handleSave(); }} disabled={!dirty || saveBusy || contentLoading || Boolean(contentError)}>
                {saveBusy ? 'Saving…' : 'Save'}
              </ToolbarButton>
            </>
          )}
        </NodePrimaryToolbar>
      )}
      notice={notice ? <WorkspaceActionNotice tone={notice.tone}>{notice.text}</WorkspaceActionNotice> : null}
      inspector={(
        <>
          <NodeRailSection title="Properties">
            <NodePropertyList items={[
              { label: 'Name', value: detail.skill.name },
              { label: 'Source', value: detail.skill.source },
              { label: 'Usage', value: formatUsageLabel(detail.skill.recentSessionCount, detail.skill.lastUsedAt, detail.skill.usedInLastSession, 'Not used recently') },
            ]} />
          </NodeRailSection>
          <NodeRailSection title="Description">
            <p className="text-[12px] leading-relaxed text-secondary">{detail.skill.description}</p>
          </NodeRailSection>
          <NodeRailSection title="Relationships">
            <div className="space-y-4">
              <NodeLinkList title="Links to" items={detail.links?.outgoing} surface="main" emptyText="This skill does not reference other nodes yet." />
              <NodeLinkList title="Linked from" items={detail.links?.incoming} surface="main" emptyText="No other nodes link to this skill yet." />
              <UnresolvedNodeLinks ids={detail.links?.unresolved} />
            </div>
          </NodeRailSection>
          <details className="ui-disclosure">
            <summary className="ui-disclosure-summary">
              <span>Advanced</span>
              <span className="ui-disclosure-meta">Source details</span>
            </summary>
            <div className="ui-disclosure-body">
              <NodePropertyList items={[
                { label: 'Path', value: <span className="break-all font-mono text-[12px]">{selectedPath}</span> },
              ]} />
            </div>
          </details>
        </>
      )}
    >
      {contentError ? (
        <div className="p-6"><ErrorState message={`Unable to load file: ${contentError}`} /></div>
      ) : contentLoading ? (
        <LoadingState label="Loading skill…" className="h-full justify-center" />
      ) : selectedView === 'references' && !selectedReference ? (
        <SkillReferencesList detail={detail} locationSearch={locationSearch} />
      ) : selectedView === 'links' ? (
        <SkillLinksView detail={detail} />
      ) : (
        <div className="h-full overflow-y-auto px-6 py-6">
          <div className="mx-auto min-h-full max-w-4xl">
            <RichMarkdownEditor
              value={draft}
              onChange={setDraft}
              placeholder="Start writing…"
            />
          </div>
        </div>
      )}
    </NodeWorkspaceShell>
  );
}

function skillSourceLabel(skill: MemorySkillItem): string {
  return skill.source === 'shared' ? 'Shared' : skill.source;
}

function SkillsTable({
  skills,
  locationSearch,
}: {
  skills: MemorySkillItem[];
  locationSearch: string;
}) {
  const navigate = useNavigate();

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border-subtle bg-surface/10">
      <table className="min-w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-base/95 backdrop-blur">
          <tr className="border-b border-border-subtle text-[10px] uppercase tracking-[0.14em] text-dim">
            <th className="px-4 py-2.5 font-medium">Skill</th>
            <th className="px-3 py-2.5 font-medium">Source</th>
            <th className="px-3 py-2.5 font-medium">Usage</th>
            <th className="px-4 py-2.5 font-medium">Path</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((skill) => {
            const skillHref = `/skills${buildSkillsSearch(locationSearch, { skillName: skill.name, view: 'definition', item: null })}`;

            return (
              <tr
                key={`${skill.source}:${skill.name}`}
                className="cursor-pointer border-b border-border-subtle align-top transition-colors hover:bg-surface/35"
                tabIndex={0}
                onClick={() => navigate(skillHref)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(skillHref);
                  }
                }}
              >
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={skillHref}
                        className="text-[14px] font-medium text-primary transition-colors hover:text-accent"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {humanizeSkillName(skill.name)}
                      </Link>
                      {skill.usedInLastSession ? <span className="text-[11px] text-accent">Used recently</span> : null}
                    </div>
                    <p className="max-w-3xl text-[12px] leading-relaxed text-secondary">{skill.description}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
                      <span className="font-mono">{skill.name}</span>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-[12px] text-secondary">{skillSourceLabel(skill)}</td>
                <td className="px-3 py-3">
                  <div className="text-[12px] text-primary">
                    {formatUsageLabel(skill.recentSessionCount, skill.lastUsedAt, skill.usedInLastSession, 'Not used recently')}
                  </div>
                </td>
                <td className="px-4 py-3 text-[12px] text-secondary">
                  <span className="break-all">{skill.path}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SkillsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data, loading, refreshing, error, refetch } = useApi(api.memory);
  const skills = useMemo(() => sortSkills(data?.skills ?? []), [data?.skills]);
  const [query, setQuery] = useState('');
  const filteredSkills = useMemo(() => skills.filter((skill) => matchesSkill(skill, query)), [query, skills]);
  const selectedSkillName = useMemo(() => getKnowledgeSkillName(location.search), [location.search]);
  const selectedView = useMemo(() => readSkillView(location.search), [location.search]);
  const selectedItem = useMemo(() => new URLSearchParams(location.search).get(SKILL_ITEM_SEARCH_PARAM)?.trim() || null, [location.search]);
  const skillDetailApi = useApi(
    () => selectedSkillName ? api.skillDetail(selectedSkillName) : Promise.resolve(null),
    `skill-workspace:${selectedSkillName ?? 'none'}`,
  );

  const setSelectedSkill = useCallback((updates: { skillName?: string | null; view?: SkillWorkspaceView | null; item?: string | null }, replace = false) => {
    const nextSearch = buildSkillsSearch(location.search, updates);
    navigate(`/skills${nextSearch}`, { replace });
  }, [location.search, navigate]);

  useEffect(() => {
    if (loading || !selectedSkillName) {
      return;
    }

    if (skills.some((skill) => skill.name === selectedSkillName)) {
      return;
    }

    setSelectedSkill({ skillName: null, view: 'definition', item: null }, true);
  }, [loading, selectedSkillName, setSelectedSkill, skills]);

  useEffect(() => {
    if (!selectedSkillName) {
      return;
    }

    ensureOpenResourceShelfItem('skill', selectedSkillName);
  }, [selectedSkillName]);

  if (selectedSkillName) {
    return (
      <div className="min-h-0 flex h-full flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {skillDetailApi.loading && !skillDetailApi.data ? (
            <LoadingState label="Loading skill…" className="h-full justify-center" />
          ) : skillDetailApi.error || !skillDetailApi.data ? (
            <ErrorState message={`Unable to load skill: ${skillDetailApi.error ?? 'Skill not found.'}`} />
          ) : (
            <div className="mx-auto w-full max-w-[1440px]">
              <SkillWorkspace
                detail={skillDetailApi.data}
                selectedView={selectedView}
                selectedItem={selectedItem}
                locationSearch={location.search}
                onNavigate={setSelectedSkill}
                onRefetched={() => {
                  void skillDetailApi.refetch({ resetLoading: false });
                  void refetch({ resetLoading: false });
                }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
          <PageHeader
            actions={(
              <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </ToolbarButton>
            )}
          >
            <PageHeading
              title="Skills"
              meta="Browse reusable workflows, then open one into the main workspace and the left sidebar shelf."
            />
          </PageHeader>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[12px] text-secondary">
              {query.trim() ? `Showing ${filteredSkills.length} of ${skills.length} skills.` : `${skills.length} skills.`}
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search skills"
              aria-label="Search skills"
              className={`${INPUT_CLASS} sm:w-[22rem]`}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {loading && !data ? <LoadingState label="Loading skills…" className="min-h-[18rem]" /> : null}
          {error && !data ? <ErrorState message={`Unable to load skills: ${error}`} /> : null}

          {!loading && !error && skills.length === 0 ? (
            <EmptyState
              className="min-h-[18rem]"
              title="No skills yet"
              body="Add a skill to the active profile to make reusable workflows available to the agent."
            />
          ) : null}

          {!loading && !error && filteredSkills.length === 0 && skills.length > 0 ? (
            <EmptyState
              className="min-h-[18rem]"
              title="No matching skills"
              body="Try a broader search across skill names and descriptions."
            />
          ) : null}

          {!loading && !error && filteredSkills.length > 0 ? (
            <SkillsTable skills={filteredSkills} locationSearch={location.search} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
