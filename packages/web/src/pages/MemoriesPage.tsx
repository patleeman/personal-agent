import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  NodeIconActionButton,
  NodePropertyList,
  NodeRailSection,
  NodeToolbarGroup,
  NodeWorkspaceShell,
  WorkspaceActionNotice,
} from '../components/NodeWorkspace';
import {
  buildNoteSearch,
  filterMemories,
  NOTE_ID_SEARCH_PARAM,
  noteKindLabel,
  readCreateState,
} from '../noteWorkspaceState';
import { buildNodesSearch } from '../nodeWorkspaceState';
import { readEditableNoteBody } from '../noteDocument';
import { normalizeMarkdownValue } from '../markdownDocument';
import { buildOpenNodeShelfId, ensureOpenResourceShelfItem } from '../openResourceShelves';
import { NodeLinkList, UnresolvedNodeLinks } from '../components/NodeLinksSection';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const NOTE_STATUS_OPTIONS = ['inbox', 'active', 'draft', 'archived', 'ignored'] as const;

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
      return 'Queued for page distillation';
    case 'waiting':
      return 'Waiting to resume page distillation';
    case 'recovering':
      return 'Recovering page distillation';
    default:
      return 'Distilling into a note page';
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
      setQueueError(retryError instanceof Error ? retryError.message : 'Could not retry page distillation.');
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
          <p className="text-[13px] font-medium text-primary">Distillation runs</p>
          <p className="text-[12px] text-secondary">Explicit note distillation and recovery runs.</p>
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
              ? 'Queueing page distillation…'
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
                    title="Retry this page distillation"
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
  const referenceCount = memory.referenceCount ?? 0;
  const recentSessionCount = memory.recentSessionCount ?? 0;

  return {
    primary: referenceCount > 0 ? `${referenceCount} ${referenceCount === 1 ? 'reference' : 'references'}` : 'Document',
    secondary: memory.usedInLastSession
      ? 'Used recently'
      : recentSessionCount > 0
        ? `${recentSessionCount} recent ${recentSessionCount === 1 ? 'chat' : 'chats'}`
        : null,
  };
}

function NotesTable({
  memories,
  locationSearch,
}: {
  memories: MemoryDocItem[];
  locationSearch: string;
}) {
  const navigate = useNavigate();

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

function NoteWorkspaceIcon({ paths }: { paths: string[] }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

function NoteReferenceList({
  references,
}: {
  references: Array<{ title: string; summary: string; relativePath: string }>;
}) {
  if (references.length === 0) {
    return <p className="text-[12px] text-secondary">No supporting references yet.</p>;
  }

  return (
    <div className="space-y-px">
      {references.map((reference) => (
        <div key={reference.relativePath} className="ui-list-row -mx-1 px-2 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-primary">{reference.title}</p>
            <p className="mt-0.5 text-[11px] text-dim">{reference.relativePath}</p>
            {reference.summary ? <p className="mt-1 text-[12px] leading-relaxed text-secondary">{reference.summary}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function normalizeNoteCustomTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of tags) {
    const value = entry.trim();
    if (!value || /^parent:/i.test(value) || /^status:/i.test(value) || /^type:note$/i.test(value) || /^notetype:/i.test(value)) {
      continue;
    }

    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(value);
  }

  return normalized.sort((left, right) => left.localeCompare(right));
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function humanizeNoteStatus(status: string): string {
  const normalized = status.replace(/[_-]+/g, ' ').trim();
  if (!normalized) {
    return 'Unknown';
  }
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function NotePropertiesPanel({
  nodeId,
  onChanged,
}: {
  nodeId: string;
  onChanged?: () => void;
}) {
  const detailApi = useApi(() => api.nodeDetail(nodeId), `note-properties:${nodeId}`);
  const nodesApi = useApi(api.nodes, 'note-property-options');
  const node = detailApi.data?.node ?? null;
  const [status, setStatus] = useState('active');
  const [parent, setParent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!node) {
      return;
    }

    setStatus(node.status || 'active');
    setParent(node.parent ?? '');
    setTags(normalizeNoteCustomTags(node.tags));
    setTagInput('');
    setSaveError(null);
    setSaveNotice(null);
  }, [node]);

  const parentOptions = useMemo(() => {
    return (nodesApi.data?.nodes ?? [])
      .filter((candidate) => candidate.id !== nodeId)
      .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  }, [nodeId, nodesApi.data?.nodes]);
  const parentMatch = useMemo(
    () => parentOptions.find((candidate) => candidate.id === parent.trim().toLowerCase()) ?? null,
    [parent, parentOptions],
  );
  const tagSuggestions = useMemo(() => {
    const allTags = (nodesApi.data?.nodes ?? []).flatMap((candidate) => candidate.tags);
    return normalizeNoteCustomTags(allTags);
  }, [nodesApi.data?.nodes]);
  const filteredTagSuggestions = useMemo(() => {
    const selected = new Set(tags.map((entry) => entry.toLowerCase()));
    const query = tagInput.trim().toLowerCase();
    return tagSuggestions
      .filter((entry) => !selected.has(entry.toLowerCase()))
      .filter((entry) => query.length === 0 || entry.toLowerCase().includes(query))
      .slice(0, 8);
  }, [tagInput, tagSuggestions, tags]);
  const savedTags = useMemo(() => normalizeNoteCustomTags(node?.tags ?? []), [node?.tags]);
  const normalizedTags = useMemo(() => normalizeNoteCustomTags(tags), [tags]);
  const normalizedParent = parent.trim().toLowerCase();
  const statusOptions = useMemo(() => {
    const options = new Set<string>(NOTE_STATUS_OPTIONS);
    if (node?.status?.trim()) {
      options.add(node.status.trim());
    }
    return [...options].sort((left, right) => left.localeCompare(right));
  }, [node?.status]);
  const dirty = Boolean(node) && (
    status !== (node?.status || 'active')
    || normalizedParent !== (node?.parent ?? '')
    || !sameStringArray(normalizedTags, savedTags)
  );

  const addTag = useCallback((value: string) => {
    const nextValue = value.trim();
    if (!nextValue) {
      return;
    }

    setTags((current) => normalizeNoteCustomTags([...current, nextValue]));
    setTagInput('');
    setSaveError(null);
    setSaveNotice(null);
  }, []);

  const removeTag = useCallback((value: string) => {
    setTags((current) => current.filter((entry) => entry.toLowerCase() !== value.toLowerCase()));
    setSaveError(null);
    setSaveNotice(null);
  }, []);

  const handleTagInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' && event.key !== ',') {
      return;
    }

    event.preventDefault();
    addTag(tagInput);
  }, [addTag, tagInput]);

  const handleSave = useCallback(async () => {
    if (!node || !dirty || saveBusy) {
      return;
    }

    if (normalizedParent && !parentOptions.some((candidate) => candidate.id === normalizedParent)) {
      setSaveError('Choose an existing parent page.');
      setSaveNotice(null);
      return;
    }

    setSaveBusy(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const removeTags = savedTags.filter((tag) => !normalizedTags.includes(tag));
      if (status !== 'inbox' && node.tags.some((tag) => /^notetype:capture$/i.test(tag))) {
        removeTags.push('noteType:capture');
      }

      await api.saveNodeDetail(node.id, {
        status,
        parent: normalizedParent || null,
        addTags: normalizedTags.filter((tag) => !savedTags.includes(tag)),
        removeTags,
      });
      await detailApi.refetch({ resetLoading: false });
      emitMemoriesChanged();
      onChanged?.();
      setSaveNotice('Saved properties.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaveBusy(false);
    }
  }, [detailApi, dirty, node, normalizedParent, normalizedTags, onChanged, parentOptions, saveBusy, savedTags, status]);

  if (!node) {
    return <p className="text-[12px] text-dim">Loading properties…</p>;
  }

  return (
    <div className="space-y-3">
      <label className="grid gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Status</span>
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setSaveError(null);
            setSaveNotice(null);
          }}
          className={INPUT_CLASS}
        >
          {statusOptions.map((value) => (
            <option key={value} value={value}>{humanizeNoteStatus(value)}</option>
          ))}
        </select>
      </label>

      <label className="grid gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Parent</span>
        <input
          list={`note-parent-options-${nodeId}`}
          value={parent}
          onChange={(event) => {
            setParent(event.target.value);
            setSaveError(null);
            setSaveNotice(null);
          }}
          className={`${INPUT_CLASS} font-mono`}
          placeholder="Search pages by id"
          spellCheck={false}
        />
        <datalist id={`note-parent-options-${nodeId}`}>
          {parentOptions.map((option) => (
            <option key={option.id} value={option.id}>{`${option.title} (${option.kind})`}</option>
          ))}
        </datalist>
        {parentMatch ? (
          <p className="text-[11px] text-secondary">{parentMatch.title} · {parentMatch.kind}</p>
        ) : parent.trim().length > 0 ? (
          <p className="text-[11px] text-dim">No matching page.</p>
        ) : null}
      </label>

      <div className="grid gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Tags</span>
        <div className="flex items-center gap-2">
          <input
            list={`note-tag-options-${nodeId}`}
            value={tagInput}
            onChange={(event) => {
              setTagInput(event.target.value);
              setSaveError(null);
            }}
            onKeyDown={handleTagInputKeyDown}
            className={INPUT_CLASS}
            placeholder="Add a tag"
            spellCheck={false}
          />
          <ToolbarButton onClick={() => addTag(tagInput)} disabled={tagInput.trim().length === 0}>Add</ToolbarButton>
        </div>
        <datalist id={`note-tag-options-${nodeId}`}>
          {tagSuggestions.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
        {filteredTagSuggestions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-secondary">
            <span className="text-dim">Suggested</span>
            {filteredTagSuggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => addTag(tag)}
                className="transition-colors hover:text-primary"
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}
        {normalizedTags.length === 0 ? (
          <p className="text-[12px] text-dim">No custom tags.</p>
        ) : (
          <div className="space-y-px">
            {normalizedTags.map((tag) => (
              <div key={tag} className="ui-list-row -mx-1 flex items-center justify-between gap-3 px-2 py-2">
                <span className="min-w-0 break-all text-[12px] text-primary">{tag}</span>
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="shrink-0 text-[12px] text-dim transition-colors hover:text-danger"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <ToolbarButton onClick={() => { void handleSave(); }} disabled={!dirty || saveBusy} className="text-accent">
          {saveBusy ? 'Saving…' : 'Save properties'}
        </ToolbarButton>
        {saveNotice ? <span className="text-[12px] text-secondary">{saveNotice}</span> : null}
      </div>
      {saveError ? <p className="text-[12px] text-danger">{saveError}</p> : null}
    </div>
  );
}

function NoteReferencesPanel({
  detail,
}: {
  detail: MemoryDocDetail;
}) {
  const supportingReferences = detail.references ?? [];
  const links = detail.links;
  const hasLinkedNodes = (links?.outgoing?.length ?? 0) > 0 || (links?.incoming?.length ?? 0) > 0 || (links?.unresolved?.length ?? 0) > 0;

  if (!hasLinkedNodes && supportingReferences.length === 0) {
    return null;
  }

  return (
    <NodeRailSection title="References">
      <div className="space-y-4">
        {hasLinkedNodes ? (
          <>
            <NodeLinkList title="Links to" items={links?.outgoing} surface="main" emptyText="This note does not reference other pages yet." />
            <NodeLinkList title="Linked from" items={links?.incoming} surface="main" emptyText="No other pages link to this note yet." />
            <UnresolvedNodeLinks ids={links?.unresolved} />
          </>
        ) : null}
        {supportingReferences.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Files</p>
            <NoteReferenceList references={supportingReferences} />
          </div>
        ) : null}
      </div>
    </NodeRailSection>
  );
}

export function NoteWorkspace({
  detail,
  onNavigate,
  onRefetched,
  onSaved,
  backHref,
  backLabel,
}: {
  detail?: MemoryDocDetail | null;
  onNavigate: (updates: { memoryId?: string | null; creating?: boolean | null }, replace?: boolean) => void;
  onRefetched?: () => void;
  onSaved: (detail: MemoryDocDetail) => void;
  backHref?: string;
  backLabel?: string;
}) {
  const isCreating = !detail;
  const memory = detail?.memory;
  const [savedNoteTitle, setSavedNoteTitle] = useState(memory?.title ?? '');
  const [savedNoteDescription, setSavedNoteDescription] = useState(memory?.description ?? '');
  const [savedNoteBody, setSavedNoteBody] = useState(memory ? normalizeMarkdownValue(readEditableNoteBody(detail.content, memory.title)) : '');
  const [noteTitle, setNoteTitle] = useState(memory?.title ?? '');
  const [noteDescription, setNoteDescription] = useState(memory?.description ?? '');
  const [noteBody, setNoteBody] = useState(memory ? normalizeMarkdownValue(readEditableNoteBody(detail.content, memory.title)) : '');
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [promotionBusy, setPromotionBusy] = useState<'project' | 'skill' | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [notice, setNotice] = useState<{ tone: 'accent' | 'danger' | 'warning'; text: string } | null>(null);
  const lastAutoSaveSignatureRef = useRef<string | null>(null);
  const noteDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const dirty = noteTitle !== savedNoteTitle || noteDescription !== savedNoteDescription || noteBody !== savedNoteBody;

  useEffect(() => {
    if (!detail) {
      setSavedNoteTitle('');
      setSavedNoteDescription('');
      setSavedNoteBody('');
      setNoteTitle('');
      setNoteDescription('');
      setNoteBody('');
      setSaveState('idle');
      setNotice(null);
      lastAutoSaveSignatureRef.current = null;
      return;
    }
    const editableBody = normalizeMarkdownValue(readEditableNoteBody(detail.content, detail.memory.title));
    setSavedNoteTitle(detail.memory.title);
    setSavedNoteDescription(detail.memory.description ?? '');
    setSavedNoteBody(editableBody);
    setNoteTitle(detail.memory.title);
    setNoteDescription(detail.memory.description ?? '');
    setNoteBody(editableBody);
    setSaveState('idle');
    setNotice(null);
    lastAutoSaveSignatureRef.current = null;
  }, [detail]);

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
      let result: MemoryDocDetail;
      if (isCreating) {
        result = await api.createNoteDoc({
          title: nextTitle,
          description: noteDescription,
          body: noteBody,
        });
      } else {
        result = await api.saveNoteDoc(memory!.id, {
          title: nextTitle,
          description: noteDescription,
          body: noteBody,
        });
      }
      setSavedNoteTitle(noteTitle);
      setSavedNoteDescription(noteDescription);
      setSavedNoteBody(noteBody);
      setSaveState('saved');
      setNotice(null);
      if (isCreating) {
        onNavigate({ memoryId: result.memory.id, creating: false }, true);
      } else if (result.memory.id !== memory!.id) {
        onNavigate({ memoryId: result.memory.id, creating: false }, true);
      }
      onSaved(result);
      return true;
    } catch (error) {
      setSaveState('error');
      setNotice({ tone: 'danger', text: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      setSaveBusy(false);
    }
  }, [dirty, isCreating, memory, noteBody, noteDescription, noteTitle, onNavigate, onSaved, saveBusy]);

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
    const autoSaveSignature = `${nextTitle}\u0000${noteDescription}\u0000${noteBody}`;
    if (!dirty || saveBusy || deleteBusy || startBusy || nextTitle.length === 0 || lastAutoSaveSignatureRef.current === autoSaveSignature) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      lastAutoSaveSignatureRef.current = autoSaveSignature;
      void handleSave({ automated: true });
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [deleteBusy, dirty, handleSave, noteBody, noteDescription, noteTitle, saveBusy, startBusy]);

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

  useEffect(() => {
    const element = noteDescriptionRef.current;
    if (!element) {
      return;
    }

    element.style.height = 'auto';
    const nextHeight = Math.max(52, Math.min(element.scrollHeight, 220));
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > 220 ? 'auto' : 'hidden';
  }, [noteDescription]);

  function handleReload() {
    if (isCreating) {
      return;
    }
    setNotice(null);
    setSaveState('idle');
    lastAutoSaveSignatureRef.current = null;
    onRefetched?.();
  }

  async function handleDelete() {
    if (deleteBusy || isCreating || !memory) {
      return;
    }

    if (!window.confirm(`Delete note page @${memory.id}?`)) {
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
    if (startBusy || isCreating || !memory) {
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

  async function handlePromoteToProject() {
    if (promotionBusy || isCreating || !memory) {
      return;
    }

    setPromotionBusy('project');
    setNotice(null);
    try {
      const created = await api.createProject({
        title: noteTitle.trim(),
        description: noteDescription.trim() || noteTitle.trim(),
        summary: noteDescription.trim() || noteTitle.trim(),
        documentContent: noteBody.trim(),
      });
      await api.saveNodeDetail(created.project.id, {
        relationships: [{ type: 'derived-from', targetId: memory.id }],
      });
      emitProjectsChanged();
      window.location.assign(`/pages${buildNodesSearch('', { kind: 'project', nodeId: created.project.id })}`);
    } catch (error) {
      setNotice({ tone: 'danger', text: error instanceof Error ? error.message : String(error) });
      setPromotionBusy(null);
    }
  }

  async function handlePromoteToSkill() {
    if (promotionBusy || isCreating || !memory) {
      return;
    }

    setPromotionBusy('skill');
    setNotice(null);
    try {
      const created = await api.createSkill({
        title: noteTitle.trim(),
        description: noteDescription.trim() || noteTitle.trim(),
        body: noteBody.trim(),
      });
      await api.saveNodeDetail(created.skill.name, {
        relationships: [{ type: 'derived-from', targetId: memory.id }],
      });
      window.location.assign(`/pages${buildNodesSearch('', { kind: 'skill', nodeId: created.skill.name })}`);
    } catch (error) {
      setNotice({ tone: 'danger', text: error instanceof Error ? error.message : String(error) });
      setPromotionBusy(null);
    }
  }

  const saveStatus = saveBusy
    ? { text: isCreating ? 'Creating…' : 'Saving…', className: 'text-accent' }
    : noteTitle.trim().length === 0
      ? { text: 'Title required to save', className: 'text-warning' }
      : dirty
        ? { text: 'Unsaved changes', className: 'text-warning' }
        : saveState === 'error'
          ? { text: 'Autosave failed', className: 'text-danger' }
          : { text: 'All changes saved', className: 'text-dim' };

  const noteDetails = memory ? [
    { label: 'Reference', value: <span className="font-mono text-[12px]">@{memory.id}</span> },
    ...(memory.updated ? [{ label: 'Updated', value: timeAgo(memory.updated) }] : []),
    ...(memory.path ? [{ label: 'Path', value: <span className="break-all font-mono text-[12px] leading-6 text-secondary">{memory.path}</span> }] : []),
  ] : [];

  return (
    <NodeWorkspaceShell
      breadcrumbs={(
        <>
          <span>Notes</span>
          <span className="opacity-40">›</span>
          {memory ? (
            <span className="font-mono text-secondary">@{memory.id}</span>
          ) : (
            <span className="font-medium text-primary">New note</span>
          )}
        </>
      )}
      backHref={backHref}
      backLabel={backLabel}
      title={(
        <input
          aria-label="Note title"
          name="note-title"
          autoComplete="off"
          spellCheck={false}
          value={noteTitle}
          onChange={(event) => setNoteTitle(event.target.value)}
          className="ui-node-title-input"
          placeholder="Note title"
        />
      )}
      titleAs="div"
      summaryClassName="max-w-4xl"
      summary={(
        <textarea
          ref={noteDescriptionRef}
          aria-label="Note guidance for the agent"
          name="note-description"
          value={noteDescription}
          onChange={(event) => setNoteDescription(event.target.value)}
          placeholder="Tell the agent how to use this note, when to read it, or what it is for."
          className="ui-note-header-textarea"
          rows={1}
        />
      )}
      status={<span className={saveStatus.className}>{saveStatus.text}</span>}
      actions={(
        <NodeToolbarGroup>
          <NodeIconActionButton onClick={handleReload} disabled={saveBusy || isCreating} title="Reload note" aria-label="Reload note">
            <NoteWorkspaceIcon paths={["M20 11a8 8 0 1 0 2.3 5.7", "M20 4v7h-7"]} />
          </NodeIconActionButton>
          <NodeIconActionButton
            onClick={() => { void handleSave(); }}
            disabled={!dirty || saveBusy || noteTitle.trim().length === 0}
            title={saveBusy ? (isCreating ? 'Creating note' : 'Saving note') : (isCreating ? 'Create note' : 'Save note now')}
            aria-label={saveBusy ? (isCreating ? 'Creating note' : 'Saving note') : (isCreating ? 'Create note' : 'Save note now')}
            tone={dirty || saveBusy ? 'accent' : saveState === 'error' ? 'danger' : 'default'}
          >
            <NoteWorkspaceIcon paths={["M5 4h11l3 3v13H5z", "M9 4v6h6V4", "M9 20v-6h6v6"]} />
          </NodeIconActionButton>
          <NodeIconActionButton
            onClick={() => { void handleStartConversation(); }}
            disabled={startBusy || isCreating}
            title={isCreating ? 'Chat unavailable while creating' : (startBusy ? 'Starting chat from note' : 'Chat about note')}
            aria-label={isCreating ? 'Chat unavailable while creating' : (startBusy ? 'Starting chat from note' : 'Chat about note')}
            tone="accent"
          >
            <NoteWorkspaceIcon paths={["M7 10h10", "M7 14h6", "M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"]} />
          </NodeIconActionButton>
          <NodeIconActionButton
            onClick={() => { void handlePromoteToProject(); }}
            disabled={promotionBusy !== null || isCreating || noteTitle.trim().length === 0}
            title={isCreating ? 'Project promotion unavailable while creating' : (promotionBusy === 'project' ? 'Creating project from note' : 'Promote note to project')}
            aria-label={isCreating ? 'Project promotion unavailable while creating' : (promotionBusy === 'project' ? 'Creating project from note' : 'Promote note to project')}
          >
            <NoteWorkspaceIcon paths={["M7 4.75h7.5L18 8.25V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6.75a2 2 0 0 1 2-2Z", "M8 11h8", "M8 15h6"]} />
          </NodeIconActionButton>
          <NodeIconActionButton
            onClick={() => { void handlePromoteToSkill(); }}
            disabled={promotionBusy !== null || isCreating || noteTitle.trim().length === 0}
            title={isCreating ? 'Skill promotion unavailable while creating' : (promotionBusy === 'skill' ? 'Creating skill from note' : 'Promote note to skill')}
            aria-label={isCreating ? 'Skill promotion unavailable while creating' : (promotionBusy === 'skill' ? 'Creating skill from note' : 'Promote note to skill')}
          >
            <NoteWorkspaceIcon paths={["M12 3.75l7.5 4.125v8.25L12 20.25 4.5 16.125v-8.25L12 3.75Zm0 0v16.5M4.5 7.875 12 12l7.5-4.125"]} />
          </NodeIconActionButton>
          <NodeIconActionButton
            onClick={() => { void handleDelete(); }}
            disabled={deleteBusy || isCreating}
            title={isCreating ? 'Delete unavailable while creating' : (deleteBusy ? 'Deleting note' : 'Delete note')}
            aria-label={isCreating ? 'Delete unavailable while creating' : (deleteBusy ? 'Deleting note' : 'Delete note')}
            tone="danger"
          >
            <NoteWorkspaceIcon paths={["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6", "M10 11v6", "M14 11v6"]} />
          </NodeIconActionButton>
        </NodeToolbarGroup>
      )}
      notice={notice ? <WorkspaceActionNotice tone={notice.tone}>{notice.text}</WorkspaceActionNotice> : null}
      inspector={!isCreating && (
        <>
          <NodeRailSection title="Properties">
            <NotePropertiesPanel nodeId={detail.memory.id} onChanged={onRefetched} />
          </NodeRailSection>

          <details className="ui-disclosure">
            <summary className="ui-disclosure-summary">
              <span>Details</span>
              <span className="ui-disclosure-meta">Reference, path, updated</span>
            </summary>
            <div className="ui-disclosure-body">
              <NodePropertyList items={noteDetails} />
            </div>
          </details>

          <NoteReferencesPanel detail={detail} />
        </>
      )}
    >
      <div className="max-w-4xl">
        <NoteEditorDocument
          title={noteTitle}
          onTitleChange={setNoteTitle}
          description={noteDescription}
          onDescriptionChange={setNoteDescription}
          body={noteBody}
          onBodyChange={setNoteBody}
          showTitle={false}
          showDescription={false}
          frameClassName="ui-note-editor-frame-embedded"
          documentClassName="ui-note-editor-doc-embedded"
          bodyPlaceholder="Start writing… Paste, drop, or insert images."
        />
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
  const queueState = useApi(api.noteWorkQueue);

  const memories = data?.memories ?? [];
  const memoryQueue = queueState.data?.memoryQueue ?? data?.memoryQueue ?? [];
  const [query, setQuery] = useState('');
  const filteredMemories = useMemo(() => filterMemories(memories, query), [memories, query]);
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

  const navigateNotes = useCallback((updates: { memoryId?: string | null; creating?: boolean | null }, replace = false) => {
    const nextSearch = buildNoteSearch(location.search, updates);
    navigate(`/notes${nextSearch}`, { replace });
  }, [location.search, navigate]);

  useEffect(() => {
    function handleMemoriesChanged(event: Event) {
      const detail = (event as CustomEvent<{ memoryId?: string; suppressOpenDetailRefresh?: boolean }>).detail;
      void refetch({ resetLoading: false });
      if (selectedMemoryId && !(detail?.suppressOpenDetailRefresh && detail.memoryId === selectedMemoryId)) {
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

    ensureOpenResourceShelfItem('node', buildOpenNodeShelfId('note', selectedMemoryId));
  }, [selectedMemoryId]);

  if (creating) {
    return (
      <div className="min-h-0 flex h-full flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto w-full max-w-[1440px]">
            <NoteWorkspace
              detail={null}
              onNavigate={navigateNotes}
              onSaved={(created) => {
                replaceData({
                  memories: [created.memory, ...memories.filter((memory) => memory.id !== created.memory.id)],
                  memoryQueue,
                });
              }}
              backHref="/notes"
              backLabel="Back to notes"
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
                onNavigate={navigateNotes}
                onRefetched={() => {
                  void detailApi.refetch({ resetLoading: false });
                  void refetch({ resetLoading: false });
                  void queueState.refetch({ resetLoading: false });
                }}
                onSaved={(savedDetail) => {
                  replaceData({
                    memories: memories.map((memory) => (memory.id === savedDetail.memory.id ? savedDetail.memory : memory)),
                    memoryQueue,
                  });
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
              {query.trim() ? `Showing ${filteredMemories.length} of ${memories.length} notes.` : `${memories.length} notes.`}
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
              body="Try a broader search across titles, ids, and summaries."
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
