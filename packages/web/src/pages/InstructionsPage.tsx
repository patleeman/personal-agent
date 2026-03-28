import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { NodePrimaryToolbar, WorkspaceActionNotice } from '../components/NodeWorkspace';
import { SettingsSplitLayout } from '../components/SettingsLayout';
import {
  EmptyState,
  ErrorState,
  ListLinkRow,
  LoadingState,
  PageHeader,
  PageHeading,
  ToolbarButton,
} from '../components/ui';
import { useApi } from '../hooks';
import { getKnowledgeInstructionPath } from '../knowledgeSelection';
import { useTheme } from '../theme';
import type { MemoryAgentsItem } from '../types';
import { editorChromeTheme, languageExtensionForPath } from '../workspaceBrowser';

const INSTRUCTION_SEARCH_PARAM = 'instruction';
const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

type NoticeState = {
  tone: 'accent' | 'danger' | 'warning';
  text: string;
};

function matchesInstruction(item: MemoryAgentsItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
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

function sortInstructions(items: MemoryAgentsItem[]): MemoryAgentsItem[] {
  return [...items].sort((left, right) => left.source.localeCompare(right.source) || left.path.localeCompare(right.path));
}

function buildInstructionsSearch(locationSearch: string, instructionPath: string | null): string {
  const params = new URLSearchParams(locationSearch);

  if (instructionPath) {
    params.set(INSTRUCTION_SEARCH_PARAM, instructionPath);
  } else {
    params.delete(INSTRUCTION_SEARCH_PARAM);
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

function instructionTitle(item: MemoryAgentsItem): string {
  if (item.source === 'shared') {
    return 'Shared defaults';
  }

  if (item.source === 'local') {
    return 'Local overlay';
  }

  return `${item.source} profile`;
}

function instructionSavedLabel(item: MemoryAgentsItem): string {
  if (item.source === 'shared') {
    return 'Saved shared defaults.';
  }

  if (item.source === 'local') {
    return 'Saved local overlay.';
  }

  return `Saved ${item.source} instructions.`;
}

function instructionReloadedLabel(item: MemoryAgentsItem): string {
  if (item.source === 'shared') {
    return 'Reloaded shared defaults.';
  }

  if (item.source === 'local') {
    return 'Reloaded local overlay.';
  }

  return `Reloaded ${item.source} instructions.`;
}

function InstructionEditorSurface({
  path,
  value,
  onChange,
}: {
  path: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { theme } = useTheme();
  const editorExtensions = useMemo(() => {
    const extensions: Extension[] = [editorChromeTheme(theme === 'dark'), EditorView.lineWrapping];
    const languageExtension = languageExtensionForPath(path);
    if (languageExtension) {
      extensions.push(languageExtension);
    }
    return extensions;
  }, [path, theme]);

  if (typeof window === 'undefined') {
    return (
      <pre className="h-full overflow-auto bg-panel px-6 py-5 font-mono text-[12px] leading-6 text-secondary whitespace-pre-wrap break-words">
        {value}
      </pre>
    );
  }

  return (
    <div className="h-full bg-panel">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={editorExtensions}
        className="h-full"
      />
    </div>
  );
}

export function InstructionsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data, loading, refreshing, error, refetch } = useApi(api.memory);
  const [query, setQuery] = useState('');
  const [draftPath, setDraftPath] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState('');
  const [draft, setDraft] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [reloadBusy, setReloadBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const instructions = useMemo(
    () => sortInstructions((data?.agentsMd ?? []).filter((item) => item.exists)),
    [data?.agentsMd],
  );
  const filteredInstructions = useMemo(
    () => instructions.filter((item) => matchesInstruction(item, query)),
    [instructions, query],
  );
  const selectedInstructionPath = useMemo(() => getKnowledgeInstructionPath(location.search), [location.search]);
  const selectedInstruction = useMemo(
    () => instructions.find((item) => item.path === selectedInstructionPath) ?? null,
    [instructions, selectedInstructionPath],
  );
  const dirty = Boolean(selectedInstruction) && draft !== savedContent;

  const setSelectedInstruction = useCallback((instructionPath: string | null, replace = false) => {
    const nextSearch = buildInstructionsSearch(location.search, instructionPath);
    navigate(`/instructions${nextSearch}`, { replace });
  }, [location.search, navigate]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (instructions.length === 0) {
      if (selectedInstructionPath) {
        setSelectedInstruction(null, true);
      }
      return;
    }

    if (!selectedInstructionPath) {
      setSelectedInstruction(instructions[0]?.path ?? null, true);
      return;
    }

    if (!instructions.some((item) => item.path === selectedInstructionPath)) {
      setSelectedInstruction(instructions[0]?.path ?? null, true);
    }
  }, [instructions, loading, selectedInstructionPath, setSelectedInstruction]);

  useEffect(() => {
    const nextPath = selectedInstruction?.path ?? null;
    const nextContent = selectedInstruction?.content ?? '';

    if (nextPath !== draftPath) {
      setDraftPath(nextPath);
      setSavedContent(nextContent);
      setDraft(nextContent);
      setNotice(null);
      return;
    }

    if (nextPath && draft === savedContent && nextContent !== savedContent) {
      setSavedContent(nextContent);
      setDraft(nextContent);
    }
  }, [draft, draftPath, savedContent, selectedInstruction?.content, selectedInstruction?.path]);

  const handleSave = useCallback(async () => {
    if (!selectedInstruction || saveBusy || !dirty) {
      return;
    }

    setSaveBusy(true);
    setNotice(null);

    try {
      await api.memoryFileSave(selectedInstruction.path, draft);
      setSavedContent(draft);
      setNotice({ tone: 'accent', text: instructionSavedLabel(selectedInstruction) });
      void refetch({ resetLoading: false });
    } catch (saveError) {
      setNotice({ tone: 'danger', text: saveError instanceof Error ? saveError.message : String(saveError) });
    } finally {
      setSaveBusy(false);
    }
  }, [dirty, draft, refetch, saveBusy, selectedInstruction]);

  const handleReload = useCallback(async () => {
    if (!selectedInstruction || reloadBusy || saveBusy) {
      return;
    }

    if (dirty && !window.confirm('Discard unsaved changes and reload this instruction file from disk?')) {
      return;
    }

    setReloadBusy(true);
    setNotice(null);

    try {
      const result = await api.memoryFile(selectedInstruction.path);
      setSavedContent(result.content);
      setDraft(result.content);
      setNotice({ tone: 'accent', text: instructionReloadedLabel(selectedInstruction) });
      void refetch({ resetLoading: false });
    } catch (reloadError) {
      setNotice({ tone: 'danger', text: reloadError instanceof Error ? reloadError.message : String(reloadError) });
    } finally {
      setReloadBusy(false);
    }
  }, [dirty, refetch, reloadBusy, saveBusy, selectedInstruction]);

  useEffect(() => {
    if (!selectedInstruction) {
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
  }, [handleSave, selectedInstruction]);

  function handleSelectInstruction(event: ReactMouseEvent<HTMLAnchorElement>, instructionPath: string) {
    if (instructionPath === selectedInstructionPath || !dirty) {
      return;
    }

    if (!window.confirm('Discard unsaved changes and switch instruction files?')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleDraftChange(value: string) {
    if (notice?.tone === 'accent') {
      setNotice(null);
    }
    setDraft(value);
  }

  return (
    <SettingsSplitLayout>
      <div className="flex h-full flex-col">
        <PageHeader
          className="flex-wrap items-start gap-y-3"
          actions={(
            <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing || saveBusy || reloadBusy}>
              {refreshing ? 'Refreshing…' : '↻ Refresh'}
            </ToolbarButton>
          )}
        >
          <PageHeading
            title="Instructions"
            meta={(
              <>
                {instructions.length} {instructions.length === 1 ? 'source' : 'sources'}
                {selectedInstruction && <span className="ml-2 text-secondary">· {selectedInstruction.source}</span>}
              </>
            )}
          />
        </PageHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          {loading && <LoadingState label="Loading instructions…" className="h-full justify-center" />}
          {error && <ErrorState message={`Unable to load instructions: ${error}`} className="px-6 py-4" />}

          {!loading && !error && instructions.length === 0 && (
            <div className="flex h-full items-center justify-center px-8 py-10">
              <EmptyState
                title="No instructions yet."
                body="Load a profile AGENTS.md into durable state to define role, policy, and behavioral boundaries."
              />
            </div>
          )}

          {!loading && !error && instructions.length > 0 && (
            <div className="grid h-full min-h-0 lg:grid-cols-[20rem_minmax(0,1fr)]">
              <section className="flex min-h-0 flex-col border-r border-border-subtle">
                <div className="shrink-0 space-y-2 border-b border-border-subtle px-5 py-4">
                  <p className="ui-card-meta">Inspect and edit the durable instruction sources loaded for the active profile.</p>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search instruction sources and content"
                    aria-label="Search instruction sources"
                    className={INPUT_CLASS}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="ui-card-meta">
                    {query.trim()
                      ? `Showing ${filteredInstructions.length} of ${instructions.length} instruction sources.`
                      : 'Search across source names, paths, and loaded content.'}
                  </p>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                  {filteredInstructions.length === 0 ? (
                    <EmptyState
                      title="No instruction sources match that search"
                      body="Try a broader search across source names, paths, and instruction content."
                    />
                  ) : (
                    <div className="space-y-px">
                      {filteredInstructions.map((item) => (
                        <ListLinkRow
                          key={item.path}
                          to={`/instructions${buildInstructionsSearch(location.search, item.path)}`}
                          selected={item.path === selectedInstructionPath}
                          onClick={(event) => handleSelectInstruction(event, item.path)}
                          leading={<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal" />}
                        >
                          <p className="ui-row-title">{instructionTitle(item)}</p>
                          <p className="ui-row-summary break-words">{item.path}</p>
                          <p className="ui-row-meta break-words">{item.content ? `${item.content.length.toLocaleString()} chars` : 'No content loaded'}</p>
                        </ListLinkRow>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="min-h-0 flex flex-col overflow-hidden">
                {!selectedInstruction ? (
                  <div className="flex h-full items-center justify-center px-8 py-10">
                    <EmptyState
                      title="Select an instruction source"
                      body="Choose an AGENTS file on the left to inspect and edit it."
                    />
                  </div>
                ) : (
                  <>
                    <div className="shrink-0 space-y-3 border-b border-border-subtle px-6 py-4">
                      <div className="space-y-1">
                        <h2 className="text-[15px] font-medium text-primary">{instructionTitle(selectedInstruction)}</h2>
                        <p className="ui-card-meta break-words">{selectedInstruction.path}</p>
                        <p className="ui-card-meta">
                          {dirty ? 'Unsaved changes · ' : ''}
                          Press ⌘/Ctrl+S to save.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3">
                        {notice ? (
                          <WorkspaceActionNotice tone={notice.tone}>{notice.text}</WorkspaceActionNotice>
                        ) : (
                          <span className="ui-card-meta">Editing the live source file shown above.</span>
                        )}

                        <NodePrimaryToolbar>
                          <ToolbarButton onClick={() => { void handleReload(); }} disabled={reloadBusy || saveBusy}>
                            {reloadBusy ? 'Reloading…' : 'Reload'}
                          </ToolbarButton>
                          <ToolbarButton onClick={() => { void handleSave(); }} disabled={!dirty || saveBusy || reloadBusy}>
                            {saveBusy ? 'Saving…' : 'Save'}
                          </ToolbarButton>
                        </NodePrimaryToolbar>
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-hidden">
                      <InstructionEditorSurface
                        path={selectedInstruction.path}
                        value={draft}
                        onChange={handleDraftChange}
                      />
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </SettingsSplitLayout>
  );
}
