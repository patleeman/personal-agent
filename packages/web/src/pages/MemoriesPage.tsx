import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { emitMemoriesChanged, MEMORIES_CHANGED_EVENT } from '../memoryDocEvents';
import { timeAgo } from '../utils';
import type { MemoryDocDetail, MemoryDocItem, MemoryWorkItem } from '../types';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PageHeading,
  ToolbarButton,
} from '../components/ui';
import { NoteEditorDocument } from '../components/NoteEditorDocument';
import {
  NodePrimaryToolbar,
  NodeWorkspaceShell,
  WorkspaceActionNotice,
} from '../components/NodeWorkspace';
import {
  buildNoteSearch,
  filterMemories,
  NOTE_ID_SEARCH_PARAM,
  noteKindLabel,
  readCreateState,
  readNoteTagFilters,
  toggleNoteTagFilter,
} from '../noteWorkspaceState';
import { inferInlineTags, readEditableNoteBody } from '../noteDocument';
import { normalizeMarkdownValue } from '../markdownDocument';
import { ensureOpenResourceShelfItem } from '../openResourceShelves';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

function memoryWorkItemDotClass(item: MemoryWorkItem): string {
  switch (item.status) {
    case 'failed':
    case 'interrupted':
      return 'bg-danger';
    case 'queued':
    case 'waiting':
      return 'bg-warning';
    default:
      return 'bg-accent';
  }
}

function memoryWorkItemLabel(item: MemoryWorkItem): string {
  switch (item.status) {
    case 'failed':
      return 'Node distillation failed';
    case 'interrupted':
      return 'Node distillation interrupted';
    case 'queued':
      return 'Queued for node distillation';
    case 'waiting':
      return 'Waiting to resume node distillation';
    case 'recovering':
      return 'Recovering node distillation';
    default:
      return 'Distilling into a note node';
  }
}

function memoryWorkItemHref(item: MemoryWorkItem): string {
  const base = `/conversations/${encodeURIComponent(item.conversationId)}`;
  return item.runId.startsWith('state:')
    ? base
    : `${base}?run=${encodeURIComponent(item.runId)}`;
}

function canRetryMemoryWorkItem(item: MemoryWorkItem): boolean {
  return !item.runId.startsWith('state:')
    && (item.status === 'failed' || item.status === 'interrupted');
}

function NoteWorkQueuePanel({
  items,
  loading,
  error,
  refreshing,
  onRefresh,
}: {
  items: MemoryWorkItem[];
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const recoverableItems = useMemo(
    () => items.filter((item) => canRetryMemoryWorkItem(item)),
    [items],
  );
  const [pendingQueueAction, setPendingQueueAction] = useState<{ runId: string; kind: 'retry' } | null>(null);
  const [startingBatchRecovery, setStartingBatchRecovery] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const queueBusy = Boolean(pendingQueueAction) || startingBatchRecovery;

  const retryMemoryWorkItem = useCallback(async (item: MemoryWorkItem) => {
    if (!canRetryMemoryWorkItem(item) || queueBusy) {
      return;
    }

    setQueueError(null);
    setQueueNotice(null);
    setPendingQueueAction({ runId: item.runId, kind: 'retry' });
    try {
      const result = await api.retryNodeDistillRun(item.runId);
      navigate(`/conversations/${encodeURIComponent(result.conversationId)}?run=${encodeURIComponent(result.runId)}`);
    } catch (retryError) {
      setQueueError(retryError instanceof Error ? retryError.message : 'Could not retry node distillation.');
      setPendingQueueAction(null);
      onRefresh();
    }
  }, [navigate, onRefresh, queueBusy]);

  const recoverFailedMemoryWorkItems = useCallback(async () => {
    if (recoverableItems.length === 0 || queueBusy) {
      return;
    }

    setQueueError(null);
    setQueueNotice(null);
    setStartingBatchRecovery(true);
    try {
      const result = await api.recoverFailedNodeDistills();
      setQueueNotice(`Started recovery run ${result.runId} for ${result.count} failed ${result.count === 1 ? 'extraction' : 'extractions'}.`);
      onRefresh();
    } catch (recoverError) {
      setQueueError(recoverError instanceof Error ? recoverError.message : 'Could not start failed note-extraction recovery.');
    } finally {
      setStartingBatchRecovery(false);
    }
  }, [onRefresh, queueBusy, recoverableItems.length]);

  if (loading && items.length === 0) {
    return <LoadingState label="Loading work queue…" className="min-h-[10rem]" />;
  }

  if (error) {
    return <ErrorState message={`Unable to load note work queue: ${error}`} />;
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface/10 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[13px] font-medium text-primary">Work queue</p>
          <p className="text-[12px] text-secondary">Background note distillation runs.</p>
        </div>
        <div className="flex items-center gap-2">
          {recoverableItems.length > 0 && (
            <ToolbarButton
              onClick={() => { void recoverFailedMemoryWorkItems(); }}
              disabled={queueBusy}
              title="Start one background recovery run for every failed or interrupted note extraction"
            >
              {startingBatchRecovery ? 'Starting…' : 'Recover'}
            </ToolbarButton>
          )}
          <ToolbarButton onClick={onRefresh} disabled={queueBusy || refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </ToolbarButton>
        </div>
      </div>

      {queueNotice && <p className="mt-3 text-[12px] text-secondary">{queueNotice}</p>}
      {queueError && <p className="mt-3 text-[12px] text-danger">{queueError}</p>}

      <div className="mt-4 overflow-hidden rounded-xl border border-border-subtle">
        <div className="divide-y divide-border-subtle bg-base/40">
          {items.map((item) => {
            const activeAction = pendingQueueAction?.runId === item.runId ? pendingQueueAction.kind : null;
            const retryable = canRetryMemoryWorkItem(item);
            const summary = activeAction === 'retry'
              ? 'Queueing node distillation…'
              : item.lastError || memoryWorkItemLabel(item);
            const status = activeAction === 'retry' ? 'queueing' : item.status;

            return (
              <div key={item.runId} className="flex items-start gap-3 px-4 py-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${memoryWorkItemDotClass(item)}`} />
                <Link to={memoryWorkItemHref(item)} className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-primary">{item.conversationTitle}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-secondary">{summary}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
                    <span>{status}</span>
                    <span className="opacity-40">·</span>
                    <span className="font-mono" title={item.runId}>{item.runId}</span>
                    <span className="opacity-40">·</span>
                    <span>{timeAgo(item.updatedAt)}</span>
                  </div>
                </Link>
                {retryable && (
                  <ToolbarButton
                    className="shrink-0 self-center"
                    onClick={() => { void retryMemoryWorkItem(item); }}
                    disabled={queueBusy}
                    title="Retry this node distillation"
                  >
                    {activeAction === 'retry' ? 'Retrying…' : 'Retry'}
                  </ToolbarButton>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatNoteContext(memory: MemoryDocItem): { primary: string; secondary: string | null } {
  const primary = memory.area?.trim()
    || memory.status?.trim()
    || '—';
  const secondary = memory.parent?.trim()
    ? `parent @${memory.parent.trim()}`
    : memory.role?.trim() || null;
  return {
    primary,
    secondary,
  };
}

function buildSingleTagNotesHref(locationSearch: string, tag: string): string {
  return `/notes${buildNoteSearch(locationSearch, {
    memoryId: null,
    creating: false,
    tags: [tag],
  })}`;
}

function buildToggledTagNotesHref(locationSearch: string, tag: string): string {
  return `/notes${buildNoteSearch(locationSearch, {
    memoryId: null,
    creating: false,
    tags: toggleNoteTagFilter(readNoteTagFilters(locationSearch), tag),
  })}`;
}

function NotesTable({
  memories,
  locationSearch,
}: {
  memories: MemoryDocItem[];
  locationSearch: string;
}) {
  const navigate = useNavigate();
  const activeTags = useMemo(() => new Set(readNoteTagFilters(locationSearch)), [locationSearch]);

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border-subtle bg-surface/10">
      <table className="min-w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-base/95 backdrop-blur">
          <tr className="border-b border-border-subtle text-[10px] uppercase tracking-[0.14em] text-dim">
            <th className="px-4 py-2.5 font-medium">Note</th>
            <th className="px-3 py-2.5 font-medium">Kind</th>
            <th className="px-3 py-2.5 font-medium">Context</th>
            <th className="px-4 py-2.5 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {memories.map((memory) => {
            const noteHref = `/notes${buildNoteSearch(locationSearch, {
              memoryId: memory.id,
              creating: false,
            })}`;
            const context = formatNoteContext(memory);

            return (
              <tr
                key={memory.id}
                className="cursor-pointer border-b border-border-subtle align-top transition-colors hover:bg-surface/35"
                tabIndex={0}
                onClick={() => navigate(noteHref)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(noteHref);
                  }
                }}
              >
                <td className="px-4 py-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={noteHref}
                        className="text-[14px] font-medium text-primary transition-colors hover:text-accent"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {memory.title}
                      </Link>
                      {memory.usedInLastSession ? <span className="text-[11px] text-accent">Used recently</span> : null}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {memory.tags.length > 0 ? memory.tags.map((tag) => {
                        const tagActive = activeTags.has(tag.trim().toLowerCase());
                        return (
                          <button
                            key={tag}
                            type="button"
                            className={`ui-note-tag-link ${tagActive ? 'border-accent/45 bg-accent/12 text-accent' : ''}`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              navigate(buildToggledTagNotesHref(locationSearch, tag));
                            }}
                          >
                            #{tag}
                          </button>
                        );
                      }) : <span className="text-[11px] text-dim">No tags</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
                      <span className="font-mono">@{memory.id}</span>
                      {memory.path ? (
                        <>
                          <span className="opacity-40">·</span>
                          <span className="truncate">{memory.path}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-[12px] text-secondary">{noteKindLabel(memory)}</td>
                <td className="px-3 py-3">
                  <div className="text-[12px] text-primary">{context.primary}</div>
                  <div className="mt-0.5 text-[11px] text-dim">{context.secondary || '—'}</div>
                </td>
                <td className="px-4 py-3 text-[12px] text-secondary">{memory.updated ? timeAgo(memory.updated) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NoteWorkspace({
  detail,
  locationSearch,
  onNavigate,
  onRefetched,
}: {
  detail: MemoryDocDetail;
  locationSearch: string;
  onNavigate: (updates: { memoryId?: string | null; creating?: boolean | null }, replace?: boolean) => void;
  onRefetched: () => void;
}) {
  const memory = detail.memory;
  const [savedNoteTitle, setSavedNoteTitle] = useState(memory.title);
  const [savedNoteBody, setSavedNoteBody] = useState(normalizeMarkdownValue(readEditableNoteBody(detail.content, memory.title)));
  const [noteTitle, setNoteTitle] = useState(memory.title);
  const [noteBody, setNoteBody] = useState(normalizeMarkdownValue(readEditableNoteBody(detail.content, memory.title)));
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [notice, setNotice] = useState<{ tone: 'accent' | 'danger' | 'warning'; text: string } | null>(null);
  const lastAutoSaveSignatureRef = useRef<string | null>(null);
  const dirty = noteTitle !== savedNoteTitle || noteBody !== savedNoteBody;
  const inferredTags = useMemo(() => inferInlineTags(noteBody), [noteBody]);

  useEffect(() => {
    const editableBody = normalizeMarkdownValue(readEditableNoteBody(detail.content, detail.memory.title));
    setSavedNoteTitle(detail.memory.title);
    setSavedNoteBody(editableBody);
    setNoteTitle(detail.memory.title);
    setNoteBody(editableBody);
    setSaveState('idle');
    setNotice(null);
    lastAutoSaveSignatureRef.current = null;
  }, [detail.content, detail.memory.title]);

  const handleSave = useCallback(async (options: { automated?: boolean } = {}) => {
    if (saveBusy || !dirty) {
      return false;
    }

    const nextTitle = noteTitle.trim();
    if (nextTitle.length === 0) {
      if (!options.automated) {
        setNotice({ tone: 'warning', text: 'Add a title before saving.' });
      }
      return false;
    }

    setSaveBusy(true);
    setSaveState('idle');
    if (!options.automated) {
      setNotice(null);
    }

    try {
      const result = await api.saveNoteDoc(memory.id, {
        title: nextTitle,
        body: noteBody,
      });
      const editableBody = normalizeMarkdownValue(readEditableNoteBody(result.content, result.memory.title));
      setSavedNoteTitle(result.memory.title);
      setSavedNoteBody(editableBody);
      setNoteTitle(result.memory.title);
      setNoteBody(editableBody);
      setSaveState('saved');
      setNotice(options.automated ? null : { tone: 'accent', text: `Saved @${result.memory.id}.` });
      if (result.memory.id !== memory.id) {
        onNavigate({ memoryId: result.memory.id, creating: false }, true);
      }
      emitMemoriesChanged();
      onRefetched();
      return true;
    } catch (error) {
      setSaveState('error');
      setNotice({ tone: 'danger', text: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      setSaveBusy(false);
    }
  }, [dirty, memory.id, noteBody, noteTitle, onNavigate, onRefetched, saveBusy]);

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
    const nextTitle = noteTitle.trim();
    const autoSaveSignature = `${nextTitle}\u0000${noteBody}`;
    if (!dirty || saveBusy || deleteBusy || startBusy || nextTitle.length === 0 || lastAutoSaveSignatureRef.current === autoSaveSignature) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      lastAutoSaveSignatureRef.current = autoSaveSignature;
      void handleSave({ automated: true });
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [deleteBusy, dirty, handleSave, noteBody, noteTitle, saveBusy, startBusy]);

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

  function handleReload() {
    setNotice(null);
    setSaveState('idle');
    lastAutoSaveSignatureRef.current = null;
    onRefetched();
  }

  async function handleDelete() {
    if (deleteBusy) {
      return;
    }

    if (!window.confirm(`Delete note node @${memory.id}?`)) {
      return;
    }

    setDeleteBusy(true);
    setNotice(null);
    try {
      await api.deleteNoteDoc(memory.id);
      emitMemoriesChanged();
      onNavigate({ memoryId: null, creating: false }, true);
    } catch (error) {
      setNotice({ tone: 'danger', text: error instanceof Error ? error.message : String(error) });
      setDeleteBusy(false);
    }
  }

  async function handleStartConversation() {
    if (startBusy) {
      return;
    }

    setStartBusy(true);
    setNotice(null);
    try {
      const result = await api.startNoteConversation(memory.id);
      onNavigate({ creating: false });
      window.location.assign(`/conversations/${encodeURIComponent(result.id)}`);
    } catch (error) {
      setNotice({ tone: 'danger', text: error instanceof Error ? error.message : String(error) });
      setStartBusy(false);
    }
  }

  return (
    <NodeWorkspaceShell
      title={`@${memory.id}`}
      compactTitle
      meta={(
        <>
          <span>{noteKindLabel(memory)}</span>
          {(saveBusy || dirty || saveState === 'saved' || saveState === 'error') ? (
            <>
              <span className="opacity-40">·</span>
              {saveBusy ? (
                <span className="text-accent">Saving…</span>
              ) : dirty ? (
                <span className="text-warning">{noteTitle.trim().length === 0 ? 'Title required to save' : 'Unsaved changes'}</span>
              ) : saveState === 'error' ? (
                <span className="text-danger">Autosave failed</span>
              ) : (
                <span className="text-dim">All changes saved</span>
              )}
            </>
          ) : null}
        </>
      )}
      actions={(
        <NodePrimaryToolbar>
          <ToolbarButton onClick={handleReload} disabled={saveBusy}>
            Reload
          </ToolbarButton>
          <ToolbarButton onClick={() => { void handleSave(); }} disabled={!dirty || saveBusy || noteTitle.trim().length === 0}>
            {saveBusy ? 'Saving…' : 'Save now'}
          </ToolbarButton>
          <ToolbarButton onClick={() => { void handleStartConversation(); }} disabled={startBusy} className="text-accent">
            {startBusy ? 'Starting…' : 'Chat about note'}
          </ToolbarButton>
          <ToolbarButton onClick={() => { void handleDelete(); }} disabled={deleteBusy} className="text-danger">
            {deleteBusy ? 'Deleting…' : 'Delete note'}
          </ToolbarButton>
        </NodePrimaryToolbar>
      )}
      notice={notice ? <WorkspaceActionNotice tone={notice.tone}>{notice.text}</WorkspaceActionNotice> : null}
    >
      <NoteEditorDocument
        title={noteTitle}
        onTitleChange={setNoteTitle}
        body={noteBody}
        onBodyChange={setNoteBody}
        path={memory.path}
        inferredTags={inferredTags}
        buildTagHref={(tag) => buildSingleTagNotesHref(locationSearch, tag)}
        meta={(
          <>
            <span className="font-mono">@{memory.id}</span>
            {memory.updated && <span>updated {timeAgo(memory.updated)}</span>}
            <span>{memory.path}</span>
          </>
        )}
      />
    </NodeWorkspaceShell>
  );
}

function NewNoteWorkspace({
  locationSearch,
  onNavigate,
  onCreated,
}: {
  locationSearch: string;
  onNavigate: (updates: { memoryId?: string | null; creating?: boolean | null }, replace?: boolean) => void;
  onCreated: (detail: MemoryDocDetail) => void;
}) {
  const [createTitle, setCreateTitle] = useState('');
  const [createBody, setCreateBody] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const lastAutoCreateSignatureRef = useRef<string | null>(null);
  const inferredTags = useMemo(() => inferInlineTags(createBody), [createBody]);
  const hasDraftContent = createTitle.trim().length > 0 || createBody.trim().length > 0;

  const handleCreateNote = useCallback(async () => {
    if (creating || createTitle.trim().length === 0) {
      return false;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const created = await api.createNoteDoc({
        title: createTitle.trim(),
        body: createBody,
      });
      emitMemoriesChanged();
      onCreated(created);
      onNavigate({ memoryId: created.memory.id, creating: false }, true);
      return true;
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setCreating(false);
    }
  }, [createBody, createTitle, creating, onCreated, onNavigate]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDraftContent) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasDraftContent]);

  useEffect(() => {
    const nextTitle = createTitle.trim();
    const autoCreateSignature = `${nextTitle}\u0000${createBody}`;
    if (creating || nextTitle.length === 0 || lastAutoCreateSignatureRef.current === autoCreateSignature) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      lastAutoCreateSignatureRef.current = autoCreateSignature;
      void handleCreateNote();
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [createBody, createTitle, creating, handleCreateNote]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleCreateNote();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCreateNote]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <ToolbarButton onClick={() => { void handleCreateNote(); }} disabled={creating || createTitle.trim().length === 0} className="text-accent">
          {creating ? 'Creating…' : 'Create now'}
        </ToolbarButton>
      </div>
      {createError ? <WorkspaceActionNotice tone="danger">{createError}</WorkspaceActionNotice> : null}
      <NoteEditorDocument
        title={createTitle}
        onTitleChange={setCreateTitle}
        body={createBody}
        onBodyChange={setCreateBody}
        path="untitled.md"
        inferredTags={inferredTags}
        buildTagHref={(tag) => buildSingleTagNotesHref(locationSearch, tag)}
        meta={(
          <>
            <span>Draft note</span>
            <span>{createTitle.trim().length === 0 ? 'Autosaves once it has a title' : 'Autosaves automatically'}</span>
          </>
        )}
        titlePlaceholder="Untitled note"
      />
    </div>
  );
}

export function MemoriesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    data,
    loading,
    refreshing,
    error,
    refetch,
    replaceData,
  } = useApi(api.notes);
  const queueState = useApi(api.noteWorkQueue);

  const memories = data?.memories ?? [];
  const memoryQueue = queueState.data?.memoryQueue ?? data?.memoryQueue ?? [];
  const [query, setQuery] = useState('');
  const activeTagFilters = useMemo(() => readNoteTagFilters(location.search), [location.search]);
  const filteredMemories = useMemo(() => filterMemories(memories, query, activeTagFilters), [activeTagFilters, memories, query]);
  const selectedMemoryId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get(NOTE_ID_SEARCH_PARAM)?.trim() || params.get('memory')?.trim() || null;
  }, [location.search]);
  const creating = useMemo(() => readCreateState(location.search), [location.search]);
  const detailFetcher = useCallback(() => {
    if (!selectedMemoryId) {
      return Promise.resolve(null);
    }
    return api.noteDoc(selectedMemoryId);
  }, [selectedMemoryId]);
  const detailApi = useApi(detailFetcher, `note-workspace:${selectedMemoryId ?? 'none'}`);
  const selectedDetail = detailApi.data;

  const navigateNotes = useCallback((updates: { memoryId?: string | null; creating?: boolean | null; tags?: string[] | null }, replace = false) => {
    const nextSearch = buildNoteSearch(location.search, updates);
    navigate(`/notes${nextSearch}`, { replace });
  }, [location.search, navigate]);

  useEffect(() => {
    function handleMemoriesChanged() {
      void refetch({ resetLoading: false });
      if (selectedMemoryId) {
        void detailApi.refetch({ resetLoading: false });
      }
      void queueState.refetch({ resetLoading: false });
    }

    window.addEventListener(MEMORIES_CHANGED_EVENT, handleMemoriesChanged);
    return () => window.removeEventListener(MEMORIES_CHANGED_EVENT, handleMemoriesChanged);
  }, [detailApi, queueState, refetch, selectedMemoryId]);

  useEffect(() => {
    if (loading || !selectedMemoryId) {
      return;
    }

    if (memories.some((memory) => memory.id === selectedMemoryId)) {
      return;
    }

    navigateNotes({ memoryId: null, creating: false }, true);
  }, [loading, memories, navigateNotes, selectedMemoryId]);

  useEffect(() => {
    if (!selectedMemoryId) {
      return;
    }

    ensureOpenResourceShelfItem('note', selectedMemoryId);
  }, [selectedMemoryId]);

  if (creating) {
    return (
      <div className="min-h-0 flex h-full flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
            <PageHeader
              actions={<ToolbarButton onClick={() => navigateNotes({ creating: false })}>Back to notes</ToolbarButton>}
            >
              <PageHeading
                title="Notes"
                meta="Create a durable note with markdown content and inline @links."
              />
            </PageHeader>
            <NewNoteWorkspace
              locationSearch={location.search}
              onNavigate={navigateNotes}
              onCreated={(created) => {
                replaceData({
                  memories: [created.memory, ...memories.filter((memory) => memory.id !== created.memory.id)],
                  memoryQueue,
                });
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (selectedMemoryId) {
    return (
      <div className="min-h-0 flex h-full flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {detailApi.loading && !selectedDetail ? (
            <LoadingState label="Loading note…" className="h-full justify-center" />
          ) : detailApi.error || !selectedDetail ? (
            <ErrorState message={`Unable to load note: ${detailApi.error ?? 'Note not found.'}`} />
          ) : (
            <div className="mx-auto w-full max-w-[1440px]">
              <NoteWorkspace
                detail={selectedDetail}
                locationSearch={location.search}
                onNavigate={navigateNotes}
                onRefetched={() => {
                  void detailApi.refetch({ resetLoading: false });
                  void refetch({ resetLoading: false });
                  void queueState.refetch({ resetLoading: false });
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
              <>
                <ToolbarButton onClick={() => navigateNotes({ creating: true })}>New note</ToolbarButton>
                <ToolbarButton onClick={() => {
                  void Promise.allSettled([
                    refetch({ resetLoading: false }),
                    queueState.refetch({ resetLoading: false }),
                  ]);
                }} disabled={refreshing || queueState.refreshing}>
                  {refreshing || queueState.refreshing ? 'Refreshing…' : 'Refresh'}
                </ToolbarButton>
              </>
            )}
          >
            <PageHeading
              title="Notes"
              meta="Browse durable notes, then open one into the main workspace and the left sidebar shelf."
            />
          </PageHeader>

          <NoteWorkQueuePanel
            items={memoryQueue}
            loading={queueState.loading && !queueState.data}
            error={queueState.error}
            refreshing={queueState.refreshing}
            onRefresh={() => { void queueState.refetch({ resetLoading: false }); }}
          />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[12px] text-secondary">
              {query.trim() || activeTagFilters.length > 0 ? `Showing ${filteredMemories.length} of ${memories.length} notes.` : `${memories.length} notes.`}
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search notes"
              aria-label="Search notes"
              className={`${INPUT_CLASS} sm:w-[22rem]`}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {activeTagFilters.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="ui-section-label">Filtered by</span>
              {activeTagFilters.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="ui-note-tag-link border-accent/45 bg-accent/12 text-accent"
                  onClick={() => navigateNotes({ memoryId: null, creating: false, tags: activeTagFilters.filter((value) => value !== tag) })}
                >
                  #{tag} ×
                </button>
              ))}
              <ToolbarButton onClick={() => navigateNotes({ memoryId: null, creating: false, tags: [] })}>
                Clear tags
              </ToolbarButton>
            </div>
          ) : null}

          {loading && !data ? <LoadingState label="Loading notes…" className="min-h-[18rem]" /> : null}
          {error && !data ? <ErrorState message={`Unable to load notes: ${error}`} /> : null}

          {!loading && !error && memories.length === 0 ? (
            <EmptyState
              className="min-h-[18rem]"
              title="No notes yet"
              body="Create a note to start building durable context."
              action={<ToolbarButton onClick={() => navigateNotes({ creating: true })}>Create note</ToolbarButton>}
            />
          ) : null}

          {!loading && !error && filteredMemories.length === 0 && memories.length > 0 ? (
            <EmptyState
              className="min-h-[18rem]"
              title="No matching notes"
              body="Try a broader search across titles, ids, and tags."
            />
          ) : null}

          {!loading && !error && filteredMemories.length > 0 ? (
            <NotesTable memories={filteredMemories} locationSearch={location.search} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
