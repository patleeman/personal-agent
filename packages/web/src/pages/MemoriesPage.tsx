import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { emitMemoriesChanged, MEMORIES_CHANGED_EVENT } from '../memoryDocEvents';
import { timeAgo } from '../utils';
import type { MemoryDocDetail, MemoryReferenceItem, MemoryWorkItem } from '../types';
import {
  EmptyState,
  ErrorState,
  ListLinkRow,
  LoadingState,
  PageHeader,
  PageHeading,
  ToolbarButton,
} from '../components/ui';
import { MentionTextarea } from '../components/MentionTextarea';
import {
  MarkdownDocumentSurface,
  type MarkdownDocumentMode,
  NodeInspectorSection,
  NodeMetadataList,
  NodePrimaryToolbar,
  NodeWorkspaceShell,
  WorkspaceActionNotice,
} from '../components/NodeWorkspace';
import { CompactNodeLinkList, NodeLinkList, UnresolvedNodeLinks } from '../components/NodeLinksSection';
import {
  buildNoteSearch,
  NOTE_ID_SEARCH_PARAM,
  NOTE_ITEM_SEARCH_PARAM,
  type NoteWorkspaceView,
  formatRelatedCount,
  noteKindLabel,
  parseCreateNoteTags,
  readCreateState,
  readNoteView,
} from '../noteWorkspaceState';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary placeholder:text-dim focus:border-accent/60 focus:outline-none';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[104px] resize-y leading-relaxed`;

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

function canRecoverMemoryWorkItem(item: MemoryWorkItem): boolean {
  return canRetryMemoryWorkItem(item);
}

function NoteWorkQueueRow({
  item,
  activeAction,
  actionDisabled,
  onRetry,
}: {
  item: MemoryWorkItem;
  activeAction: 'retry' | null;
  actionDisabled: boolean;
  onRetry: (item: MemoryWorkItem) => void;
}) {
  const retryable = canRetryMemoryWorkItem(item);
  const summary = activeAction === 'retry'
    ? 'Queueing node distillation…'
    : item.lastError || memoryWorkItemLabel(item);
  const status = activeAction === 'retry' ? 'queueing' : item.status;

  return (
    <div className="group ui-list-row ui-list-row-hover">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${memoryWorkItemDotClass(item)}`} />
      <Link to={memoryWorkItemHref(item)} className="flex min-w-0 flex-1 flex-col justify-center self-stretch">
        <p className="ui-row-title">{item.conversationTitle}</p>
        <p className="ui-row-summary">{summary}</p>
        <div className="ui-row-meta flex flex-wrap items-center gap-1.5">
          <span>{status}</span>
          <span className="opacity-40">·</span>
          <span className="font-mono" title={item.runId}>{item.runId}</span>
          <span className="opacity-40">·</span>
          <span>{timeAgo(item.updatedAt)}</span>
        </div>
      </Link>
      {retryable && (
        <div className="flex shrink-0 flex-col items-end gap-1.5 self-center">
          <ToolbarButton
            className="shrink-0"
            onClick={() => onRetry(item)}
            disabled={actionDisabled}
            title="Retry this node distillation"
          >
            {activeAction === 'retry' ? 'Retrying…' : 'Retry'}
          </ToolbarButton>
        </div>
      )}
    </div>
  );
}

function NoteQueueSection({
  memoryQueue,
  pendingQueueAction,
  queueError,
  queueNotice,
  queueBusy,
  recoverableCount,
  startingBatchRecovery,
  onRetry,
  onRecoverFailed,
}: {
  memoryQueue: MemoryWorkItem[];
  pendingQueueAction: { runId: string; kind: 'retry' } | null;
  queueError: string | null;
  queueNotice: string | null;
  queueBusy: boolean;
  recoverableCount: number;
  startingBatchRecovery: boolean;
  onRetry: (item: MemoryWorkItem) => void;
  onRecoverFailed: () => void;
}) {
  if (memoryQueue.length === 0) {
    return null;
  }

  return (
    <details className="ui-disclosure" {...(queueError ? { open: true } : {})}>
      <summary className="ui-disclosure-summary">
        <span>Note work queue</span>
        <span className="ui-disclosure-meta">{memoryQueue.length} {memoryQueue.length === 1 ? 'item' : 'items'}</span>
      </summary>
      <div className="ui-disclosure-body space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="ui-card-meta">Node distillation runs that are still active or did not finish cleanly.</p>
          {recoverableCount > 0 && (
            <ToolbarButton
              onClick={onRecoverFailed}
              disabled={queueBusy}
              title="Start one background recovery run for every failed or interrupted note extraction"
            >
              {startingBatchRecovery ? 'Starting recovery…' : 'Recover failed extractions'}
            </ToolbarButton>
          )}
        </div>
        {queueNotice && <p className="text-[12px] text-secondary">{queueNotice}</p>}
        {queueError && <p className="text-[12px] text-danger">{queueError}</p>}
        <div className="space-y-px">
          {memoryQueue.map((item) => (
            <NoteWorkQueueRow
              key={item.runId}
              item={item}
              activeAction={pendingQueueAction?.runId === item.runId ? pendingQueueAction.kind : null}
              actionDisabled={queueBusy}
              onRetry={onRetry}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

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
  const [contentMode, setContentMode] = useState<MarkdownDocumentMode>('split');
  const [selectedContent, setSelectedContent] = useState(selectedView === 'main' ? detail.content : '');
  const [savedContent, setSavedContent] = useState(selectedView === 'main' ? detail.content : '');
  const [draft, setDraft] = useState(selectedView === 'main' ? detail.content : '');
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'accent' | 'danger' | 'warning'; text: string } | null>(null);
  const selectedPath = selectedReference?.path ?? memory.path;
  const selectedLabel = selectedReference?.title ?? memory.title;
  const selectedSummary = selectedReference?.summary ?? memory.summary;
  const dirty = draft !== savedContent;
  const modeTabs = selectedView === 'links' || (selectedView === 'references' && !selectedReference)
    ? undefined
    : [
        { id: 'edit', label: 'Edit', selected: contentMode === 'edit', onSelect: () => setContentMode('edit') },
        { id: 'preview', label: 'Preview', selected: contentMode === 'preview', onSelect: () => setContentMode('preview') },
        { id: 'split', label: 'Split', selected: contentMode === 'split', onSelect: () => setContentMode('split') },
      ];
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
        setSelectedContent('');
        setSavedContent('');
        setDraft('');
        setContentError(null);
        setContentLoading(false);
        return;
      }

      if (selectedView === 'main') {
        setSelectedContent(detail.content);
        setSavedContent(detail.content);
        setDraft(detail.content);
        setContentError(null);
        setContentLoading(false);
        return;
      }

      setContentLoading(true);
      setContentError(null);
      try {
        const result = await api.memoryFile(selectedReference.path);
        if (cancelled) {
          return;
        }
        setSelectedContent(result.content);
        setSavedContent(result.content);
        setDraft(result.content);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setContentError(error instanceof Error ? error.message : String(error));
        setSelectedContent('');
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
      if (selectedReference) {
        await api.memoryFileSave(selectedReference.path, draft);
        setSelectedContent(draft);
        setSavedContent(draft);
        setNotice({ tone: 'accent', text: `Saved ${selectedReference.relativePath}.` });
      } else {
        const result = await api.saveNoteDoc(memory.id, draft);
        setSelectedContent(result.content);
        setSavedContent(result.content);
        setDraft(result.content);
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
        setSelectedContent(result.content);
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

  const advancedItems = [
    { label: 'Note', value: <span className="font-mono text-primary">@{memory.id}</span> },
    { label: 'Kind', value: noteKindLabel(memory) },
    ...(memory.type ? [{ label: 'Type', value: memory.type }] : []),
    ...(memory.role ? [{ label: 'Role', value: memory.role }] : []),
    ...(memory.status ? [{ label: 'Status', value: memory.status }] : []),
    ...(memory.area ? [{ label: 'Area', value: memory.area }] : []),
    ...(memory.updated ? [{ label: 'Updated', value: timeAgo(memory.updated) }] : []),
    ...(memory.summary ? [{ label: 'Summary', value: memory.summary }] : []),
    { label: 'Path', value: <span className="break-all font-mono text-[12px]">{selectedPath}</span> },
    { label: 'Tags', value: memory.tags.length > 0 ? memory.tags.join(' · ') : 'No tags' },
    ...(memory.parent ? [{ label: 'Parent', value: <Link to={`/notes${buildNoteSearch(locationSearch, { memoryId: memory.parent, view: 'main', item: null, creating: false })}`} className="text-accent hover:underline">@{memory.parent}</Link> }] : []),
  ];
  const noteTags = !selectedReference && memory.tags.length > 0
    ? memory.tags.join(' · ')
    : null;
  const hasCompactDetails = Boolean(memory.parent || (detail.links?.outgoing?.length ?? 0) > 0 || (detail.links?.incoming?.length ?? 0) > 0 || (detail.links?.unresolved?.length ?? 0) > 0);

  return (
    <NodeWorkspaceShell
      eyebrow="Notes"
      title={selectedLabel}
      summary={selectedReference ? (selectedSummary || undefined) : noteTags ? `Tags · ${noteTags}` : undefined}
      meta={(
        <>
          <span className="font-mono">@{memory.id}</span>
          <span className="opacity-40">·</span>
          <span>{selectedReference ? selectedReference.relativePath : 'Main document'}</span>
          {dirty && (
            <>
              <span className="opacity-40">·</span>
              <span className="text-warning">Unsaved changes</span>
            </>
          )}
        </>
      )}
      resourceTabs={resourceTabs}
      modeTabs={modeTabs}
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
          {!selectedReference && selectedView === 'main' && (
            <ToolbarButton onClick={() => { void handleStartConversation(); }} disabled={startBusy} className="text-accent">
              {startBusy ? 'Starting…' : 'Chat about note'}
            </ToolbarButton>
          )}
          {!selectedReference && selectedView === 'main' && (
            <ToolbarButton onClick={() => { void handleDelete(); }} disabled={deleteBusy} className="text-danger">
              {deleteBusy ? 'Deleting…' : 'Delete note'}
            </ToolbarButton>
          )}
        </NodePrimaryToolbar>
      )}
      notice={notice ? <WorkspaceActionNotice tone={notice.tone}>{notice.text}</WorkspaceActionNotice> : null}
      inspector={(
        <>
          {hasCompactDetails && (
            <NodeInspectorSection title="Relationships" meta={formatRelatedCount(memory.related) ?? undefined}>
              <div className="space-y-3">
                {memory.parent && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">Parent</p>
                    <Link to={`/notes${buildNoteSearch(locationSearch, { memoryId: memory.parent, view: 'main', item: null, creating: false })}`} className="text-[12px] text-accent hover:underline">@{memory.parent}</Link>
                  </div>
                )}
                <CompactNodeLinkList title="Links to" items={detail.links?.outgoing} surface="main" emptyText="No outgoing links." />
                <CompactNodeLinkList title="Linked from" items={detail.links?.incoming} surface="main" emptyText="No backlinks." />
                {(detail.links?.unresolved?.length ?? 0) > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">Unresolved refs</p>
                    <p className="text-[12px] text-secondary">{detail.links?.unresolved?.map((id) => `@${id}`).join(' · ')}</p>
                  </div>
                )}
              </div>
            </NodeInspectorSection>
          )}
          <details className="ui-disclosure">
            <summary className="ui-disclosure-summary">
              <span>Advanced</span>
              <span className="ui-disclosure-meta">Source details</span>
            </summary>
            <div className="ui-disclosure-body space-y-3">
              <NodeMetadataList items={advancedItems} />
            </div>
          </details>
        </>
      )}
    >
      {contentError ? (
        <div className="p-6"><ErrorState message={`Unable to load file: ${contentError}`} /></div>
      ) : contentLoading ? (
        <LoadingState label="Loading note…" className="h-full justify-center" />
      ) : selectedView === 'references' && !selectedReference ? (
        <ReferencesList memory={memory} references={references} locationSearch={locationSearch} />
      ) : selectedView === 'links' ? (
        <NoteLinksView detail={detail} />
      ) : (
        <MarkdownDocumentSurface
          value={draft}
          onChange={setDraft}
          path={selectedPath}
          mode={contentMode}
          emptyPreviewText="This file has no rendered markdown yet."
        />
      )}
    </NodeWorkspaceShell>
  );
}

function NewNoteWorkspace({
  locationSearch,
  onNavigate,
  onCreated,
}: {
  locationSearch: string;
  onNavigate: (updates: { memoryId?: string | null; view?: NoteWorkspaceView | null; item?: string | null; creating?: boolean | null }, replace?: boolean) => void;
  onCreated: (detail: MemoryDocDetail) => void;
}) {
  const [createTitle, setCreateTitle] = useState('');
  const [createSummary, setCreateSummary] = useState('');
  const [createTags, setCreateTags] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreateNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating || createTitle.trim().length === 0) {
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const created = await api.createNoteDoc({
        title: createTitle.trim(),
        summary: createSummary.trim() || undefined,
        tags: parseCreateNoteTags(createTags),
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

  return (
    <NodeWorkspaceShell
      eyebrow="Notes"
      title="New note"
      summary="Create the note in the main workspace, then continue writing in the same place after it opens."
      resourceTabs={[
        {
          id: 'new-note',
          label: 'Create note',
          to: `/notes${buildNoteSearch(locationSearch, { creating: true })}`,
          selected: true,
        },
      ]}
      actions={(
        <NodePrimaryToolbar>
          <ToolbarButton onClick={() => onNavigate({ creating: false })}>Close</ToolbarButton>
        </NodePrimaryToolbar>
      )}
      notice={createError ? <WorkspaceActionNotice tone="danger">{createError}</WorkspaceActionNotice> : null}
    >
      <div className="h-full overflow-y-auto py-4">
        <form onSubmit={handleCreateNote} className="mx-auto max-w-3xl space-y-5">
          <div className="space-y-1.5">
            <label className="ui-card-meta" htmlFor="create-note-title">Title</label>
            <input
              id="create-note-title"
              value={createTitle}
              onChange={(event) => setCreateTitle(event.target.value)}
              className={INPUT_CLASS}
              placeholder="What is this note about?"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <label className="ui-card-meta" htmlFor="create-note-summary">Summary</label>
            <MentionTextarea
              id="create-note-summary"
              value={createSummary}
              onValueChange={setCreateSummary}
              className={TEXTAREA_CLASS}
              placeholder="A short explanation that will make this note obvious when you see it later."
            />
          </div>

          <div className="space-y-1.5">
            <label className="ui-card-meta" htmlFor="create-note-tags">Tags</label>
            <input
              id="create-note-tags"
              value={createTags}
              onChange={(event) => setCreateTags(event.target.value)}
              className={INPUT_CLASS}
              placeholder="Optional. Comma-separated tags like writing, ideas, reference"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="border-t border-border-subtle pt-4">
            <p className="ui-section-label">What happens next</p>
            <p className="mt-2 text-[13px] leading-relaxed text-secondary">
              We’ll scaffold the node, open its main document in this workspace, and keep the right rail focused on browsing notes and references.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <ToolbarButton type="submit" disabled={creating || createTitle.trim().length === 0}>
              {creating ? 'Creating…' : 'Create note'}
            </ToolbarButton>
            <ToolbarButton type="button" onClick={() => onNavigate({ creating: false })}>Cancel</ToolbarButton>
          </div>
        </form>
      </div>
    </NodeWorkspaceShell>
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

  const [pendingQueueAction, setPendingQueueAction] = useState<{ runId: string; kind: 'retry' } | null>(null);
  const [startingBatchRecovery, setStartingBatchRecovery] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const memories = data?.memories ?? [];
  const memoryQueue = data?.memoryQueue ?? [];
  const recoverableQueueItems = useMemo(
    () => memoryQueue.filter((item) => canRecoverMemoryWorkItem(item)),
    [memoryQueue],
  );
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
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : 'Could not retry node distillation.');
      setPendingQueueAction(null);
      await refetch({ resetLoading: false });
    }
  }, [navigate, queueBusy, refetch]);

  const recoverFailedMemoryWorkItems = useCallback(async () => {
    if (recoverableQueueItems.length === 0 || queueBusy) {
      return;
    }

    setQueueError(null);
    setQueueNotice(null);
    setStartingBatchRecovery(true);
    try {
      const result = await api.recoverFailedNodeDistills();
      setQueueNotice(
        `Started recovery run ${result.runId} for ${result.count} failed ${result.count === 1 ? 'extraction' : 'extractions'}.`,
      );
      await refetch({ resetLoading: false });
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : 'Could not start failed note-extraction recovery.');
    } finally {
      setStartingBatchRecovery(false);
    }
  }, [queueBusy, recoverableQueueItems.length, refetch]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        className="flex-wrap items-start gap-y-3"
        actions={(
          <>
            <ToolbarButton onClick={() => navigateNotes({ creating: !creating, item: null, view: 'main' })} className={creating ? 'text-accent' : undefined}>
              {creating ? 'Close new note' : 'New note'}
            </ToolbarButton>
            <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); if (selectedMemoryId) { void detailApi.refetch({ resetLoading: false }); } }} disabled={refreshing || detailApi.refreshing}>
              {refreshing || detailApi.refreshing ? 'Refreshing…' : 'Refresh'}
            </ToolbarButton>
          </>
        )}
      >
        <PageHeading
          title="Notes"
          meta={(
            <>
              {memories.length} {memories.length === 1 ? 'note' : 'notes'}
              {memoryQueue.length > 0 && <span className="ml-2 text-secondary">· {memoryQueue.length} in queue</span>}
              {selectedMemoryId && <span className="ml-2 text-secondary">· @{selectedMemoryId}</span>}
              {creating && <span className="ml-2 text-secondary">· creating</span>}
            </>
          )}
        />
      </PageHeader>

      <div className="min-h-0 flex-1 px-6 py-4">
        {loading && !data ? <LoadingState label="Loading notes…" /> : null}
        {error && !data ? <ErrorState message={`Unable to load notes: ${error}`} /> : null}

        {!loading && !error && (
          <div className="flex h-full min-h-0 flex-col gap-4">
            <NoteQueueSection
              memoryQueue={memoryQueue}
              pendingQueueAction={pendingQueueAction}
              queueError={queueError}
              queueNotice={queueNotice}
              queueBusy={queueBusy}
              recoverableCount={recoverableQueueItems.length}
              startingBatchRecovery={startingBatchRecovery}
              onRetry={retryMemoryWorkItem}
              onRecoverFailed={() => { void recoverFailedMemoryWorkItems(); }}
            />

            <div className="min-h-0 flex-1 overflow-hidden">
              {creating ? (
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
                  body="Create a note to open it in the main workspace. The right rail is now for browsing notes and their resources."
                  action={<ToolbarButton onClick={() => navigateNotes({ creating: true })}>Create note</ToolbarButton>}
                />
              ) : (
                <EmptyState
                  className="h-full"
                  title="Select a note"
                  body="Use the right rail to browse notes, references, and links. The selected note opens here in a document-first workspace."
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

