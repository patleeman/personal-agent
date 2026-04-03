import { useCallback, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { buildNodeCreateSearch, buildNodesHref, buildNodesSearch, readCreatingNode, readSelectedNode } from '../nodeWorkspaceState';
import { timeAgo } from '../utils';
import type { MemoryWorkItem, NodeBrowserSummary } from '../types';
import { BrowserRecordRow, EmptyState, ErrorState, LoadingState, ToolbarButton } from './ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

type PageFilter = 'active' | 'archived' | 'all';

function pageRecordLabel(page: NodeBrowserSummary): string {
  const archived = page.status.trim().toLowerCase() === 'archived';
  return archived ? 'Archived page' : 'Page';
}

function pageRecordAside(page: NodeBrowserSummary): string | null {
  if (page.kind === 'skill') {
    return null;
  }
  const status = page.status.trim();
  return status.length > 0 ? status : null;
}

function pageRecordMeta(page: NodeBrowserSummary): JSX.Element {
  const openTasks = page.project?.openTaskCount ?? 0;
  const doneTasks = page.project?.doneTaskCount ?? 0;

  return (
    <>
      <span className="font-mono">@{page.id}</span>
      {page.updatedAt ? (
        <>
          <span className="opacity-40">·</span>
          <span>updated {timeAgo(page.updatedAt)}</span>
        </>
      ) : null}
      {page.project ? (
        <>
          <span className="opacity-40">·</span>
          <span>{openTasks} open · {doneTasks} done</span>
        </>
      ) : null}
      {page.project?.profile ? (
        <>
          <span className="opacity-40">·</span>
          <span>{page.project.profile}</span>
        </>
      ) : null}
      {!page.project && page.note?.area ? (
        <>
          <span className="opacity-40">·</span>
          <span>{page.note.area}</span>
        </>
      ) : null}
    </>
  );
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
      return 'Vault-doc distillation failed';
    case 'interrupted':
      return 'Vault-doc distillation interrupted';
    case 'queued':
      return 'Queued for vault-doc distillation';
    case 'waiting':
      return 'Waiting to resume vault-doc distillation';
    case 'recovering':
      return 'Recovering vault-doc distillation';
    default:
      return 'Distilling into a vault doc';
  }
}

function memoryWorkItemHref(item: MemoryWorkItem): string {
  const base = `/conversations/${encodeURIComponent(item.conversationId)}`;
  return item.runId.startsWith('state:') ? base : `${base}?run=${encodeURIComponent(item.runId)}`;
}

function canRetryMemoryWorkItem(item: MemoryWorkItem): boolean {
  return !item.runId.startsWith('state:') && (item.status === 'failed' || item.status === 'interrupted');
}

function WorkQueueRow({
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
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-base px-3 py-2.5">
      <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${memoryWorkItemDotClass(item)}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <Link to={memoryWorkItemHref(item)} className="block text-[12px] font-medium text-primary transition-colors hover:text-accent">
          {memoryWorkItemLabel(item)}
        </Link>
        <p className="mt-0.5 text-[11px] text-dim">
          @{item.memoryId} · {item.status} · updated {timeAgo(item.updatedAt)}
        </p>
      </div>
      {retryable ? (
        <ToolbarButton
          onClick={() => onRetry(item)}
          disabled={actionDisabled}
          title="Retry vault-doc distillation"
        >
          {activeAction === 'retry' ? 'Retrying…' : 'Retry'}
        </ToolbarButton>
      ) : null}
    </div>
  );
}

export function PagesBrowserRail() {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PageFilter>('active');
  const [pendingQueueAction, setPendingQueueAction] = useState<{ runId: string; kind: 'retry' } | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const [startingBatchRecovery, setStartingBatchRecovery] = useState(false);
  const { data: profileState } = useApi(api.profiles);

  const selectedPageId = useMemo(() => {
    const selected = readSelectedNode(location.search);
    return selected && selected.kind !== 'skill' ? selected.id : null;
  }, [location.search]);

  const requestedViewProfile = useMemo(() => new URLSearchParams(location.search).get('viewProfile')?.trim() || null, [location.search]);
  const effectiveViewProfile = useMemo(() => {
    if (requestedViewProfile === 'all') {
      return 'all' as const;
    }
    if (!profileState) {
      return undefined;
    }
    if (requestedViewProfile && profileState.profiles.includes(requestedViewProfile)) {
      return requestedViewProfile;
    }
    return profileState.currentProfile;
  }, [profileState, requestedViewProfile]);

  const nodesState = useApi(
    () => api.nodes(effectiveViewProfile ? { profile: effectiveViewProfile } : undefined),
    effectiveViewProfile ? `rail-pages:${effectiveViewProfile}` : 'rail-pages',
  );
  const queueState = useApi(api.noteWorkQueue);

  const creating = readCreatingNode(location.search);
  const pages = useMemo(() => (nodesState.data?.nodes ?? []).filter((page) => page.kind !== 'skill'), [nodesState.data?.nodes]);
  const filteredPages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return pages.filter((page) => {
      const archived = page.status.trim().toLowerCase() === 'archived';
      if (filter === 'active' && archived) {
        return false;
      }
      if (filter === 'archived' && !archived) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return [page.id, page.title, page.summary, page.description ?? '', page.searchText].join('\n').toLowerCase().includes(normalizedQuery);
    });
  }, [filter, pages, query]);

  const memoryQueue = queueState.data?.memoryQueue ?? [];
  const recoverableQueueItems = memoryQueue.filter(canRetryMemoryWorkItem);
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? null;

  const retryMemoryWorkItem = useCallback(async (item: MemoryWorkItem) => {
    if (pendingQueueAction || item.runId.startsWith('state:')) {
      return;
    }
    setPendingQueueAction({ runId: item.runId, kind: 'retry' });
    setQueueError(null);
    setQueueNotice(null);
    try {
      const result = await api.retryNodeDistillRun(item.runId);
      navigate(`/conversations/${encodeURIComponent(result.conversationId)}?run=${encodeURIComponent(result.runId)}`);
      setQueueNotice(`Queued retry for ${item.runId}.`);
      await queueState.refetch({ resetLoading: false });
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingQueueAction(null);
    }
  }, [pendingQueueAction, queueState]);

  const recoverFailedMemoryWorkItems = useCallback(async () => {
    if (pendingQueueAction || recoverableQueueItems.length === 0) {
      return;
    }
    setStartingBatchRecovery(true);
    setQueueError(null);
    setQueueNotice(null);
    try {
      const result = await api.recoverFailedNodeDistills();
      setQueueNotice(`Started recovery run ${result.runId} for ${result.count} failed ${result.count === 1 ? 'extraction' : 'extractions'}.`);
      await queueState.refetch({ resetLoading: false });
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : 'Could not start failed page-distillation recovery.');
    } finally {
      setStartingBatchRecovery(false);
    }
  }, [pendingQueueAction, queueState, recoverableQueueItems.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-border-subtle px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-card-title">Vault docs</p>
            <p className="ui-card-meta mt-1">Browse canonical vault docs and open them in the main workspace.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/pages${buildNodeCreateSearch(location.search, { creating: true, createKind: 'note' })}`} className="ui-toolbar-button text-accent">
              New
            </Link>
            <ToolbarButton
              onClick={() => {
                void Promise.allSettled([
                  nodesState.refetch({ resetLoading: false }),
                  queueState.refetch({ resetLoading: false }),
                ]);
              }}
              disabled={nodesState.refreshing || queueState.refreshing}
            >
              {nodesState.refreshing || queueState.refreshing ? 'Refreshing…' : '↻'}
            </ToolbarButton>
          </div>
        </div>

        {profileState && Array.isArray(profileState.profiles) ? (
          <select
            value={effectiveViewProfile ?? profileState.currentProfile}
            onChange={(event) => {
              const params = new URLSearchParams(buildNodesSearch(location.search, { filter: 'page' }));
              params.set('viewProfile', event.target.value === 'all' ? 'all' : event.target.value);
              navigate(`/pages?${params.toString()}`);
            }}
            className={INPUT_CLASS}
          >
            <option value="all">All profiles</option>
            {profileState.profiles.map((profile) => (
              <option key={profile} value={profile}>{profile}</option>
            ))}
          </select>
        ) : null}

        <div className="ui-segmented-control" role="group" aria-label="Page filter">
          {(['active', 'archived', 'all'] as PageFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={filter === value ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
            >
              {value === 'active' ? 'Active' : value === 'archived' ? 'Archived' : 'All'}
            </button>
          ))}
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pages"
          className={INPUT_CLASS}
          autoComplete="off"
          spellCheck={false}
        />

        <p className="ui-card-meta">
          {query.trim() ? `Showing ${filteredPages.length} of ${pages.length}.` : `${pages.length} pages.`}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {nodesState.loading && !nodesState.data ? <LoadingState label="Loading pages…" className="px-0 py-0" /> : null}
        {nodesState.error && !nodesState.data ? <ErrorState message={`Unable to load pages: ${nodesState.error}`} className="px-0 py-0" /> : null}
        {!nodesState.loading && !nodesState.error && queueState.loading && !queueState.data ? <LoadingState label="Loading work queue…" className="px-0 py-0" /> : null}
        {!nodesState.loading && !nodesState.error && queueState.error ? <ErrorState message={`Unable to load page work queue: ${queueState.error}`} className="px-0 py-0" /> : null}

        {!nodesState.loading && !nodesState.error && memoryQueue.length > 0 ? (
          <div className="space-y-2 border-b border-border-subtle pb-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="ui-section-label">Distillation runs</p>
                <p className="ui-card-meta mt-1">Explicit page distillation and recovery runs.</p>
              </div>
              {recoverableQueueItems.length > 0 ? (
                <ToolbarButton onClick={() => { void recoverFailedMemoryWorkItems(); }} disabled={Boolean(pendingQueueAction)}>
                  {startingBatchRecovery ? 'Starting…' : 'Recover'}
                </ToolbarButton>
              ) : null}
            </div>
            {queueNotice ? <p className="text-[12px] text-secondary">{queueNotice}</p> : null}
            {queueError ? <p className="text-[12px] text-danger">{queueError}</p> : null}
            <div className="space-y-2">
              {memoryQueue.map((item) => (
                <WorkQueueRow
                  key={item.runId}
                  item={item}
                  activeAction={pendingQueueAction?.runId === item.runId ? pendingQueueAction.kind : null}
                  actionDisabled={Boolean(pendingQueueAction)}
                  onRetry={retryMemoryWorkItem}
                />
              ))}
            </div>
          </div>
        ) : null}

        {!nodesState.loading && !nodesState.error && filteredPages.length === 0 ? (
          <EmptyState
            className="py-8"
            title={pages.length === 0 ? 'No pages yet' : 'No matches'}
            body={pages.length === 0 ? 'Create a page to start building durable context.' : 'Try a broader search or another filter.'}
          />
        ) : null}

        {!nodesState.loading && !nodesState.error && filteredPages.length > 0 ? (
          <div className="space-y-1">
            {creating ? (
              <BrowserRecordRow
                to={`/pages${buildNodeCreateSearch(location.search, { creating: true, createKind: 'note' })}`}
                selected
                label="Page"
                heading="Draft page"
                summary="Create a new page in the main workspace."
                meta="Unsaved"
              />
            ) : null}
            {filteredPages.map((page) => (
              <BrowserRecordRow
                key={`${page.kind}:${page.id}`}
                to={buildNodesHref(page.kind, page.id)}
                selected={page.id === selectedPageId && !creating}
                label={pageRecordLabel(page)}
                aside={pageRecordAside(page)}
                heading={page.title}
                summary={page.summary || page.description || `@${page.id}`}
                meta={pageRecordMeta(page)}
              />
            ))}
          </div>
        ) : null}

        {selectedPage ? (
          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Selected page</p>
            <p className="ui-card-meta">Open it in the Pages workspace to edit the overview, child pages, tasks, files, and linked conversations in one place.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
