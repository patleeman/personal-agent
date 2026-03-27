import { useCallback, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { timeAgo } from '../utils';
import type { MemoryWorkItem } from '../types';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, ToolbarButton } from './ui';
import {
  buildNoteListMeta,
  buildNoteSearch,
  filterMemories,
  NOTE_ID_SEARCH_PARAM,
  NOTE_ITEM_SEARCH_PARAM,
  noteKindLabel,
  readCreateState,
  readNoteView,
} from '../noteWorkspaceState';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

function noteDotClass(status: string | undefined, usedInLastSession: boolean | undefined): string {
  const normalizedStatus = status?.trim().toLowerCase();
  if (normalizedStatus === 'archived') {
    return 'bg-border-default';
  }
  if (normalizedStatus === 'draft') {
    return 'bg-warning';
  }
  return usedInLastSession ? 'bg-accent' : 'bg-teal';
}

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
        <ToolbarButton
          className="shrink-0 self-center"
          onClick={() => onRetry(item)}
          disabled={actionDisabled}
          title="Retry this node distillation"
        >
          {activeAction === 'retry' ? 'Retrying…' : 'Retry'}
        </ToolbarButton>
      )}
    </div>
  );
}

export function NotesBrowserRail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data, loading, error, refreshing, refetch } = useApi(api.notes);
  const [query, setQuery] = useState('');
  const [pendingQueueAction, setPendingQueueAction] = useState<{ runId: string; kind: 'retry' } | null>(null);
  const [startingBatchRecovery, setStartingBatchRecovery] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const memories = data?.memories ?? [];
  const memoryQueue = data?.memoryQueue ?? [];
  const filteredMemories = useMemo(() => filterMemories(memories, query), [memories, query]);
  const recoverableQueueItems = useMemo(
    () => memoryQueue.filter((item) => canRetryMemoryWorkItem(item)),
    [memoryQueue],
  );
  const queueBusy = Boolean(pendingQueueAction) || startingBatchRecovery;
  const selectedMemoryId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get(NOTE_ID_SEARCH_PARAM)?.trim() || params.get('memory')?.trim() || null;
  }, [location.search]);
  const selectedView = useMemo(() => readNoteView(location.search), [location.search]);
  const selectedItem = useMemo(() => new URLSearchParams(location.search).get(NOTE_ITEM_SEARCH_PARAM)?.trim() || null, [location.search]);
  const creating = useMemo(() => readCreateState(location.search), [location.search]);
  const selectedMemory = memories.find((memory) => memory.id === selectedMemoryId) ?? null;

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
      setQueueNotice(`Started recovery run ${result.runId} for ${result.count} failed ${result.count === 1 ? 'extraction' : 'extractions'}.`);
      await refetch({ resetLoading: false });
    } catch (recoverError) {
      setQueueError(recoverError instanceof Error ? recoverError.message : 'Could not start failed note-extraction recovery.');
    } finally {
      setStartingBatchRecovery(false);
    }
  }, [queueBusy, recoverableQueueItems.length, refetch]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-border-subtle px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-card-title">Notes</p>
            <p className="ui-card-meta mt-1">Browse notes and open them in the main workspace.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/notes${buildNoteSearch(location.search, { creating: true, view: 'main', item: null })}`} className="ui-toolbar-button text-accent">
              New
            </Link>
            <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : '↻'}
            </ToolbarButton>
          </div>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search notes"
          className={INPUT_CLASS}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="ui-card-meta">
          {query.trim() ? `Showing ${filteredMemories.length} of ${memories.length}.` : `${memories.length} notes.`}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {loading && !data ? <LoadingState label="Loading notes…" className="px-0 py-0" /> : null}
        {error && !data ? <ErrorState message={`Unable to load notes: ${error}`} className="px-0 py-0" /> : null}

        {!loading && !error && memoryQueue.length > 0 && (
          <div className="space-y-2 border-b border-border-subtle pb-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="ui-section-label">Work queue</p>
                <p className="ui-card-meta mt-1">Background note distillation runs.</p>
              </div>
              {recoverableQueueItems.length > 0 && (
                <ToolbarButton
                  onClick={() => { void recoverFailedMemoryWorkItems(); }}
                  disabled={queueBusy}
                  title="Start one background recovery run for every failed or interrupted note extraction"
                >
                  {startingBatchRecovery ? 'Starting…' : 'Recover'}
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
                  onRetry={retryMemoryWorkItem}
                />
              ))}
            </div>
          </div>
        )}

        {!loading && !error && filteredMemories.length === 0 ? (
          <EmptyState
            className="py-8"
            title={memories.length === 0 ? 'No notes yet' : 'No matches'}
            body={memories.length === 0 ? 'Create a note to start building durable context.' : 'Try a broader search across titles, summaries, and tags.'}
          />
        ) : null}

        {!loading && !error && filteredMemories.length > 0 && (
          <div className="space-y-px">
            {filteredMemories.map((memory) => (
              <ListLinkRow
                key={memory.id}
                to={`/notes${buildNoteSearch(location.search, { memoryId: memory.id, view: 'main', item: null, creating: false })}`}
                selected={memory.id === selectedMemoryId && !creating}
                leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${noteDotClass(memory.status, memory.usedInLastSession)}`} />}
              >
                <p className="ui-row-title">{memory.title}</p>
                <p className="ui-row-summary">{memory.summary || 'No summary yet.'}</p>
                <div className="ui-row-meta flex flex-wrap items-center gap-1.5">
                  <span>{buildNoteListMeta(memory)}</span>
                </div>
              </ListLinkRow>
            ))}
          </div>
        )}

        {selectedMemory && !creating && (
          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Resources</p>
            <div className="space-y-px">
              <ListLinkRow
                to={`/notes${buildNoteSearch(location.search, { memoryId: selectedMemory.id, view: 'main', item: null, creating: false })}`}
                selected={selectedView === 'main'}
              >
                <p className="ui-row-title">Main</p>
                <p className="ui-row-summary">Primary note document</p>
                <p className="ui-row-meta">{noteKindLabel(selectedMemory)}</p>
              </ListLinkRow>
              <ListLinkRow
                to={`/notes${buildNoteSearch(location.search, { memoryId: selectedMemory.id, view: 'references', item: selectedItem, creating: false })}`}
                selected={selectedView === 'references'}
              >
                <p className="ui-row-title">References</p>
                <p className="ui-row-summary">Supporting documents and research</p>
                <p className="ui-row-meta">{selectedMemory.referenceCount ?? 0} files</p>
              </ListLinkRow>
              <ListLinkRow
                to={`/notes${buildNoteSearch(location.search, { memoryId: selectedMemory.id, view: 'links', item: null, creating: false })}`}
                selected={selectedView === 'links'}
              >
                <p className="ui-row-title">Links</p>
                <p className="ui-row-summary">Relationships with other nodes</p>
                <p className="ui-row-meta">Open node graph details</p>
              </ListLinkRow>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
