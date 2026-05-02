import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { useConversations } from '../hooks/useConversations';
import type { MemoryDocItem } from '../types';
import { timeAgo } from '../utils';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PageHeading,
  ToolbarButton,
  cx,
} from '../components/ui';

const MEMORY_ID_SEARCH_PARAM = 'memory';
const SEARCH_INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary placeholder:text-dim outline-none transition-colors focus:border-accent/60';
const ACTION_BUTTON_CLASS = 'inline-flex items-center rounded-lg border border-border-subtle bg-base px-3 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-surface disabled:opacity-50';

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
      memory.searchText,
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

interface NoticeState {
  tone: 'accent' | 'danger';
  text: string;
}

export function MemoriesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { openSession } = useConversations();
  const {
    data,
    loading,
    refreshing,
    error,
    refetch,
  } = useApi(api.memories);

  const [query, setQuery] = useState('');
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailReloadToken, setDetailReloadToken] = useState(0);
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const memories = data?.memories ?? [];
  const filteredMemories = useMemo(() => filterMemories(memories, query), [memories, query]);
  const selectedMemoryId = useMemo(() => {
    const value = new URLSearchParams(location.search).get(MEMORY_ID_SEARCH_PARAM);
    return value?.trim() || null;
  }, [location.search]);
  const selectedMemory = useMemo(
    () => memories.find((memory) => memory.id === selectedMemoryId) ?? null,
    [memories, selectedMemoryId],
  );
  const dirty = content !== savedContent;

  const setSelectedMemory = useCallback((memoryId: string | null, replace = false) => {
    const nextSearch = buildMemorySearch(location.search, memoryId);
    navigate(`/memories${nextSearch}`, { replace });
  }, [location.search, navigate]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (selectedMemoryId && memories.some((memory) => memory.id === selectedMemoryId)) {
      return;
    }

    const fallback = filteredMemories[0]?.id ?? memories[0]?.id ?? null;
    if (fallback !== selectedMemoryId) {
      setSelectedMemory(fallback, true);
    }
  }, [filteredMemories, loading, memories, selectedMemoryId, setSelectedMemory]);

  useEffect(() => {
    if (!selectedMemoryId) {
      setContent('');
      setSavedContent('');
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    api.memoryDoc(selectedMemoryId)
      .then((detail) => {
        if (cancelled) {
          return;
        }

        setContent(detail.content);
        setSavedContent(detail.content);
        if (detail.memory.id !== selectedMemoryId) {
          setSelectedMemory(detail.memory.id, true);
        }
      })
      .catch((fetchError) => {
        if (cancelled) {
          return;
        }

        const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
        setDetailError(message);
        setContent('');
        setSavedContent('');
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedMemoryId, setSelectedMemory, detailReloadToken]);

  async function handleRefresh() {
    await refetch({ resetLoading: false });
    setDetailReloadToken((value) => value + 1);
  }

  function handleSelect(memoryId: string) {
    if (memoryId === selectedMemoryId) {
      return;
    }

    if (dirty && !window.confirm('Discard unsaved memory edits and switch selection?')) {
      return;
    }

    setNotice(null);
    setSelectedMemory(memoryId);
  }

  async function handleSave() {
    if (!selectedMemoryId || saveBusy || !dirty) {
      return;
    }

    setSaveBusy(true);
    setNotice(null);
    try {
      const result = await api.saveMemoryDoc(selectedMemoryId, content);
      setContent(result.content);
      setSavedContent(result.content);
      await refetch({ resetLoading: false });
      if (result.memory.id !== selectedMemoryId) {
        setSelectedMemory(result.memory.id, true);
      }
      setDetailReloadToken((value) => value + 1);
      setNotice({ tone: 'accent', text: `Saved @${result.memory.id}.` });
    } catch (saveError) {
      setNotice({ tone: 'danger', text: saveError instanceof Error ? saveError.message : String(saveError) });
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleDelete() {
    if (!selectedMemory || deleteBusy) {
      return;
    }

    if (!window.confirm(`Delete memory @${selectedMemory.id}? This cannot be undone.`)) {
      return;
    }

    setDeleteBusy(true);
    setNotice(null);
    try {
      await api.deleteMemoryDoc(selectedMemory.id);
      await refetch({ resetLoading: false });
      setDetailReloadToken((value) => value + 1);
      setNotice({ tone: 'accent', text: `Deleted @${selectedMemory.id}.` });
      setSelectedMemory(null, true);
    } catch (deleteError) {
      setNotice({ tone: 'danger', text: deleteError instanceof Error ? deleteError.message : String(deleteError) });
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleStartConversation() {
    if (!selectedMemory || startBusy) {
      return;
    }

    setStartBusy(true);
    setNotice(null);
    try {
      const result = await api.startMemoryConversation(selectedMemory.id);
      openSession(result.id);
      navigate(`/conversations/${encodeURIComponent(result.id)}`);
    } catch (startError) {
      setNotice({ tone: 'danger', text: startError instanceof Error ? startError.message : String(startError) });
    } finally {
      setStartBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={(
          <ToolbarButton onClick={() => { void handleRefresh(); }} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </ToolbarButton>
        )}
      >
        <PageHeading
          title="Memories"
          meta={`${memories.length} memory ${memories.length === 1 ? 'doc' : 'docs'} · search, edit, start, or delete`}
        />
      </PageHeader>

      <div className="flex min-h-0 flex-1 border-t border-border-subtle">
        <section className="flex min-h-0 w-[23rem] max-w-[45%] flex-col border-r border-border-subtle">
          <div className="space-y-2 px-4 py-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search memories"
              className={SEARCH_INPUT_CLASS}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[11px] text-dim">
              {query.trim()
                ? `Showing ${filteredMemories.length} of ${memories.length}.`
                : `Showing ${memories.length} memories.`}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-subtle">
            {loading && <LoadingState label="Loading memories…" className="px-4 py-6" />}
            {error && <ErrorState className="m-4" message={`Unable to load memories: ${error}`} />}

            {!loading && !error && filteredMemories.length === 0 && (
              <EmptyState
                className="px-4 py-8"
                title={query.trim() ? 'No matches' : 'No memories yet'}
                body={query.trim()
                  ? 'Try a broader query.'
                  : 'Distill a conversation message to create durable memory.'}
              />
            )}

            {!loading && !error && filteredMemories.map((memory) => {
              const isSelected = memory.id === selectedMemoryId;
              return (
                <button
                  key={memory.id}
                  type="button"
                  onClick={() => handleSelect(memory.id)}
                  className={cx(
                    'w-full border-b border-border-subtle/70 px-4 py-3 text-left transition-colors',
                    isSelected ? 'bg-elevated' : 'hover:bg-elevated/45',
                  )}
                >
                  <p className="truncate text-[13px] font-medium text-primary">{memory.title}</p>
                  <p className="mt-1 truncate text-[11px] text-secondary">{memory.summary || '(no summary)'}</p>
                  <p className="mt-1 truncate text-[10px] font-mono text-dim/80">
                    @{memory.id}
                    {memory.updated ? ` · ${timeAgo(memory.updated)}` : ''}
                    {memory.type ? ` · ${memory.type}` : ''}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col">
          {!selectedMemory && !loading ? (
            <EmptyState
              className="h-full"
              title="Select a memory"
              body="Pick a memory from the left to edit its markdown file, start a conversation from it, or delete it."
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[14px] font-semibold text-primary">{selectedMemory?.title ?? 'Memory'}</h2>
                  <p className="truncate text-[11px] font-mono text-dim">{selectedMemory?.path ?? ''}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className={ACTION_BUTTON_CLASS}
                    onClick={() => { void handleStartConversation(); }}
                    disabled={!selectedMemory || startBusy || detailLoading}
                  >
                    {startBusy ? 'Starting…' : 'Start convo'}
                  </button>
                  <button
                    type="button"
                    className={ACTION_BUTTON_CLASS}
                    onClick={() => { void handleSave(); }}
                    disabled={!selectedMemory || !dirty || saveBusy || detailLoading}
                  >
                    {saveBusy ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className={cx(ACTION_BUTTON_CLASS, 'text-danger hover:text-danger')}
                    onClick={() => { void handleDelete(); }}
                    disabled={!selectedMemory || deleteBusy}
                  >
                    {deleteBusy ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>

              {notice && (
                <p className={cx(
                  'border-b border-border-subtle px-4 py-2 text-[12px]',
                  notice.tone === 'danger' ? 'text-danger' : 'text-accent',
                )}
                >
                  {notice.text}
                </p>
              )}

              {detailLoading ? (
                <LoadingState label="Loading memory content…" className="h-full" />
              ) : detailError ? (
                <ErrorState className="m-4" message={detailError} />
              ) : (
                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                      event.preventDefault();
                      void handleSave();
                    }
                  }}
                  className="h-full min-h-0 w-full flex-1 resize-none bg-base px-4 py-3 font-mono text-[12px] leading-relaxed text-primary outline-none"
                  spellCheck={false}
                />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
