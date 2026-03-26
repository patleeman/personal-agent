import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { persistForkPromptDraft } from '../forking';
import { useApi } from '../hooks';
import { emitMemoriesChanged, MEMORIES_CHANGED_EVENT } from '../memoryDocEvents';
import type { MemoryDocItem, MemoryWorkItem } from '../types';
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
import { MentionTextarea } from '../components/MentionTextarea';

const NOTE_ID_SEARCH_PARAM = 'note';
const INPUT_CLASS = 'w-full max-w-xl rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary placeholder:text-dim focus:border-accent/60 focus:outline-none';
const TEXTAREA_CLASS = `${INPUT_CLASS} max-w-3xl min-h-[104px] resize-y leading-relaxed`;

function filterMemories(memories: MemoryDocItem[], query: string): MemoryDocItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return memories;
  }

  return memories.filter((memory) => {
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
  });
}

function buildNoteSearch(locationSearch: string, memoryId: string | null): string {
  const params = new URLSearchParams(locationSearch);

  if (memoryId) {
    params.set(NOTE_ID_SEARCH_PARAM, memoryId);
  } else {
    params.delete(NOTE_ID_SEARCH_PARAM);
    params.delete('memory');
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

function memoryDotClass(memory: MemoryDocItem): string {
  const normalizedStatus = memory.status?.trim().toLowerCase();

  if (normalizedStatus === 'archived') {
    return 'bg-border-default';
  }

  if (normalizedStatus === 'draft') {
    return 'bg-warning';
  }

  return memory.usedInLastSession ? 'bg-accent' : 'bg-teal';
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

function canRecoverMemoryWorkItem(item: MemoryWorkItem): boolean {
  return canRetryMemoryWorkItem(item);
}

function formatReferenceCount(count: number | undefined): string {
  const normalized = count ?? 0;
  return `${normalized} ${normalized === 1 ? 'reference' : 'references'}`;
}

function formatRelatedCount(related: string[] | undefined): string | null {
  const normalized = related?.length ?? 0;
  if (normalized === 0) {
    return null;
  }

  return `${normalized} related ${normalized === 1 ? 'node' : 'nodes'}`;
}

function parseCreateNoteTags(value: string): string[] {
  return [...new Set(value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0))];
}

function noteKindLabel(memory: MemoryDocItem): string {
  const tags = new Set(memory.tags.map((tag) => tag.trim().toLowerCase()));
  const type = memory.type?.trim().toLowerCase();
  const role = memory.role?.trim().toLowerCase();

  if (role === 'structure' || type === 'structure' || tags.has('structure')) {
    return 'Structure note';
  }

  if (type === 'reference' || tags.has('reference')) {
    return 'Reference note';
  }

  if (type === 'project' || tags.has('project')) {
    return 'Project note';
  }

  return 'Note';
}

function formatTagSummary(tags: string[]): string | null {
  const visible = tags.slice(0, 4);
  return visible.length > 0 ? visible.join(' · ') : null;
}

function buildNoteListMeta(memory: MemoryDocItem): string {
  const parts = [`@${memory.id}`, noteKindLabel(memory)];

  if (memory.parent) {
    parts.push(`parent @${memory.parent}`);
  }

  const relatedCount = formatRelatedCount(memory.related);
  if (relatedCount) {
    parts.push(relatedCount);
  }

  const referenceSummary = (memory.referenceCount ?? 0) > 0 ? formatReferenceCount(memory.referenceCount) : null;
  if (referenceSummary) {
    parts.push(referenceSummary);
  }

  if (memory.updated) {
    parts.push(`updated ${timeAgo(memory.updated)}`);
  }

  return parts.join(' · ');
}

function MemoryWorkQueueRow({
  item,
  activeAction,
  actionDisabled,
  onRetry,
  onRecover,
}: {
  item: MemoryWorkItem;
  activeAction: 'retry' | 'recover' | null;
  actionDisabled: boolean;
  onRetry: (item: MemoryWorkItem) => void;
  onRecover: (item: MemoryWorkItem) => void;
}) {
  const retryable = canRetryMemoryWorkItem(item);
  const recoverable = canRecoverMemoryWorkItem(item);
  const summary = activeAction === 'retry'
    ? 'Queueing node distillation…'
    : activeAction === 'recover'
      ? 'Opening recovery conversation…'
      : item.lastError || memoryWorkItemLabel(item);
  const status = activeAction === 'retry'
    ? 'queueing'
    : activeAction === 'recover'
      ? 'recovering'
      : item.status;

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
      {(retryable || recoverable) && (
        <div className="flex shrink-0 flex-col items-end gap-1.5 self-center">
          {retryable && (
            <ToolbarButton
              className="shrink-0"
              onClick={() => onRetry(item)}
              disabled={actionDisabled}
              title="Retry this node distillation"
            >
              {activeAction === 'retry' ? 'Retrying…' : 'Retry'}
            </ToolbarButton>
          )}
          {recoverable && (
            <ToolbarButton
              className="shrink-0"
              onClick={() => onRecover(item)}
              disabled={actionDisabled}
              title="Open a recovery conversation for this node distillation"
            >
              {activeAction === 'recover' ? 'Opening…' : 'Recover'}
            </ToolbarButton>
          )}
        </div>
      )}
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

  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createSummary, setCreateSummary] = useState('');
  const [createTags, setCreateTags] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingQueueAction, setPendingQueueAction] = useState<{ runId: string; kind: 'retry' | 'recover' } | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const memories = data?.memories ?? [];
  const memoryQueue = data?.memoryQueue ?? [];
  const filteredMemories = useMemo(() => filterMemories(memories, query), [memories, query]);
  const selectedMemoryId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const value = params.get(NOTE_ID_SEARCH_PARAM) ?? params.get('memory');
    return value?.trim() || null;
  }, [location.search]);
  const setSelectedMemory = useCallback((memoryId: string | null, replace = false) => {
    const nextSearch = buildNoteSearch(location.search, memoryId);
    navigate(`/notes${nextSearch}`, { replace });
  }, [location.search, navigate]);

  useEffect(() => {
    function handleMemoriesChanged() {
      void refetch({ resetLoading: false });
    }

    window.addEventListener(MEMORIES_CHANGED_EVENT, handleMemoriesChanged);
    return () => window.removeEventListener(MEMORIES_CHANGED_EVENT, handleMemoriesChanged);
  }, [refetch]);

  useEffect(() => {
    if (loading || !selectedMemoryId) {
      return;
    }

    if (memories.some((memory) => memory.id === selectedMemoryId)) {
      return;
    }

    setSelectedMemory(null, true);
  }, [loading, memories, selectedMemoryId, setSelectedMemory]);

  const retryMemoryWorkItem = useCallback(async (item: MemoryWorkItem) => {
    if (!canRetryMemoryWorkItem(item) || pendingQueueAction) {
      return;
    }

    setQueueError(null);
    setPendingQueueAction({ runId: item.runId, kind: 'retry' });
    try {
      const result = await api.retryNodeDistillRun(item.runId);
      navigate(`/conversations/${encodeURIComponent(result.conversationId)}?run=${encodeURIComponent(result.runId)}`);
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : 'Could not retry node distillation.');
      setPendingQueueAction(null);
      await refetch({ resetLoading: false });
    }
  }, [navigate, pendingQueueAction, refetch]);

  const recoverMemoryWorkItem = useCallback(async (item: MemoryWorkItem) => {
    if (!canRecoverMemoryWorkItem(item) || pendingQueueAction) {
      return;
    }

    setQueueError(null);
    setPendingQueueAction({ runId: item.runId, kind: 'recover' });
    try {
      const result = await api.recoverNodeDistillRun(item.runId);
      persistForkPromptDraft(
        result.conversationId,
        `Help me recover node distillation run ${item.runId}. Inspect the failure, then either retry it or finish it manually.`,
      );
      navigate(`/conversations/${encodeURIComponent(result.conversationId)}`);
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : 'Could not open a recovery conversation for this node distillation run.');
      setPendingQueueAction(null);
      await refetch({ resetLoading: false });
    }
  }, [navigate, pendingQueueAction, refetch]);

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

      replaceData({
        memories: [created.memory, ...memories.filter((memory) => memory.id !== created.memory.id)],
        memoryQueue,
      });
      emitMemoriesChanged();
      void refetch({ resetLoading: false });
      setCreateTitle('');
      setCreateSummary('');
      setCreateTags('');
      setQuery('');
      setCreateOpen(false);
      setSelectedMemory(created.memory.id);
    } catch (createNoteError) {
      setCreateError(createNoteError instanceof Error ? createNoteError.message : String(createNoteError));
      setCreating(false);
      return;
    }

    setCreating(false);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        className="flex-wrap items-start gap-y-3"
        actions={(
          <>
            <ToolbarButton onClick={() => {
              setCreateError(null);
              setCreateOpen((current) => !current);
            }} className={createOpen ? 'text-accent' : undefined}>
              {createOpen ? 'Close composer' : 'New note'}
            </ToolbarButton>
            <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
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
            </>
          )}
        />
      </PageHeader>

      <div className="min-h-0 flex-1 px-6 py-4">
        {loading && <LoadingState label="Loading notes…" />}
        {error && <ErrorState message={`Unable to load notes: ${error}`} />}

        {!loading && !error && !createOpen && memories.length === 0 && memoryQueue.length === 0 && (
          <EmptyState
            title="No notes yet."
            body="Create one yourself or distill a conversation into a durable note."
            action={<ToolbarButton onClick={() => setCreateOpen(true)}>Create note</ToolbarButton>}
          />
        )}

        {!loading && !error && (memories.length > 0 || memoryQueue.length > 0 || createOpen) && (
          <div className="flex h-full min-h-0 flex-col gap-4 pb-2">
            {createOpen && (
              <div className="shrink-0 border-b border-border-subtle pb-5">
                <div className="space-y-1">
                  <h2 className="text-[15px] font-medium text-primary">New note</h2>
                  <p className="ui-card-meta max-w-2xl">
                    Start with a title and a short summary. The note opens in the right panel immediately after creation.
                  </p>
                </div>

                <form onSubmit={handleCreateNote} className="mt-4 max-w-3xl space-y-5">
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

                  {createError && <p className="text-[12px] text-danger">{createError}</p>}

                  <div className="flex items-center gap-3">
                    <ToolbarButton type="submit" disabled={creating || createTitle.trim().length === 0}>
                      {creating ? 'Creating…' : 'Create note'}
                    </ToolbarButton>
                    <ToolbarButton
                      type="button"
                      onClick={() => {
                        setCreateOpen(false);
                        setCreateError(null);
                      }}
                    >
                      Cancel
                    </ToolbarButton>
                  </div>
                </form>
              </div>
            )}

            {memoryQueue.length > 0 && (
              <details className="ui-disclosure shrink-0" {...(queueError ? { open: true } : {})}>
                <summary className="ui-disclosure-summary">
                  <span>Note work queue</span>
                  <span className="ui-disclosure-meta">{memoryQueue.length} {memoryQueue.length === 1 ? 'item' : 'items'}</span>
                </summary>
                <div className="ui-disclosure-body space-y-2">
                  <p className="ui-card-meta">Node distillation runs that are still active or did not finish cleanly.</p>
                  {queueError && <p className="text-[12px] text-danger">{queueError}</p>}
                  <div className="space-y-px">
                    {memoryQueue.map((item) => (
                      <MemoryWorkQueueRow
                        key={item.runId}
                        item={item}
                        activeAction={pendingQueueAction?.runId === item.runId ? pendingQueueAction.kind : null}
                        actionDisabled={Boolean(pendingQueueAction)}
                        onRetry={retryMemoryWorkItem}
                        onRecover={recoverMemoryWorkItem}
                      />
                    ))}
                  </div>
                </div>
              </details>
            )}

            {memories.length > 0 && (
              <>
                <div className="shrink-0 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor="memories-search" className="ui-section-label">Search notes</label>
                    <p className="ui-card-meta">
                      {query.trim()
                        ? `Showing ${filteredMemories.length} of ${memories.length} notes.`
                        : `Showing ${memories.length} notes.`}
                      {selectedMemoryId ? ` · Selected @${selectedMemoryId}` : ''}
                    </p>
                  </div>
                  <input
                    id="memories-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search by title, summary, tags, links, or reference content"
                    className={INPUT_CLASS}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  {filteredMemories.length > 0 ? (
                    <div className="space-y-px">
                      {filteredMemories.map((memory) => {
                        const isSelected = memory.id === selectedMemoryId;
                        const href = `/notes${buildNoteSearch(location.search, memory.id)}`;
                        const tagSummary = formatTagSummary(memory.tags);

                        return (
                          <ListLinkRow
                            key={memory.id}
                            to={href}
                            selected={isSelected}
                            leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${memoryDotClass(memory)}`} />}
                          >
                            <p className="ui-row-title">{memory.title}</p>
                            <p className="ui-row-summary">{memory.summary || 'No summary yet.'}</p>
                            <div className="ui-row-meta flex flex-wrap items-center gap-1.5">
                              <span>{buildNoteListMeta(memory)}</span>
                              {tagSummary && (
                                <>
                                  <span className="opacity-40">·</span>
                                  <span className="max-w-[20rem] truncate" title={memory.tags.join(', ')}>{tagSummary}</span>
                                </>
                              )}
                            </div>
                          </ListLinkRow>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState
                      className="py-10"
                      title="No matches"
                      body="Try a broader search across note titles, summaries, tags, linked notes, and reference content."
                      action={<ToolbarButton onClick={() => setQuery('')}>Clear search</ToolbarButton>}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
