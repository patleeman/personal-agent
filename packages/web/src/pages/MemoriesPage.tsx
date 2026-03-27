import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { emitMemoriesChanged, MEMORIES_CHANGED_EVENT } from '../memoryDocEvents';
import { timeAgo } from '../utils';
import type { MemoryDocDetail, MemoryDocItem, MemoryReferenceItem } from '../types';
import { BrowserSplitLayout } from '../components/BrowserSplitLayout';
import {
  EmptyState,
  ErrorState,
  ListLinkRow,
  LoadingState,
  ToolbarButton,
} from '../components/ui';
import { NoteEditorDocument } from '../components/NoteEditorDocument';
import { NotesBrowserRail } from '../components/NotesBrowserRail';
import {
  MarkdownDocumentSurface,
  NodePrimaryToolbar,
  NodeWorkspaceShell,
  WorkspaceActionNotice,
} from '../components/NodeWorkspace';
import { NodeLinkList, UnresolvedNodeLinks } from '../components/NodeLinksSection';
import {
  buildNoteSearch,
  NOTE_ID_SEARCH_PARAM,
  NOTE_ITEM_SEARCH_PARAM,
  type NoteWorkspaceView,
  noteKindLabel,
  readCreateState,
  readNoteView,
} from '../noteWorkspaceState';
import { buildRailWidthStorageKey } from '../layoutSizing';
import { inferInlineTags, readEditableNoteBody } from '../noteDocument';
import { ensureOpenResourceShelfItem } from '../openResourceShelves';

const NOTES_BROWSER_WIDTH_STORAGE_KEY = buildRailWidthStorageKey('notes-browser');

function ReferencesList({
  memory,
  references,
  locationSearch,
}: {
  memory: MemoryDocItem;
  references: MemoryReferenceItem[];
  locationSearch: string;
}) {
  if (references.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8 py-10">
        <EmptyState
          title="No reference files yet"
          body="Reference files can hold supporting details, research, or longer writeups attached to this note."
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-4xl space-y-px">
        {references.map((reference) => (
          <ListLinkRow
            key={reference.path}
            to={`/notes${buildNoteSearch(locationSearch, {
              memoryId: memory.id,
              view: 'references',
              item: reference.relativePath,
              creating: false,
            })}`}
            leading={<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal" />}
          >
            <p className="ui-row-title">{reference.title}</p>
            <p className="ui-row-summary">{reference.summary || 'Open this reference to read or edit it.'}</p>
            <div className="ui-row-meta flex flex-wrap items-center gap-1.5">
              <span>{reference.relativePath}</span>
              {reference.updated && (
                <>
                  <span className="opacity-40">·</span>
                  <span>updated {timeAgo(reference.updated)}</span>
                </>
              )}
            </div>
          </ListLinkRow>
        ))}
      </div>
    </div>
  );
}

function NoteLinksView({ detail }: { detail: MemoryDocDetail }) {
  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <NodeLinkList title="Links to" items={detail.links?.outgoing} surface="main" emptyText="This note does not reference other nodes yet." />
        <NodeLinkList title="Linked from" items={detail.links?.incoming} surface="main" emptyText="No other nodes link here yet." />
        <UnresolvedNodeLinks ids={detail.links?.unresolved} />
      </div>
    </div>
  );
}

function NoteWorkspace({
  detail,
  selectedView,
  selectedItem,
  locationSearch,
  onNavigate,
  onRefetched,
}: {
  detail: MemoryDocDetail;
  selectedView: NoteWorkspaceView;
  selectedItem: string | null;
  locationSearch: string;
  onNavigate: (updates: { memoryId?: string | null; view?: NoteWorkspaceView | null; item?: string | null; creating?: boolean | null }, replace?: boolean) => void;
  onRefetched: () => void;
}) {
  const memory = detail.memory;
  const references = detail.references;
  const selectedReference = references.find((reference) => reference.relativePath === selectedItem) ?? null;
  const editingMainNote = selectedView === 'main' && !selectedReference;
  const [savedNoteTitle, setSavedNoteTitle] = useState(memory.title);
  const [savedNoteSummary, setSavedNoteSummary] = useState(memory.summary);
  const [savedNoteBody, setSavedNoteBody] = useState(readEditableNoteBody(detail.content, memory.title));
  const [noteTitle, setNoteTitle] = useState(memory.title);
  const [noteSummary, setNoteSummary] = useState(memory.summary);
  const [noteBody, setNoteBody] = useState(readEditableNoteBody(detail.content, memory.title));
  const [savedContent, setSavedContent] = useState('');
  const [draft, setDraft] = useState('');
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'accent' | 'danger' | 'warning'; text: string } | null>(null);
  const selectedPath = selectedReference?.path ?? memory.path;
  const dirty = editingMainNote
    ? noteTitle !== savedNoteTitle || noteSummary !== savedNoteSummary || noteBody !== savedNoteBody
    : draft !== savedContent;
  const inferredTags = useMemo(() => inferInlineTags(`${noteSummary}\n${noteBody}`), [noteBody, noteSummary]);
  const resourceTabs = [
    {
      id: 'main',
      label: 'Main',
      to: `/notes${buildNoteSearch(locationSearch, { memoryId: memory.id, view: 'main', item: null, creating: false })}`,
      selected: selectedView === 'main',
    },
    {
      id: 'references',
      label: `References${references.length > 0 ? ` (${references.length})` : ''}`,
      to: `/notes${buildNoteSearch(locationSearch, { memoryId: memory.id, view: 'references', item: selectedReference?.relativePath ?? null, creating: false })}`,
      selected: selectedView === 'references',
    },
    {
      id: 'links',
      label: 'Links',
      to: `/notes${buildNoteSearch(locationSearch, { memoryId: memory.id, view: 'links', item: null, creating: false })}`,
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
        setContentError(null);
        setContentLoading(false);
        return;
      }

      if (editingMainNote) {
        const editableBody = readEditableNoteBody(detail.content, detail.memory.title);
        setSavedNoteTitle(detail.memory.title);
        setSavedNoteSummary(detail.memory.summary);
        setSavedNoteBody(editableBody);
        setNoteTitle(detail.memory.title);
        setNoteSummary(detail.memory.summary);
        setNoteBody(editableBody);
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
        setSavedContent(result.content);
        setDraft(result.content);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setContentError(error instanceof Error ? error.message : String(error));
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
  }, [detail.content, detail.memory.summary, detail.memory.title, editingMainNote, selectedReference, selectedView]);

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
      if (selectedReference) {
        await api.memoryFileSave(selectedReference.path, draft);
        setSavedContent(draft);
        setNotice({ tone: 'accent', text: `Saved ${selectedReference.relativePath}.` });
      } else {
        const nextTitle = noteTitle.trim();
        if (nextTitle.length === 0) {
          setNotice({ tone: 'warning', text: 'Add a title before saving.' });
          setSaveBusy(false);
          return;
        }

        const result = await api.saveNoteDoc(memory.id, {
          title: nextTitle,
          summary: noteSummary.trim() || undefined,
          body: noteBody,
        });
        const editableBody = readEditableNoteBody(result.content, result.memory.title);
        setSavedNoteTitle(result.memory.title);
        setSavedNoteSummary(result.memory.summary);
        setSavedNoteBody(editableBody);
        setNoteTitle(result.memory.title);
        setNoteSummary(result.memory.summary);
        setNoteBody(editableBody);
        setNotice({ tone: 'accent', text: `Saved @${result.memory.id}.` });
        if (result.memory.id !== memory.id) {
          onNavigate({ memoryId: result.memory.id, view: selectedView, item: null, creating: false }, true);
        }
      }
      emitMemoriesChanged();
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

    setNotice(null);
    if (selectedReference) {
      setContentLoading(true);
      try {
        const result = await api.memoryFile(selectedReference.path);
        setSavedContent(result.content);
        setDraft(result.content);
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

  async function handleDelete() {
    if (selectedReference || deleteBusy) {
      return;
    }

    if (!window.confirm(`Delete note node @${memory.id}? This removes the full node, including references and assets.`)) {
      return;
    }

    setDeleteBusy(true);
    setNotice(null);
    try {
      await api.deleteNoteDoc(memory.id);
      emitMemoriesChanged();
      onNavigate({ memoryId: null, view: 'main', item: null, creating: false }, true);
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
      title={selectedReference ? selectedReference.title : `@${memory.id}`}
      summary={selectedReference ? (selectedReference.summary || undefined) : undefined}
      compactTitle
      meta={(
        <>
          {selectedReference ? (
            <span>{selectedReference.relativePath}</span>
          ) : (
            <>
              <span>{noteKindLabel(memory)}</span>
              {memory.parent && (
                <>
                  <span className="opacity-40">·</span>
                  <Link to={`/notes${buildNoteSearch(locationSearch, { memoryId: memory.parent, view: 'main', item: null, creating: false })}`} className="text-accent hover:underline">@{memory.parent}</Link>
                </>
              )}
            </>
          )}
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
              <ToolbarButton
                onClick={() => { void handleSave(); }}
                disabled={
                  !dirty
                  || saveBusy
                  || contentLoading
                  || Boolean(contentError)
                  || (editingMainNote && noteTitle.trim().length === 0)
                }
              >
                {saveBusy ? 'Saving…' : 'Save'}
              </ToolbarButton>
            </>
          )}
          {editingMainNote && (
            <ToolbarButton onClick={() => { void handleStartConversation(); }} disabled={startBusy} className="text-accent">
              {startBusy ? 'Starting…' : 'Chat about note'}
            </ToolbarButton>
          )}
          {editingMainNote && (
            <ToolbarButton onClick={() => { void handleDelete(); }} disabled={deleteBusy} className="text-danger">
              {deleteBusy ? 'Deleting…' : 'Delete note'}
            </ToolbarButton>
          )}
        </NodePrimaryToolbar>
      )}
      notice={notice ? <WorkspaceActionNotice tone={notice.tone}>{notice.text}</WorkspaceActionNotice> : null}
    >
      {contentError ? (
        <div className="p-6"><ErrorState message={`Unable to load file: ${contentError}`} /></div>
      ) : contentLoading ? (
        <LoadingState label="Loading note…" className="h-full justify-center" />
      ) : selectedView === 'references' && !selectedReference ? (
        <ReferencesList memory={memory} references={references} locationSearch={locationSearch} />
      ) : selectedView === 'links' ? (
        <NoteLinksView detail={detail} />
      ) : selectedReference ? (
        <MarkdownDocumentSurface
          value={draft}
          onChange={setDraft}
          path={selectedPath}
          mode="edit"
          emptyPreviewText="This file has no rendered markdown yet."
        />
      ) : (
        <NoteEditorDocument
          title={noteTitle}
          onTitleChange={setNoteTitle}
          summary={noteSummary}
          onSummaryChange={setNoteSummary}
          body={noteBody}
          onBodyChange={setNoteBody}
          path={selectedPath}
          inferredTags={inferredTags}
          meta={(
            <>
              <span className="font-mono">@{memory.id}</span>
              {memory.updated && (
                <>
                  <span>updated {timeAgo(memory.updated)}</span>
                </>
              )}
              <span>{selectedPath}</span>
            </>
          )}
        />
      )}
    </NodeWorkspaceShell>
  );
}

function NewNoteWorkspace({
  onNavigate,
  onCreated,
}: {
  onNavigate: (updates: { memoryId?: string | null; view?: NoteWorkspaceView | null; item?: string | null; creating?: boolean | null }, replace?: boolean) => void;
  onCreated: (detail: MemoryDocDetail) => void;
}) {
  const [createTitle, setCreateTitle] = useState('');
  const [createSummary, setCreateSummary] = useState('');
  const [createBody, setCreateBody] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const inferredTags = useMemo(() => inferInlineTags(`${createSummary}\n${createBody}`), [createBody, createSummary]);

  async function handleCreateNote() {
    if (creating || createTitle.trim().length === 0) {
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const created = await api.createNoteDoc({
        title: createTitle.trim(),
        summary: createSummary.trim() || undefined,
        body: createBody,
      });
      emitMemoriesChanged();
      onCreated(created);
      onNavigate({ memoryId: created.memory.id, view: 'main', item: null, creating: false }, true);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
      setCreating(false);
      return;
    }

    setCreating(false);
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleCreateNote();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <NodeWorkspaceShell
      title="New note"
      compactTitle
      meta={<span>Draft</span>}
      actions={(
        <NodePrimaryToolbar>
          <ToolbarButton onClick={() => { void handleCreateNote(); }} disabled={creating || createTitle.trim().length === 0} className="text-accent">
            {creating ? 'Creating…' : 'Create note'}
          </ToolbarButton>
          <ToolbarButton onClick={() => onNavigate({ creating: false })}>Cancel</ToolbarButton>
        </NodePrimaryToolbar>
      )}
      notice={createError ? <WorkspaceActionNotice tone="danger">{createError}</WorkspaceActionNotice> : null}
    >
      <NoteEditorDocument
        title={createTitle}
        onTitleChange={setCreateTitle}
        summary={createSummary}
        onSummaryChange={setCreateSummary}
        body={createBody}
        onBodyChange={setCreateBody}
        path="untitled.md"
        inferredTags={inferredTags}
        meta={<span>Draft note</span>}
        titlePlaceholder="Untitled note"
      />
    </NodeWorkspaceShell>
  );
}

export function MemoriesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    data,
    loading,
    error,
    refetch,
    replaceData,
  } = useApi(api.notes);

  const memories = data?.memories ?? [];
  const memoryQueue = data?.memoryQueue ?? [];
  const selectedMemoryId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get(NOTE_ID_SEARCH_PARAM)?.trim() || params.get('memory')?.trim() || null;
  }, [location.search]);
  const selectedView = useMemo(() => readNoteView(location.search), [location.search]);
  const selectedItem = useMemo(() => new URLSearchParams(location.search).get(NOTE_ITEM_SEARCH_PARAM)?.trim() || null, [location.search]);
  const creating = useMemo(() => readCreateState(location.search), [location.search]);
  const detailFetcher = useCallback(() => {
    if (!selectedMemoryId) {
      return Promise.resolve(null);
    }
    return api.noteDoc(selectedMemoryId);
  }, [selectedMemoryId]);
  const detailApi = useApi(detailFetcher, `note-workspace:${selectedMemoryId ?? 'none'}`);
  const selectedDetail = detailApi.data;

  const navigateNotes = useCallback((updates: { memoryId?: string | null; view?: NoteWorkspaceView | null; item?: string | null; creating?: boolean | null }, replace = false) => {
    const nextSearch = buildNoteSearch(location.search, updates);
    navigate(`/notes${nextSearch}`, { replace });
  }, [location.search, navigate]);

  useEffect(() => {
    function handleMemoriesChanged() {
      void refetch({ resetLoading: false });
      if (selectedMemoryId) {
        void detailApi.refetch({ resetLoading: false });
      }
    }

    window.addEventListener(MEMORIES_CHANGED_EVENT, handleMemoriesChanged);
    return () => window.removeEventListener(MEMORIES_CHANGED_EVENT, handleMemoriesChanged);
  }, [detailApi, refetch, selectedMemoryId]);

  useEffect(() => {
    if (loading || !selectedMemoryId) {
      return;
    }

    if (memories.some((memory) => memory.id === selectedMemoryId)) {
      return;
    }

    navigateNotes({ memoryId: null, view: 'main', item: null, creating: false }, true);
  }, [loading, memories, navigateNotes, selectedMemoryId]);

  useEffect(() => {
    if (!selectedMemoryId) {
      return;
    }

    ensureOpenResourceShelfItem('note', selectedMemoryId);
  }, [selectedMemoryId]);

  return (
    <BrowserSplitLayout
      storageKey={NOTES_BROWSER_WIDTH_STORAGE_KEY}
      initialWidth={320}
      minWidth={260}
      maxWidth={440}
      browser={<NotesBrowserRail />}
      browserLabel="Notes browser"
    >
      <div className="min-w-0 flex-1 px-6 py-4">
        {loading && !data ? <LoadingState label="Loading notes…" /> : null}
        {error && !data ? <ErrorState message={`Unable to load notes: ${error}`} /> : null}

        {!loading && !error && (
          <div className="min-h-0 h-full overflow-hidden">
            {creating ? (
              <NewNoteWorkspace
                onNavigate={navigateNotes}
                onCreated={(created) => {
                  replaceData({
                    memories: [created.memory, ...memories.filter((memory) => memory.id !== created.memory.id)],
                    memoryQueue,
                  });
                }}
              />
            ) : selectedMemoryId ? (
              detailApi.loading && !selectedDetail ? (
                <LoadingState label="Loading note…" className="h-full justify-center" />
              ) : detailApi.error || !selectedDetail ? (
                <ErrorState message={`Unable to load note: ${detailApi.error ?? 'Note not found.'}`} />
              ) : (
                <NoteWorkspace
                  detail={selectedDetail}
                  selectedView={selectedView}
                  selectedItem={selectedItem}
                  locationSearch={location.search}
                  onNavigate={navigateNotes}
                  onRefetched={() => {
                    void detailApi.refetch({ resetLoading: false });
                    void refetch({ resetLoading: false });
                  }}
                />
              )
            ) : memories.length === 0 ? (
              <EmptyState
                className="h-full"
                title="No notes yet"
                body="Create a note to start building durable context."
                action={<ToolbarButton onClick={() => navigateNotes({ creating: true })}>Create note</ToolbarButton>}
              />
            ) : (
              <EmptyState
                className="h-full"
                title="Select a note"
                body="Choose a note from the browser on the left to open it here."
              />
            )}
          </div>
        )}
      </div>
    </BrowserSplitLayout>
  );
}

