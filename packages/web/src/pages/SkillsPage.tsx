import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { getKnowledgeSkillName } from '../knowledgeSelection';
import type { SkillDetail } from '../types';
import { formatUsageLabel, humanizeSkillName } from '../memoryOverview';
import { BrowserSplitLayout } from '../components/BrowserSplitLayout';
import {
  EmptyState,
  ErrorState,
  ListLinkRow,
  LoadingState,
  ToolbarButton,
} from '../components/ui';
import { RichMarkdownEditor } from '../components/editor/RichMarkdownEditor';
import {
  NodeInspectorSection,
  NodeMetadataList,
  NodePrimaryToolbar,
  NodeWorkspaceShell,
  WorkspaceActionNotice,
} from '../components/NodeWorkspace';
import { SkillsBrowserRail } from '../components/SkillsBrowserRail';
import { NodeLinkList, UnresolvedNodeLinks } from '../components/NodeLinksSection';
import {
  buildSkillsSearch,
  readSkillView,
  SKILL_ITEM_SEARCH_PARAM,
  type SkillWorkspaceView,
  sortSkills,
} from '../skillWorkspaceState';
import { buildRailWidthStorageKey } from '../layoutSizing';
import { ensureOpenResourceShelfItem } from '../openResourceShelves';
import { joinMarkdownFrontmatter, splitMarkdownFrontmatter } from '../markdownDocument';

const SKILLS_BROWSER_WIDTH_STORAGE_KEY = buildRailWidthStorageKey('skills-browser');

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
      <div className="mx-auto max-w-4xl space-y-px">
        {detail.references.map((reference) => (
          <ListLinkRow
            key={reference.path}
            to={`/skills${buildSkillsSearch(locationSearch, { skillName: detail.skill.name, view: 'references', item: reference.relativePath })}`}
            leading={<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal" />}
          >
            <p className="ui-row-title">{reference.title}</p>
            <p className="ui-row-summary">{reference.summary || 'Open this reference to inspect or edit it.'}</p>
            <div className="ui-row-meta flex flex-wrap items-center gap-1.5">
              <span>{reference.relativePath}</span>
            </div>
          </ListLinkRow>
        ))}
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
  const [savedContent, setSavedContent] = useState(initialContentParts.body);
  const [draft, setDraft] = useState(initialContentParts.body);
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
        setSavedContent(parts.body);
        setDraft(parts.body);
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
        setSavedContent(parts.body);
        setDraft(parts.body);
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
        setSavedContent(parts.body);
        setDraft(parts.body);
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
          <NodeInspectorSection title="Metadata">
            <NodeMetadataList items={[
              { label: 'Name', value: detail.skill.name },
              { label: 'Source', value: detail.skill.source },
              { label: 'Usage', value: formatUsageLabel(detail.skill.recentSessionCount, detail.skill.lastUsedAt, detail.skill.usedInLastSession, 'Not used recently') },
            ]} />
          </NodeInspectorSection>
          <NodeInspectorSection title="Description">
            <p className="text-[13px] leading-relaxed text-secondary">{detail.skill.description}</p>
          </NodeInspectorSection>
          <NodeInspectorSection title="Relationships">
            <div className="space-y-4">
              <NodeLinkList title="Links to" items={detail.links?.outgoing} surface="main" emptyText="This skill does not reference other nodes yet." />
              <NodeLinkList title="Linked from" items={detail.links?.incoming} surface="main" emptyText="No other nodes link to this skill yet." />
              <UnresolvedNodeLinks ids={detail.links?.unresolved} />
            </div>
          </NodeInspectorSection>
          <details className="ui-disclosure">
            <summary className="ui-disclosure-summary">
              <span>Advanced</span>
              <span className="ui-disclosure-meta">Source details</span>
            </summary>
            <div className="ui-disclosure-body">
              <NodeMetadataList items={[
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

export function SkillsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data, loading, refreshing, error, refetch } = useApi(api.memory);
  const skills = useMemo(() => sortSkills(data?.skills ?? []), [data?.skills]);
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

  return (
    <BrowserSplitLayout
      storageKey={SKILLS_BROWSER_WIDTH_STORAGE_KEY}
      initialWidth={320}
      minWidth={260}
      maxWidth={440}
      browser={<SkillsBrowserRail />}
      browserLabel="Skills browser"
    >
      <div className="min-w-0 min-h-0 flex flex-1 flex-col px-6 py-4">
        <div className="flex items-center justify-end pb-4">
          <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); if (selectedSkillName) { void skillDetailApi.refetch({ resetLoading: false }); } }} disabled={refreshing || skillDetailApi.refreshing}>
            {refreshing || skillDetailApi.refreshing ? 'Refreshing…' : 'Refresh'}
          </ToolbarButton>
        </div>

        {loading && !data ? <LoadingState label="Loading skills…" /> : null}
        {error && !data ? <ErrorState message={`Unable to load skills: ${error}`} /> : null}

        {!loading && !error && (
          <div className="h-full min-h-0 overflow-hidden">
            {selectedSkillName ? (
              skillDetailApi.loading && !skillDetailApi.data ? (
                <LoadingState label="Loading skill…" className="h-full justify-center" />
              ) : skillDetailApi.error || !skillDetailApi.data ? (
                <ErrorState message={`Unable to load skill: ${skillDetailApi.error ?? 'Skill not found.'}`} />
              ) : (
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
              )
            ) : skills.length === 0 ? (
              <EmptyState
                className="h-full"
                title="No skills yet"
                body="Add a skill to the active profile to make reusable workflows available to the agent."
              />
            ) : (
              <EmptyState
                className="h-full"
                title="Select a skill"
                body="Choose a skill from the browser on the left to open it here."
              />
            )}
          </div>
        )}
      </div>
    </BrowserSplitLayout>
  );
}

