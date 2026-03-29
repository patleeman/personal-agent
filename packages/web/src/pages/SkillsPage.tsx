import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { getKnowledgeSkillName } from '../knowledgeSelection';
import type { MemorySkillItem, SkillDetail, MemoryReferenceItem } from '../types';
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
  NodeIconActionButton,
  NodePropertyList,
  NodeRailSection,
  NodeToolbarGroup,
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

function SkillFileList({
  detail,
  selectedReference,
  saveBusy,
  dirty,
  onNavigate,
  onSaveCurrent,
}: {
  detail: SkillDetail;
  selectedReference: MemoryReferenceItem | null;
  saveBusy: boolean;
  dirty: boolean;
  onNavigate: (updates: { skillName?: string | null; view?: SkillWorkspaceView | null; item?: string | null }, replace?: boolean) => void;
  onSaveCurrent: () => Promise<boolean>;
}) {
  const files = useMemo(() => ([
    {
      id: 'definition',
      title: 'Definition',
      summary: 'Primary skill definition and guidance.',
      meta: 'Main skill file',
      item: null,
    },
    ...detail.references.map((reference) => ({
      id: reference.relativePath,
      title: reference.title,
      summary: reference.summary || 'Supporting reference file.',
      meta: reference.relativePath,
      item: reference.relativePath,
    })),
  ]), [detail.references]);

  async function handleSelect(item: string | null) {
    if ((item === null && !selectedReference) || item === selectedReference?.relativePath) {
      return;
    }

    if (dirty && !saveBusy) {
      const saved = await onSaveCurrent();
      if (!saved) {
        return;
      }
    }

    onNavigate({ view: null, item }, false);
  }

  return (
    <div className="space-y-1">
      {files.map((file) => {
        const selected = file.item === null ? selectedReference === null : selectedReference?.relativePath === file.item;

        return (
          <button
            key={file.id}
            type="button"
            onClick={() => { void handleSelect(file.item); }}
            disabled={saveBusy}
            className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${selected ? 'bg-surface/40' : 'hover:bg-surface/35 disabled:hover:bg-transparent'}`}
          >
            <p className="text-[13px] font-medium text-primary">{file.title}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-secondary">{file.summary}</p>
            <p className="mt-1.5 break-all text-[11px] font-mono text-dim">{file.meta}</p>
          </button>
        );
      })}

      {detail.references.length === 0 ? (
        <p className="px-3 pt-1 text-[12px] text-dim">No supporting reference files yet.</p>
      ) : null}
    </div>
  );
}

export function SkillWorkspace({
  detail,
  selectedView,
  selectedItem,
  onNavigate,
  onRefetched,
  backHref,
  backLabel,
}: {
  detail: SkillDetail;
  selectedView: SkillWorkspaceView;
  selectedItem: string | null;
  onNavigate: (updates: { skillName?: string | null; view?: SkillWorkspaceView | null; item?: string | null }, replace?: boolean) => void;
  onRefetched: () => void;
  backHref?: string;
  backLabel?: string;
}) {
  const selectedReference = detail.references.find((reference) => reference.relativePath === selectedItem) ?? null;
  const initialContentParts = useMemo(() => splitMarkdownFrontmatter(detail.content), [detail.content]);
  const initialDefinitionBody = useMemo(() => normalizeMarkdownValue(initialContentParts.body), [initialContentParts.body]);
  const [savedContent, setSavedContent] = useState(initialDefinitionBody);
  const [draft, setDraft] = useState(initialDefinitionBody);
  const [selectedFrontmatter, setSelectedFrontmatter] = useState<string | null>(initialContentParts.frontmatter);
  const [contentLoading, setContentLoading] = useState(false);
  const [loadedPath, setLoadedPath] = useState(selectedReference ? '' : detail.skill.path);
  const [contentError, setContentError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [notice, setNotice] = useState<{ tone: 'accent' | 'danger' | 'warning'; text: string } | null>(null);
  const lastAutoSaveSignatureRef = useRef<string | null>(null);
  const selectedPath = selectedReference?.path ?? detail.skill.path;
  const isDocumentReady = loadedPath === selectedPath && !contentLoading;
  const dirty = draft !== savedContent;
  const documentLabel = selectedReference?.title ?? null;
  const documentKindLabel = selectedReference ? 'Reference' : 'Definition';
  const documentMeta = selectedReference?.relativePath ?? 'Main skill file';
  const documentSummary = selectedReference?.summary || (selectedReference
    ? 'Supporting guidance for this skill.'
    : null);

  useEffect(() => {
    if (selectedView !== 'definition') {
      onNavigate({ view: null }, true);
    }
  }, [onNavigate, selectedView]);

  useEffect(() => {
    if (selectedItem && !selectedReference) {
      onNavigate({ item: null }, true);
    }
  }, [onNavigate, selectedItem, selectedReference]);

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedContent() {
      if (!selectedReference) {
        const parts = splitMarkdownFrontmatter(detail.content);
        const normalizedBody = normalizeMarkdownValue(parts.body);
        if (cancelled) {
          return;
        }
        setSavedContent(normalizedBody);
        setDraft(normalizedBody);
        setSelectedFrontmatter(parts.frontmatter);
        setContentError(null);
        setContentLoading(false);
        setLoadedPath(detail.skill.path);
        setSaveState('idle');
        setNotice(null);
        lastAutoSaveSignatureRef.current = null;
        return;
      }

      setContentLoading(true);
      setContentError(null);
      try {
        const result = await api.memoryFile(selectedReference.path);
        if (cancelled) {
          return;
        }
        const parts = splitMarkdownFrontmatter(result.content);
        const normalizedBody = normalizeMarkdownValue(parts.body);
        setSavedContent(normalizedBody);
        setDraft(normalizedBody);
        setSelectedFrontmatter(parts.frontmatter);
        setLoadedPath(selectedReference.path);
        setSaveState('idle');
        setNotice(null);
        lastAutoSaveSignatureRef.current = null;
      } catch (error) {
        if (cancelled) {
          return;
        }
        setContentError(error instanceof Error ? error.message : String(error));
        setSelectedFrontmatter(null);
        setSavedContent('');
        setDraft('');
        setLoadedPath(selectedReference.path);
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
  }, [detail.content, detail.skill.path, selectedReference]);

  const saveDocument = useCallback(async (path: string, frontmatter: string | null, body: string) => {
    await api.memoryFileSave(path, joinMarkdownFrontmatter(frontmatter, body));
  }, []);

  const handleSave = useCallback(async (options: { automated?: boolean } = {}) => {
    if (saveBusy || !dirty || !isDocumentReady || contentLoading || contentError) {
      return false;
    }

    const path = selectedReference?.path ?? detail.skill.path;
    const frontmatter = selectedFrontmatter;
    const draftToSave = draft;

    setSaveBusy(true);
    setSaveState('idle');
    if (!options.automated) {
      setNotice(null);
    }

    try {
      await saveDocument(path, frontmatter, draftToSave);
      setSavedContent(draftToSave);
      setSaveState('saved');
      setNotice(null);
      return true;
    } catch (error) {
      setSaveState('error');
      setNotice({ tone: 'danger', text: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      setSaveBusy(false);
    }
  }, [contentError, contentLoading, detail.skill.path, dirty, draft, isDocumentReady, saveBusy, saveDocument, selectedFrontmatter, selectedReference]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const autoSaveSignature = `${selectedPath}\u0000${draft}`;
    if (!dirty || saveBusy || !isDocumentReady || contentError || lastAutoSaveSignatureRef.current === autoSaveSignature) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      lastAutoSaveSignatureRef.current = autoSaveSignature;
      void handleSave({ automated: true });
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [contentError, dirty, draft, handleSave, isDocumentReady, saveBusy, selectedPath]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  async function handleReload() {
    if (contentLoading) {
      return;
    }

    setNotice(null);
    setSaveState('idle');
    lastAutoSaveSignatureRef.current = null;

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
        setLoadedPath(selectedReference.path);
      } catch (error) {
        setContentError(error instanceof Error ? error.message : String(error));
      } finally {
        setContentLoading(false);
      }
      return;
    }

    onRefetched();
  }

  const saveStatus = !isDocumentReady
    ? { text: 'Loading…', className: 'text-dim' }
    : saveBusy
      ? { text: 'Saving…', className: 'text-accent' }
      : dirty
        ? { text: 'Unsaved changes', className: 'text-warning' }
        : saveState === 'error'
          ? { text: 'Autosave failed', className: 'text-danger' }
          : saveState === 'saved'
            ? { text: 'All changes saved', className: 'text-dim' }
            : { text: 'Autosave on', className: 'text-dim' };
  const hasRelationships = Boolean(
    (detail.links?.outgoing?.length ?? 0) > 0
      || (detail.links?.incoming?.length ?? 0) > 0
      || (detail.links?.unresolved?.length ?? 0) > 0,
  );

  return (
    <NodeWorkspaceShell
      eyebrow="Skills"
      breadcrumbs={(
        <>
          <span>Skills</span>
          <span className="opacity-40">›</span>
          <span className="font-mono text-secondary">{detail.skill.name}</span>
        </>
      )}
      backHref={backHref}
      backLabel={backLabel}
      title={humanizeSkillName(detail.skill.name)}
      summary={detail.skill.description}
      meta={(
        <>
          <span>{detail.skill.source}</span>
          <span className="opacity-40">·</span>
          <span>{formatUsageLabel(detail.skill.recentSessionCount, detail.skill.lastUsedAt, detail.skill.usedInLastSession, 'Not used recently')}</span>
          {selectedReference && (
            <>
              <span className="opacity-40">·</span>
              <span>Editing {selectedReference.relativePath}</span>
            </>
          )}
        </>
      )}
      status={<span className={saveStatus.className}>{saveStatus.text}</span>}
      actions={(
        <NodeToolbarGroup>
          <NodeIconActionButton
            onClick={() => { void handleReload(); }}
            disabled={contentLoading || saveBusy}
            title={contentLoading ? 'Loading skill' : 'Reload skill'}
            aria-label={contentLoading ? 'Loading skill' : 'Reload skill'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 11a8 8 0 1 0 2.3 5.7" />
              <path d="M20 4v7h-7" />
            </svg>
          </NodeIconActionButton>
        </NodeToolbarGroup>
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
          <NodeRailSection title="Files" meta={selectedReference ? 'References live here instead of separate pages.' : 'Use the inspector to open supporting references.'}>
            <SkillFileList
              detail={detail}
              selectedReference={selectedReference}
              saveBusy={saveBusy}
              dirty={dirty}
              onNavigate={onNavigate}
              onSaveCurrent={() => handleSave()}
            />
          </NodeRailSection>
          {hasRelationships ? (
            <NodeRailSection title="Relationships">
              <div className="space-y-4">
                <NodeLinkList title="Links to" items={detail.links?.outgoing} surface="main" emptyText="This skill does not reference other nodes yet." />
                <NodeLinkList title="Linked from" items={detail.links?.incoming} surface="main" emptyText="No other nodes link to this skill yet." />
                <UnresolvedNodeLinks ids={detail.links?.unresolved} />
              </div>
            </NodeRailSection>
          ) : null}
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
      ) : !isDocumentReady ? (
        <LoadingState label="Loading skill…" className="h-full justify-center" />
      ) : (
        <div className="space-y-3 px-6 py-2">
          {selectedReference ? (
            <div className="space-y-1 border-b border-border-subtle pb-4">
              {documentLabel ? <p className="text-[16px] font-medium text-primary">{documentLabel}</p> : null}
              <p className="text-[10px] uppercase tracking-[0.14em] text-dim">{documentKindLabel}</p>
              <p className="break-all text-[12px] text-secondary">{documentMeta}</p>
              {documentSummary ? <p className="max-w-3xl text-[13px] leading-relaxed text-secondary">{documentSummary}</p> : null}
            </div>
          ) : null}
          <RichMarkdownEditor
            value={draft}
            onChange={setDraft}
            placeholder="Start writing…"
          />
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
            const skillHref = `/skills${buildSkillsSearch(locationSearch, { skillName: skill.name, view: null, item: null })}`;

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

    setSelectedSkill({ skillName: null, view: null, item: null }, true);
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
