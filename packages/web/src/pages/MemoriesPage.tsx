import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { MEMORIES_CHANGED_EVENT } from '../memoryDocEvents';
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

const MEMORY_ID_SEARCH_PARAM = 'memory';
const INPUT_CLASS = 'w-full max-w-xl rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

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

function buildMemorySearch(locationSearch: string, memoryId: string | null): string {
  const params = new URLSearchParams(locationSearch);

  if (memoryId) {
    params.set(MEMORY_ID_SEARCH_PARAM, memoryId);
  } else {
    params.delete(MEMORY_ID_SEARCH_PARAM);
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
      return 'Distillation failed';
    case 'interrupted':
      return 'Distillation interrupted';
    case 'queued':
      return 'Queued for distillation';
    case 'waiting':
      return 'Waiting to resume distillation';
    case 'recovering':
      return 'Recovering distillation';
    default:
      return 'Distilling into memory';
  }
}

function memoryWorkItemHref(item: MemoryWorkItem): string {
  const base = `/conversations/${encodeURIComponent(item.conversationId)}`;
  return item.runId.startsWith('state:')
    ? base
    : `${base}?run=${encodeURIComponent(item.runId)}`;
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

  return `${normalized} related ${normalized === 1 ? 'package' : 'packages'}`;
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
  } = useApi(api.memories);

  const [query, setQuery] = useState('');
  const memories = data?.memories ?? [];
  const memoryQueue = data?.memoryQueue ?? [];
  const filteredMemories = useMemo(() => filterMemories(memories, query), [memories, query]);
  const selectedMemoryId = useMemo(() => {
    const value = new URLSearchParams(location.search).get(MEMORY_ID_SEARCH_PARAM);
    return value?.trim() || null;
  }, [location.search]);
  const selectedMemory = useMemo(
    () => memories.find((memory) => memory.id === selectedMemoryId) ?? null,
    [memories, selectedMemoryId],
  );

  const setSelectedMemory = useCallback((memoryId: string | null, replace = false) => {
    const nextSearch = buildMemorySearch(location.search, memoryId);
    navigate(`/memories${nextSearch}`, { replace });
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        className="flex-wrap items-start gap-y-3"
        actions={(
          <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </ToolbarButton>
        )}
      >
        <PageHeading
          title="Memories"
          meta={(
            <>
              {memories.length} memory {memories.length === 1 ? 'package' : 'packages'}
              {memoryQueue.length > 0 && <span className="ml-2 text-secondary">· {memoryQueue.length} in queue</span>}
              {selectedMemoryId && <span className="ml-2 text-secondary">· @{selectedMemoryId}</span>}
            </>
          )}
        />
      </PageHeader>

      <div className="flex-1 px-6 py-4">
        {loading && <LoadingState label="Loading memories…" />}
        {error && <ErrorState message={`Unable to load memories: ${error}`} />}

        {!loading && !error && memories.length === 0 && memoryQueue.length === 0 && (
          <EmptyState
            title="No memories yet."
            body="Distill a conversation message to create or update a durable memory package."
          />
        )}

        {!loading && !error && (memories.length > 0 || memoryQueue.length > 0) && (
          <div className="space-y-6 pb-5">
            {memoryQueue.length > 0 && (
              <div className="space-y-2">
                <p className="ui-section-label">Memory work queue</p>
                <p className="ui-card-meta">Memory distillation runs that are still active or did not finish cleanly.</p>
                <div className="space-y-px">
                  {memoryQueue.map((item) => (
                    <ListLinkRow
                      key={item.runId}
                      to={memoryWorkItemHref(item)}
                      leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${memoryWorkItemDotClass(item)}`} />}
                    >
                      <p className="ui-row-title">{item.conversationTitle}</p>
                      <p className="ui-row-summary">{item.lastError || memoryWorkItemLabel(item)}</p>
                      <div className="ui-row-meta flex flex-wrap items-center gap-1.5">
                        <span>{item.status}</span>
                        <span className="opacity-40">·</span>
                        <span className="font-mono" title={item.runId}>{item.runId}</span>
                        <span className="opacity-40">·</span>
                        <span>{timeAgo(item.updatedAt)}</span>
                      </div>
                    </ListLinkRow>
                  ))}
                </div>
              </div>
            )}

            {memories.length > 0 && (
              <>
                <div className="space-y-2">
                  <p className="ui-section-label">Memory packages</p>
                  <p className="ui-card-meta max-w-3xl">
                    Memory packages mirror skills: each package has a `MEMORY.md` overview plus package-local `references/` and `assets/`.
                    Search package metadata and reference content below, then inspect the selected package in the right panel.
                  </p>
                </div>

                <div className="space-y-2 border-t border-border-subtle pt-5">
                  <label htmlFor="memories-search" className="ui-section-label">Search packages</label>
                  <input
                    id="memories-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search packages, summaries, tags, metadata, or reference content"
                    className={INPUT_CLASS}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="ui-card-meta">
                    {query.trim()
                      ? `Showing ${filteredMemories.length} of ${memories.length} packages.`
                      : `Showing ${memories.length} packages.`}
                    {' '}Select a package to browse its `MEMORY.md`, relationships, and package-local references in the right panel.
                  </p>
                </div>

                {selectedMemory && (
                  <div className="space-y-1 border-t border-border-subtle pt-5">
                    <p className="ui-section-label">Selected package</p>
                    <p className="text-[15px] font-medium text-primary">{selectedMemory.title}</p>
                    <p className="ui-card-meta">
                      {formatReferenceCount(selectedMemory.referenceCount)}
                      {selectedMemory.role && <span> · {selectedMemory.role}</span>}
                      {selectedMemory.area && <span> · {selectedMemory.area}</span>}
                      {formatRelatedCount(selectedMemory.related) && <span> · {formatRelatedCount(selectedMemory.related)}</span>}
                      {selectedMemory.updated && <span> · updated {timeAgo(selectedMemory.updated)}</span>}
                    </p>
                  </div>
                )}

                {filteredMemories.length > 0 ? (
                  <div className="space-y-px border-t border-border-subtle pt-5">
                    {filteredMemories.map((memory) => {
                      const isSelected = memory.id === selectedMemoryId;
                      const href = `/memories${buildMemorySearch(location.search, memory.id)}`;
                      const tagsSummary = memory.tags.slice(0, 3).join(' · ');
                      const relatedSummary = memory.related?.slice(0, 3).map((item) => `@${item}`).join(' · ') ?? '';

                      return (
                        <ListLinkRow
                          key={memory.id}
                          to={href}
                          selected={isSelected}
                          leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${memoryDotClass(memory)}`} />}
                        >
                          <p className="ui-row-title">{memory.title}</p>
                          <p className="ui-row-summary">{memory.summary || '(no summary)'}</p>
                          <div className="ui-row-meta flex flex-wrap items-center gap-1.5">
                            <span>{formatReferenceCount(memory.referenceCount)}</span>
                            {memory.role && (
                              <>
                                <span className="opacity-40">·</span>
                                <span>{memory.role}</span>
                              </>
                            )}
                            {memory.area && (
                              <>
                                <span className="opacity-40">·</span>
                                <span>{memory.area}</span>
                              </>
                            )}
                            {memory.type && (
                              <>
                                <span className="opacity-40">·</span>
                                <span>{memory.type}</span>
                              </>
                            )}
                            {memory.status && (
                              <>
                                <span className="opacity-40">·</span>
                                <span>{memory.status}</span>
                              </>
                            )}
                            <span className="opacity-40">·</span>
                            <span className="max-w-[18rem] truncate font-mono" title={`@${memory.id}`}>@{memory.id}</span>
                            {memory.updated && (
                              <>
                                <span className="opacity-40">·</span>
                                <span>{timeAgo(memory.updated)}</span>
                              </>
                            )}
                            {tagsSummary && (
                              <>
                                <span className="opacity-40">·</span>
                                <span className="max-w-[20rem] truncate" title={memory.tags.join(', ')}>{tagsSummary}</span>
                              </>
                            )}
                          </div>
                          {(memory.parent || relatedSummary) && (
                            <div className="ui-row-meta flex flex-wrap items-center gap-1.5">
                              {memory.parent && (
                                <>
                                  <span>parent</span>
                                  <span className="font-mono" title={`@${memory.parent}`}>@{memory.parent}</span>
                                </>
                              )}
                              {memory.parent && relatedSummary && <span className="opacity-40">·</span>}
                              {relatedSummary && (
                                <>
                                  <span>related</span>
                                  <span className="max-w-[22rem] truncate font-mono" title={relatedSummary}>{relatedSummary}</span>
                                </>
                              )}
                            </div>
                          )}
                        </ListLinkRow>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    title="No matches"
                    body="Try a broader search across package titles, summaries, tags, metadata, and package-local reference content."
                    action={<ToolbarButton onClick={() => setQuery('')}>Clear search</ToolbarButton>}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
