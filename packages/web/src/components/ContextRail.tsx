import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { getConversationArtifactIdFromSearch, setConversationArtifactIdInSearch } from '../conversationArtifacts';
import {
  collectConversationRunMentions,
  createConversationLiveRunId,
  getConversationRunIdFromSearch,
  setConversationRunIdInSearch,
} from '../conversationRuns';
import {
  buildDraftConversationCwdStorageKey,
  buildDraftConversationExecutionTargetStorageKey,
  DRAFT_CONVERSATION_ID,
} from '../draftConversation';
import { persistForkPromptDraft } from '../forking';
import { buildCapabilitiesSearch, getCapabilitiesPresetId, getCapabilitiesSection, getCapabilitiesTaskId, getCapabilitiesToolName } from '../capabilitiesSelection';
import { buildKnowledgeSearch, getKnowledgeInstructionPath, getKnowledgeMemoryId, getKnowledgeProjectId, getKnowledgeSection, getKnowledgeSkillName } from '../knowledgeSelection';
import { useReloadState } from '../reloadState';
import {
  getRunConnections,
  getRunHeadline,
  getRunSortTimestamp,
  getRunTimeline,
  type RunPresentationLookups,
} from '../runPresentation';
import {
  formatProjectStatus,
  isProjectArchived,
  pickAttachProjectId,
  pickFocusedProjectId,
} from '../contextRailProject';
import { useApi } from '../hooks';
import { useDurableRunStream } from '../hooks/useDurableRunStream';
import { useConversations } from '../hooks/useConversations';
import { fetchSessionDetailCached } from '../hooks/useSessions';
import { displayBlockToMessageBlock } from '../messageBlocks';
import { buildCapabilityCards, buildIdentitySummary, buildKnowledgeSections, buildMemoryPageSummary, formatUsageLabel, humanizeSkillName } from '../memoryOverview';
import { emitMemoriesChanged } from '../memoryDocEvents';
import { getSystemComponentFromSearch, getSystemComponentLabel, getSystemRunIdFromSearch } from '../systemSelection';
import { formatTaskSchedule } from '../taskSchedule';
import type {
  ActivityEntry,
  AgentToolInfo,
  ConversationAutomationWorkflowPreset,
  ConversationExecutionState,
  DurableRunDetailResult,
  LiveSessionContext,
  MemoryAgentsItem,
  MemoryData,
  MemoryDocDetail,
  MemoryDocItem,
  MemorySkillItem,
  ProjectDetail,
  ProjectRecord,
  RemoteFolderListing,
  ScheduledTaskDetail,
  ScheduledTaskSummary,
  WorkspaceChangeKind,
} from '../types';
import { formatDate, kindMeta, timeAgo } from '../utils';
import { useAppData, useAppEvents } from '../contexts';
import { emitProjectsChanged, PROJECTS_CHANGED_EVENT } from '../projectEvents';
import { CONVERSATION_PROJECTS_CHANGED_EVENT, emitConversationProjectsChanged } from '../conversationProjectEvents';
import { closeConversationTab, ensureConversationTabOpen } from '../sessionTabs';
import { completeConversationOpenPhase } from '../perfDiagnostics';
import { sessionNeedsAttention } from '../sessionIndicators';
import { ErrorState, IconButton, LoadingState, Pill, SurfacePanel } from './ui';
import { ConversationAutomationPanel } from './ConversationAutomationPanel';
import { SystemContextPanel } from './SystemContextPanel';

const ConversationArtifactPanel = lazy(() => import('./ConversationArtifactPanel').then((module) => ({ default: module.ConversationArtifactPanel })));
const ProjectDetailPanel = lazy(() => import('./ProjectDetailPanel').then((module) => ({ default: module.ProjectDetailPanel })));
const ProjectOverviewPanel = lazy(() => import('./ProjectOverviewPanel').then((module) => ({ default: module.ProjectOverviewPanel })));
const ScheduledTaskCreatePanel = lazy(() => import('./ScheduledTaskPanel').then((module) => ({ default: module.ScheduledTaskCreatePanel })));
const ScheduledTaskPanel = lazy(() => import('./ScheduledTaskPanel').then((module) => ({ default: module.ScheduledTaskPanel })));
const ToolsContextPanel = lazy(() => import('./ToolsContextPanel').then((module) => ({ default: module.ToolsContextPanel })));
const AutomationPresetPanel = lazy(() => import('./AutomationPresetPanel').then((module) => ({ default: module.AutomationPresetPanel })));
const WorkspaceRail = lazy(() => import('./WorkspaceRail').then((module) => ({ default: module.WorkspaceRail })));

function suspendRailPanel(element: React.ReactNode, label = 'Loading…') {
  return (
    <Suspense fallback={<LoadingState label={label} className="justify-center h-full" />}>
      {element}
    </Suspense>
  );
}

const CONVERSATION_RAIL_CACHE_TTL_MS = 5_000;

type ConversationRailCacheEntry<T> = {
  data: T;
  fetchedAt: number;
  versionKey: string;
};

const liveSessionContextCache = new Map<string, ConversationRailCacheEntry<LiveSessionContext>>();
const liveSessionContextInflight = new Map<string, Promise<LiveSessionContext>>();
const conversationExecutionCache = new Map<string, ConversationRailCacheEntry<ConversationExecutionState>>();
const conversationExecutionInflight = new Map<string, Promise<ConversationExecutionState>>();

function isConversationRailCacheFresh<T>(
  entry: ConversationRailCacheEntry<T> | null | undefined,
  versionKey: string,
  ttlMs = CONVERSATION_RAIL_CACHE_TTL_MS,
): boolean {
  return Boolean(entry)
    && entry?.versionKey === versionKey
    && (Date.now() - entry.fetchedAt) <= ttlMs;
}

function fetchConversationRailCacheEntry<T>(input: {
  cache: Map<string, ConversationRailCacheEntry<T>>;
  inflight: Map<string, Promise<T>>;
  key: string;
  versionKey: string;
  fetcher: () => Promise<T>;
}): Promise<T> {
  const inflightKey = `${input.key}::${input.versionKey}`;
  const inflight = input.inflight.get(inflightKey);
  if (inflight) {
    return inflight;
  }

  const request = input.fetcher()
    .then((data) => {
      input.cache.set(input.key, {
        data,
        fetchedAt: Date.now(),
        versionKey: input.versionKey,
      });
      return data;
    })
    .finally(() => {
      input.inflight.delete(inflightKey);
    });

  input.inflight.set(inflightKey, request);
  return request;
}

export function prefetchConversationRailData(input: {
  conversationId: string;
  sessionsVersion: number;
  workspaceVersion: number;
  runsVersion: number;
  executionTargetsVersion: number;
}): Promise<void> {
  const liveContextVersionKey = `${input.sessionsVersion}:${input.workspaceVersion}`;
  const executionVersionKey = `${input.executionTargetsVersion}:${input.runsVersion}`;
  const cachedContext = liveSessionContextCache.get(input.conversationId) ?? null;
  const cachedExecution = conversationExecutionCache.get(input.conversationId) ?? null;

  const requests: Promise<unknown>[] = [];
  if (!isConversationRailCacheFresh(cachedContext, liveContextVersionKey)) {
    requests.push(fetchConversationRailCacheEntry({
      cache: liveSessionContextCache,
      inflight: liveSessionContextInflight,
      key: input.conversationId,
      versionKey: liveContextVersionKey,
      fetcher: () => api.liveSessionContext(input.conversationId),
    }));
  }

  if (!isConversationRailCacheFresh(cachedExecution, executionVersionKey)) {
    requests.push(fetchConversationRailCacheEntry({
      cache: conversationExecutionCache,
      inflight: conversationExecutionInflight,
      key: input.conversationId,
      versionKey: executionVersionKey,
      fetcher: () => api.conversationExecution(input.conversationId),
    }));
  }

  return Promise.all(requests).then(() => undefined);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="ui-section-label mb-2">{title}</p>
      {children}
    </div>
  );
}

function EmptyPrompt({ text }: { text: string }) {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-8">
      <p className="text-[12px] text-dim text-center">{text}</p>
    </div>
  );
}

const MAX_VISIBLE_WORKING_TREE_CHANGES = 8;

function buildWorkspaceLink(cwd: string, file?: string | null): string {
  const params = new URLSearchParams();
  const normalizedCwd = cwd.trim();
  const normalizedFile = file?.trim() ?? '';

  if (normalizedCwd) {
    params.set('cwd', normalizedCwd);
  }

  if (normalizedFile) {
    params.set('file', normalizedFile);
  }

  const search = params.toString();
  return `/workspace${search ? `?${search}` : ''}`;
}

function workingTreeChangeShortLabel(change: WorkspaceChangeKind): string {
  switch (change) {
    case 'modified':
      return 'M';
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    case 'typechange':
      return 'T';
    case 'untracked':
      return '?';
    case 'conflicted':
      return '!';
  }
}

function WorkingTreeChangeMark({ change }: { change: WorkspaceChangeKind }) {
  const toneClass = change === 'deleted' || change === 'conflicted'
    ? 'bg-danger/12 text-danger'
    : change === 'added' || change === 'untracked'
      ? 'bg-teal/12 text-teal'
      : change === 'renamed' || change === 'copied'
        ? 'bg-accent/12 text-accent'
        : 'bg-warning/12 text-warning';

  return (
    <span className="h-4 w-4 shrink-0 text-center">
      <span className={`inline-flex h-4 w-4 items-center justify-center rounded text-[9px] font-semibold ${toneClass}`}>
        {workingTreeChangeShortLabel(change)}
      </span>
    </span>
  );
}

function ConversationExecutionPanel({ execution }: { execution: ConversationExecutionState | null }) {
  const target = execution?.target ?? null;
  const isRemote = execution?.location === 'remote' && target;

  return (
    <SurfacePanel muted className="px-3 py-3 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-[13px] font-medium text-primary break-words">{target ? target.label : 'Local agent'}</p>
          {isRemote && (
            <p className="text-[12px] font-mono text-secondary break-all">{target.sshDestination}</p>
          )}
        </div>
        <Pill tone={isRemote ? 'accent' : 'muted'}>{isRemote ? 'remote' : 'local'}</Pill>
      </div>
      {target?.description && (
        <p className="text-[12px] text-secondary break-words">{target.description}</p>
      )}
    </SurfacePanel>
  );
}

function RailHeader({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="px-4 pt-4 pb-3 border-b border-border-subtle shrink-0">
      <div className="min-w-0">
        <p className="ui-section-label">{label}</p>
        {sub && <p className="text-[12px] text-secondary mt-0.5 font-mono truncate">{sub}</p>}
      </div>
    </div>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.75 7.5A1.5 1.5 0 0 1 5.25 6h4.018a1.5 1.5 0 0 1 1.06.44l1.172 1.17a1.5 1.5 0 0 0 1.06.44h6.19a1.5 1.5 0 0 1 1.5 1.5v7.95a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V7.5Z" />
      <path d="M3.75 9.75h16.5" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20.25h9" />
      <path d="m16.875 3.375 3.75 3.75" />
      <path d="M18.75 1.5a2.652 2.652 0 1 1 3.75 3.75L7.5 20.25l-4.5 1.5 1.5-4.5L18.75 1.5Z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.25 4.5h5.25v5.25" />
      <path d="M19.5 4.5 10.5 13.5" />
      <path d="M19.5 13.5v4.125A1.875 1.875 0 0 1 17.625 19.5H6.375A1.875 1.875 0 0 1 4.5 17.625V6.375A1.875 1.875 0 0 1 6.375 4.5H10.5" />
    </svg>
  );
}

function RemoteFolderBrowser({
  listing,
  loading,
  error,
  selecting = false,
  onNavigate,
  onSelect,
  onClose,
}: {
  listing: RemoteFolderListing | null;
  loading: boolean;
  error: string | null;
  selecting?: boolean;
  onNavigate: (path: string) => void;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border-subtle bg-base px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="ui-section-label">Remote folders</p>
          <p className="mt-1 break-all font-mono text-[11px] text-secondary">{listing?.cwd ?? 'Loading…'}</p>
        </div>
        <button type="button" onClick={onClose} className="ui-toolbar-button shrink-0">Close</button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => { if (listing?.parent) onNavigate(listing.parent); }}
          disabled={loading || !listing?.parent}
          className="ui-toolbar-button"
        >
          Up
        </button>
        <button
          type="button"
          onClick={() => { if (listing) onSelect(listing.cwd); }}
          disabled={loading || !listing || selecting}
          className="ui-toolbar-button text-accent"
        >
          {selecting ? 'Using…' : 'Use this folder'}
        </button>
      </div>

      {error && <p className="text-[11px] text-danger/80">{error}</p>}
      {loading && <p className="text-[11px] text-dim animate-pulse">Loading remote folders…</p>}
      {!loading && !error && listing && listing.entries.length === 0 && (
        <p className="text-[11px] text-dim">No subdirectories found here.</p>
      )}
      {!loading && listing && listing.entries.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-border-subtle bg-surface">
          {listing.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => onNavigate(entry.path)}
              className="flex w-full items-center justify-between gap-3 border-t border-border-subtle px-3 py-2 text-left first:border-t-0 hover:bg-elevated/70"
              title={entry.path}
            >
              <span className="truncate text-[12px] text-primary">{entry.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">open</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function runStatusText(detail: DurableRunDetailResult['run']): { text: string; cls: string } {
  const status = detail.status?.status;

  if (status === 'running') return { text: 'running', cls: 'text-accent' };
  if (status === 'recovering') return { text: 'recovering', cls: 'text-warning' };
  if (status === 'completed') return { text: 'completed', cls: 'text-success' };
  if (status === 'cancelled') return { text: 'cancelled', cls: 'text-dim' };
  if (status === 'failed' || status === 'interrupted') return { text: status, cls: 'text-danger' };
  if (status === 'queued' || status === 'waiting') return { text: status, cls: 'text-dim' };
  return { text: status ?? 'unknown', cls: 'text-dim' };
}

const MEMORY_DISTILL_RUN_SOURCE_TYPE = 'conversation-memory-distill';

function formatRecoveryAction(action: string): string {
  switch (action) {
    case 'none': return 'stable';
    case 'resume': return 'resume';
    case 'rerun': return 'rerun';
    case 'attention': return 'needs attention';
    case 'invalid': return 'invalid';
    default: return action;
  }
}

function isRecoverableMemoryDistillRun(detail: DurableRunDetailResult['run']): boolean {
  return detail.manifest?.source?.type === MEMORY_DISTILL_RUN_SOURCE_TYPE
    && (detail.status?.status === 'failed' || detail.status?.status === 'interrupted');
}

function canCancelRun(detail: DurableRunDetailResult['run']): boolean {
  return detail.manifest?.kind === 'background-run' && (
    detail.status?.status === 'queued'
    || detail.status?.status === 'waiting'
    || detail.status?.status === 'running'
    || detail.status?.status === 'recovering'
  );
}

function isRefreshingRun(detail: DurableRunDetailResult['run'] | null | undefined): boolean {
  const status = detail?.status?.status;
  return status === 'queued' || status === 'waiting' || status === 'running' || status === 'recovering';
}

function RunContextPanel({ conversationId, runId, simplified = false }: { conversationId?: string; runId: string; simplified?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { tasks, sessions } = useAppData();
  const [cancelling, setCancelling] = useState(false);
  const [importingRemote, setImportingRemote] = useState(false);
  const [retryingMemoryDistill, setRetryingMemoryDistill] = useState(false);
  const [openingMemoryRecovery, setOpeningMemoryRecovery] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const lookups = useMemo<RunPresentationLookups>(() => ({ tasks, sessions }), [tasks, sessions]);
  const {
    detail,
    log,
    loading,
    error,
    reconnect,
  } = useDurableRunStream(runId, simplified ? 240 : 160);

  const closeRun = useCallback(() => {
    if (!conversationId) {
      return;
    }

    navigate({
      pathname: location.pathname,
      search: setConversationRunIdInSearch(location.search, null),
    });
  }, [conversationId, location.pathname, location.search, navigate]);

  async function handleCancel() {
    if (!detail || cancelling || !canCancelRun(detail.run)) {
      return;
    }

    setCancelling(true);
    try {
      await api.cancelDurableRun(detail.run.runId);
      reconnect();
    } finally {
      setCancelling(false);
    }
  }

  if (loading && !detail) {
    return <LoadingState label="Loading run…" className="px-4 py-4" />;
  }

  if (error && !detail) {
    return <ErrorState message={error} className="px-4 py-4" />;
  }

  if (!detail) {
    return <div className="px-4 py-4 text-[12px] text-dim">Run not found.</div>;
  }

  const run = detail.run;
  const status = runStatusText(run);
  const headline = getRunHeadline(run, lookups);
  const connections = getRunConnections(run, lookups).filter((connection) => connection.label !== 'Source file');
  const timeline = getRunTimeline(run);
  const showRecovery = run.recoveryAction !== 'none';
  const cancelable = canCancelRun(run);
  const closeSearch = conversationId ? setConversationRunIdInSearch(location.search, null) : '';
  const currentConversationPath = conversationId ? `/conversations/${encodeURIComponent(conversationId)}` : null;
  const showConversationChrome = Boolean(conversationId);
  const remoteExecution = run.remoteExecution;
  const recoverableMemoryDistill = isRecoverableMemoryDistillRun(run);

  async function handleImportRemote() {
    if (!remoteExecution || importingRemote || remoteExecution.importStatus !== 'ready') {
      return;
    }

    setActionError(null);
    setImportingRemote(true);
    try {
      await api.importRemoteRun(run.runId);
      reconnect();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not import the remote run.');
    } finally {
      setImportingRemote(false);
    }
  }

  async function handleRetryMemoryDistill() {
    if (!recoverableMemoryDistill || retryingMemoryDistill) {
      return;
    }

    setActionError(null);
    setRetryingMemoryDistill(true);
    try {
      const result = await api.retryMemoryDistillRun(run.runId);
      navigate(`/conversations/${encodeURIComponent(result.conversationId)}${setConversationRunIdInSearch('', result.runId)}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not retry the memory distillation run.');
    } finally {
      setRetryingMemoryDistill(false);
    }
  }

  async function handleRecoverMemoryDistill() {
    if (!recoverableMemoryDistill || openingMemoryRecovery) {
      return;
    }

    setActionError(null);
    setOpeningMemoryRecovery(true);
    try {
      const result = await api.recoverMemoryDistillRun(run.runId);
      persistForkPromptDraft(
        result.conversationId,
        `Help me recover memory distillation run ${run.runId}. Inspect the failure, then either retry it or finish it manually.`,
      );
      navigate(`/conversations/${encodeURIComponent(result.conversationId)}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not open a recovery conversation for this memory distillation run.');
    } finally {
      setOpeningMemoryRecovery(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 py-4 space-y-4">
        <div className={showConversationChrome ? 'flex items-center justify-between gap-2' : 'flex items-center justify-end gap-1.5'}>
          {showConversationChrome && (
            <button type="button" onClick={closeRun} className="ui-toolbar-button">
              ← Conversation
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={reconnect} className="ui-toolbar-button">
              ↻ Refresh
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="ui-card-title break-words">{headline.title}</p>
            <Pill tone={status.cls === 'text-danger' ? 'danger' : status.cls === 'text-warning' ? 'warning' : status.cls === 'text-success' ? 'success' : 'muted'}>
              {status.text}
            </Pill>
          </div>
          <p className="ui-card-meta flex flex-wrap items-center gap-1.5">
            <span>{headline.summary}</span>
            {showRecovery && (
              <>
                <span className="opacity-40">·</span>
                <span>{formatRecoveryAction(run.recoveryAction)}</span>
              </>
            )}
            {timeline[0] && (
              <>
                <span className="opacity-40">·</span>
                <span>{timeline[0].label} {timeAgo(timeline[0].at)}</span>
              </>
            )}
          </p>
        </div>

        {cancelable && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2.5">
            <p className="text-[12px] text-secondary">This run can still be cancelled.</p>
            <button type="button" onClick={() => { void handleCancel(); }} disabled={cancelling} className="ui-toolbar-button text-danger">
              {cancelling ? 'Cancelling…' : 'Cancel'}
            </button>
          </div>
        )}

        {recoverableMemoryDistill && (
          <div className="space-y-2 rounded-lg border border-border-subtle bg-surface px-3 py-3">
            <div className="space-y-1">
              <p className="ui-section-label">Memory distillation recovery</p>
              <p className="text-[12px] text-secondary">
                Retry this failed distillation or open a recovery conversation with the source transcript and failure context loaded.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => { void handleRetryMemoryDistill(); }}
                disabled={retryingMemoryDistill || openingMemoryRecovery}
                className="ui-toolbar-button text-warning"
              >
                {retryingMemoryDistill ? 'Retrying…' : 'Retry distillation'}
              </button>
              <button
                type="button"
                onClick={() => { void handleRecoverMemoryDistill(); }}
                disabled={openingMemoryRecovery || retryingMemoryDistill}
                className="ui-toolbar-button"
              >
                {openingMemoryRecovery ? 'Opening…' : 'Recover in conversation'}
              </button>
            </div>
          </div>
        )}

        {remoteExecution && (
          <div className="border-t border-border-subtle pt-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <p className="ui-section-label">Remote execution</p>
                <p className="text-[13px] text-primary break-words">{remoteExecution.targetLabel}</p>
                <p className="text-[12px] text-secondary break-words">{remoteExecution.remoteCwd}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {remoteExecution.transcriptAvailable && (
                  <a href={api.remoteRunTranscriptUrl(run.runId)} target="_blank" rel="noreferrer" className="ui-toolbar-button">
                    Transcript
                  </a>
                )}
                {remoteExecution.importStatus === 'ready' && (
                  <button type="button" onClick={() => { void handleImportRemote(); }} disabled={importingRemote} className="ui-toolbar-button text-warning">
                    {importingRemote ? 'Importing…' : 'Import'}
                  </button>
                )}
              </div>
            </div>
            {remoteExecution.prompt && <p className="text-[12px] text-secondary break-words">{remoteExecution.prompt}</p>}
            {remoteExecution.importSummary && <p className="text-[12px] text-secondary break-words">{remoteExecution.importSummary}</p>}
            {remoteExecution.importError && <p className="text-[12px] text-danger break-words">{remoteExecution.importError}</p>}
          </div>
        )}

        {connections.length > 0 && (
          <div className="border-t border-border-subtle pt-3">
            <p className="ui-section-label mb-2">Connected to</p>
            <div className="space-y-2">
              {connections.map((connection) => {
                const isCurrentConversationConnection = currentConversationPath !== null
                  && connection.label.startsWith('Conversation')
                  && connection.to === currentConversationPath;
                const detailText = isCurrentConversationConnection
                  ? ['Current conversation', connection.detail].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' · ')
                  : connection.detail;
                const connectionHref = connection.to
                  ? connection.to + (showConversationChrome && connection.label.startsWith('Conversation') ? closeSearch : '')
                  : null;

                return (
                  <div key={connection.key} className="space-y-0.5">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-dim">{connection.label}</p>
                    {isCurrentConversationConnection ? (
                      <button
                        type="button"
                        onClick={closeRun}
                        className="text-left text-[13px] text-accent hover:underline break-all"
                        title="Return to the current conversation"
                      >
                        {connection.value}
                      </button>
                    ) : connectionHref ? (
                      <Link to={connectionHref} className="text-[13px] text-accent hover:underline break-all">
                        {connection.value}
                      </Link>
                    ) : (
                      <p className="text-[13px] text-primary break-all">{connection.value}</p>
                    )}
                    {detailText && <p className="text-[12px] text-secondary break-words">{detailText}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="border-t border-border-subtle pt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="ui-section-label">Run</p>
            <p className="text-[13px] text-primary">{run.manifest?.kind ?? 'unknown kind'}</p>
            {run.manifest?.source?.type && <p className="text-[12px] text-secondary">source {run.manifest.source.type}</p>}
          </div>

          <div className="space-y-1">
            <p className="ui-section-label">Progress</p>
            <p className="text-[13px] text-primary">attempt {run.status?.activeAttempt ?? 0}</p>
            {run.checkpoint?.step && <p className="text-[12px] text-secondary">checkpoint {run.checkpoint.step}</p>}
          </div>
        </div>

        {(run.status?.lastError || run.problems.length > 0) && (
          <div className="border-t border-border-subtle pt-3 space-y-3">
            {run.status?.lastError && (
              <div className="space-y-1">
                <p className="ui-section-label">Last error</p>
                <p className="text-[12px] text-danger whitespace-pre-wrap break-words">{run.status.lastError}</p>
              </div>
            )}
            {run.problems.length > 0 && (
              <div className="space-y-1">
                <p className="ui-section-label">Problems</p>
                <div className="space-y-1 text-[12px] text-danger">
                  {run.problems.map((problem) => (
                    <p key={problem}>• {problem}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {actionError && <ErrorState message={actionError} />}
        {error && <ErrorState message={error} />}
      </div>

      <div className="min-h-0 flex-1 border-t border-border-subtle px-4 pt-4 pb-4 flex flex-col gap-2">
        <p className="ui-section-label shrink-0">Output log</p>
        <pre className="min-h-0 flex-1 overflow-auto rounded-lg bg-elevated px-3 py-2.5 text-[11px] leading-relaxed text-secondary whitespace-pre-wrap break-words">
          {log?.log || '(empty)'}
        </pre>
      </div>
    </div>
  );
}

// ── Live session context ──────────────────────────────────────────────────────

function LinkedProjectOverviewPanel({
  project,
  onRemove,
  removeDisabled = false,
}: {
  project: ProjectDetail;
  onRemove?: () => void;
  removeDisabled?: boolean;
}) {
  return suspendRailPanel(
    <ProjectOverviewPanel
      project={project}
      onRemove={onRemove}
      removeDisabled={removeDisabled}
    />,
    'Loading project…',
  );
}

function DraftConversationContextPanel() {
  const [draftCwd, setDraftCwd, clearDraftCwd] = useReloadState<string>({
    storageKey: buildDraftConversationCwdStorageKey(),
    initialValue: '',
    shouldPersist: (value) => value.trim().length > 0,
  });
  const [draftTargetId] = useReloadState<string | null>({
    storageKey: buildDraftConversationExecutionTargetStorageKey(),
    initialValue: null,
    shouldPersist: (value) => typeof value === 'string' && value.trim().length > 0,
  });
  const [changingCwd, setChangingCwd] = useState(false);
  const [requestedCwd, setRequestedCwd] = useState(draftCwd);
  const [pickCwdBusy, setPickCwdBusy] = useState(false);
  const [openCwdBusy, setOpenCwdBusy] = useState(false);
  const [openCwdError, setOpenCwdError] = useState<string | null>(null);
  const [changeCwdError, setChangeCwdError] = useState<string | null>(null);
  const [remotePickerOpen, setRemotePickerOpen] = useState(false);
  const [remotePickerBusy, setRemotePickerBusy] = useState(false);
  const [remotePickerError, setRemotePickerError] = useState<string | null>(null);
  const [remotePickerListing, setRemotePickerListing] = useState<RemoteFolderListing | null>(null);

  useEffect(() => {
    if (!changingCwd) {
      setRequestedCwd(draftCwd);
    }
  }, [draftCwd, changingCwd]);

  useEffect(() => {
    setRemotePickerOpen(false);
    setRemotePickerError(null);
    setRemotePickerListing(null);
  }, [draftTargetId]);

  const hasExplicitCwd = draftCwd.trim().length > 0;
  const isRemoteDraft = typeof draftTargetId === 'string' && draftTargetId.length > 0;

  async function loadRemoteDraftFolders(pathOverride?: string) {
    if (!draftTargetId) {
      return;
    }

    setRemotePickerBusy(true);
    setRemotePickerError(null);
    try {
      const result = await api.browseRemoteFolder(
        draftTargetId,
        pathOverride ?? (draftCwd || undefined),
        draftCwd || undefined,
      );
      setRemotePickerListing(result);
    } catch (error) {
      setRemotePickerError(error instanceof Error ? error.message : 'Could not browse remote folders.');
    } finally {
      setRemotePickerBusy(false);
    }
  }

  async function pickDraftCwd() {
    if (pickCwdBusy) {
      return;
    }

    setPickCwdBusy(true);
    setOpenCwdError(null);
    setChangeCwdError(null);
    try {
      if (draftTargetId) {
        setRemotePickerOpen(true);
        await loadRemoteDraftFolders();
        return;
      }

      const result = await api.pickFolder(draftCwd || undefined);
      if (result.cancelled || !result.path) {
        return;
      }

      setDraftCwd(result.path);
      setRequestedCwd(result.path);
      setChangingCwd(false);
    } catch (error) {
      setChangeCwdError(error instanceof Error ? error.message : 'Could not choose a folder.');
    } finally {
      setPickCwdBusy(false);
    }
  }

  function selectRemoteDraftFolder(path: string) {
    setDraftCwd(path);
    setRequestedCwd(path);
    setRemotePickerOpen(false);
    setRemotePickerError(null);
    setChangingCwd(false);
  }

  async function openCwdInVscode() {
    if (!hasExplicitCwd || openCwdBusy || isRemoteDraft) {
      return;
    }

    setOpenCwdBusy(true);
    setOpenCwdError(null);
    try {
      const result = await api.run('code --reuse-window . || open -a "Visual Studio Code" .', draftCwd);
      if (result.exitCode !== 0) {
        throw new Error(result.output.trim() || 'Unable to open VS Code.');
      }
    } catch {
      setOpenCwdError('Could not open VS Code.');
    } finally {
      setOpenCwdBusy(false);
    }
  }

  function startChangingCwd() {
    setRequestedCwd(draftCwd);
    setOpenCwdError(null);
    setChangeCwdError(null);
    setRemotePickerOpen(false);
    setChangingCwd(true);
  }

  function cancelChangingCwd() {
    setRequestedCwd(draftCwd);
    setChangeCwdError(null);
    setChangingCwd(false);
  }

  function saveDraftCwd() {
    const nextCwd = requestedCwd.trim();
    setDraftCwd(nextCwd);
    setRequestedCwd(nextCwd);
    setChangeCwdError(null);
    setRemotePickerOpen(false);
    setChangingCwd(false);
  }

  function clearExplicitCwd() {
    clearDraftCwd();
    setRequestedCwd('');
    setOpenCwdError(null);
    setChangeCwdError(null);
    setRemotePickerOpen(false);
    setRemotePickerError(null);
    setChangingCwd(false);
  }

  return (
    <div className="space-y-5 px-4 py-4">
      <Section title="Working Directory">
        <SurfacePanel muted className="px-3 py-3 space-y-2.5">
          <div className="space-y-2">
            {hasExplicitCwd ? (
              <p className="ui-card-body min-w-0 overflow-x-auto whitespace-nowrap pr-1 font-mono text-primary" title={draftCwd}>{draftCwd}</p>
            ) : (
              <p className="ui-card-body min-w-0 text-dim">No working directory set.</p>
            )}
            <div className="flex items-center justify-end gap-0.5">
              {hasExplicitCwd && !changingCwd && (
                <IconButton
                  compact
                  onClick={clearExplicitCwd}
                  className="text-danger"
                  title="Clear the draft working directory"
                  aria-label="Clear the draft working directory"
                >
                  <XIcon />
                </IconButton>
              )}
              <IconButton
                compact
                onClick={() => { void pickDraftCwd(); }}
                disabled={pickCwdBusy || remotePickerBusy}
                className="text-accent"
                title={pickCwdBusy || remotePickerBusy ? 'Choosing working directory…' : isRemoteDraft ? 'Browse folders on the remote execution target' : 'Choose the initial working directory for this draft conversation'}
                aria-label={isRemoteDraft ? 'Browse folders on the remote execution target' : 'Choose the initial working directory for this draft conversation'}
              >
                <FolderIcon className={pickCwdBusy || remotePickerBusy ? 'animate-pulse' : undefined} />
              </IconButton>
              <IconButton
                compact
                onClick={startChangingCwd}
                disabled={pickCwdBusy || remotePickerBusy}
                title="Enter the working directory manually"
                aria-label="Enter the working directory manually"
              >
                <PencilIcon />
              </IconButton>
              <IconButton
                compact
                onClick={() => { void openCwdInVscode(); }}
                disabled={!hasExplicitCwd || openCwdBusy || pickCwdBusy || remotePickerBusy || isRemoteDraft}
                title={isRemoteDraft ? 'Open the remote workspace directly from the remote host instead.' : openCwdBusy ? 'Opening VS Code…' : 'Open the draft working directory in VS Code'}
                aria-label="Open the draft working directory in VS Code"
                className="shrink-0"
              >
                <ExternalLinkIcon className={openCwdBusy ? 'animate-pulse' : undefined} />
              </IconButton>
            </div>
          </div>
          {remotePickerOpen && isRemoteDraft && (
            <RemoteFolderBrowser
              listing={remotePickerListing}
              loading={remotePickerBusy}
              error={remotePickerError}
              onNavigate={(path) => { void loadRemoteDraftFolders(path); }}
              onSelect={selectRemoteDraftFolder}
              onClose={() => {
                setRemotePickerOpen(false);
                setRemotePickerError(null);
              }}
            />
          )}
          {changingCwd && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                saveDraftCwd();
              }}
            >
              <input
                autoFocus
                value={requestedCwd}
                onChange={(event) => {
                  setRequestedCwd(event.target.value);
                  if (changeCwdError) {
                    setChangeCwdError(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelChangingCwd();
                  }
                }}
                placeholder="~/workingdir/project"
                spellCheck={false}
                disabled={pickCwdBusy}
                aria-label="Draft conversation working directory"
                className="w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] font-mono text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-dim">{isRemoteDraft ? 'Browse the remote filesystem above, or enter an absolute, ~, or relative remote path here.' : 'Use the folder picker above for the default flow, or enter an absolute, ~, or relative path here.'}</p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={cancelChangingCwd}
                    disabled={pickCwdBusy}
                    className="ui-toolbar-button"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={pickCwdBusy}
                    className="ui-toolbar-button text-accent"
                  >
                    Save
                  </button>
                </div>
              </div>
            </form>
          )}
          {(openCwdError || changeCwdError) && (
            <p className="text-[11px] text-danger/80">{changeCwdError ?? openCwdError}</p>
          )}
        </SurfacePanel>
      </Section>

      <Section title="Todo list">
        <ConversationAutomationPanel conversationId={DRAFT_CONVERSATION_ID} />
      </Section>
    </div>
  );
}

function LiveSessionContextPanel({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { versions } = useAppEvents();
  const { tasks, sessions, runs, projects: projectSnapshot } = useAppData();
  const [data, setData] = useState<LiveSessionContext | null>(null);
  const [execution, setExecution] = useState<ConversationExecutionState | null>(null);
  const [fallbackProjects, setFallbackProjects] = useState<ProjectRecord[]>([]);
  const [focusedProjectId, setFocusedProjectId] = useState('');
  const [attachProjectId, setAttachProjectId] = useState('');
  const [focusedProject, setFocusedProject] = useState<ProjectDetail | null>(null);
  const [detectedRunMentions, setDetectedRunMentions] = useState<ReturnType<typeof collectConversationRunMentions>>([]);
  const [runsExpanded, setRunsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [focusedLoading, setFocusedLoading] = useState(false);
  const [pickCwdBusy, setPickCwdBusy] = useState(false);
  const [openCwdBusy, setOpenCwdBusy] = useState(false);
  const [openCwdError, setOpenCwdError] = useState<string | null>(null);
  const [changingCwd, setChangingCwd] = useState(false);
  const [requestedCwd, setRequestedCwd] = useState('');
  const [changeCwdBusy, setChangeCwdBusy] = useState(false);
  const [changeCwdError, setChangeCwdError] = useState<string | null>(null);
  const [remotePickerOpen, setRemotePickerOpen] = useState(false);
  const [remotePickerBusy, setRemotePickerBusy] = useState(false);
  const [remotePickerError, setRemotePickerError] = useState<string | null>(null);
  const [remotePickerListing, setRemotePickerListing] = useState<RemoteFolderListing | null>(null);

  const allProjects = projectSnapshot ?? fallbackProjects;
  const runRecordsById = useMemo(
    () => new Map((runs?.runs ?? []).map((run) => [run.runId, run] as const)),
    [runs],
  );
  const runsLoading = runs === null;
  const runsError = null;
  const liveContextVersionKey = `${versions.sessions}:${versions.workspace}`;
  const executionVersionKey = `${versions.executionTargets}:${versions.runs}`;

  const load = useCallback(() => {
    let cancelled = false;
    const cachedContext = liveSessionContextCache.get(id) ?? null;
    const cachedExecution = conversationExecutionCache.get(id) ?? null;
    const hasFreshContext = isConversationRailCacheFresh(cachedContext, liveContextVersionKey);
    const hasFreshExecution = isConversationRailCacheFresh(cachedExecution, executionVersionKey);

    setData(cachedContext?.data ?? null);
    setExecution(cachedExecution?.data ?? null);
    setLoading(!cachedContext);
    setError(false);

    const contextPromise = hasFreshContext && cachedContext
      ? Promise.resolve(cachedContext.data)
      : fetchConversationRailCacheEntry({
          cache: liveSessionContextCache,
          inflight: liveSessionContextInflight,
          key: id,
          versionKey: liveContextVersionKey,
          fetcher: () => api.liveSessionContext(id),
        });
    const executionPromise = hasFreshExecution && cachedExecution
      ? Promise.resolve(cachedExecution.data)
      : fetchConversationRailCacheEntry({
          cache: conversationExecutionCache,
          inflight: conversationExecutionInflight,
          key: id,
          versionKey: executionVersionKey,
          fetcher: () => api.conversationExecution(id),
        });
    const projectsPromise = projectSnapshot !== null
      ? Promise.resolve(projectSnapshot)
      : api.projects();

    Promise.all([contextPromise, executionPromise, projectsPromise])
      .then(([context, nextExecution, nextProjects]) => {
        if (cancelled) {
          return;
        }

        if (projectSnapshot === null) {
          setFallbackProjects(nextProjects);
        }

        setData(context);
        setExecution(nextExecution);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setError(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [executionVersionKey, id, liveContextVersionKey, projectSnapshot]);

  const runLookups = useMemo<RunPresentationLookups>(() => ({ tasks, sessions }), [tasks, sessions]);
  const isSessionRunning = Boolean(sessions?.find((session) => session.id === id)?.isRunning);
  const runMentionsLastFetchedAtRef = useRef(0);
  const autoExpandedConnectedRunsConversationIdRef = useRef<string | null>(null);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (loading || (!data && !execution && !error)) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      completeConversationOpenPhase(id, 'rail', {
        state: error ? 'error' : 'loaded',
        hasContext: Boolean(data),
        hasExecution: Boolean(execution),
        userMessageCount: data?.userMessages.length ?? 0,
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [data, error, execution, id, loading]);

  useEffect(() => {
    runMentionsLastFetchedAtRef.current = 0;
    autoExpandedConnectedRunsConversationIdRef.current = null;
  }, [id]);

  useEffect(() => {
    // Session detail can exceed MBs for long conversations; throttle mention scans while live.
    const minRefreshIntervalMs = isSessionRunning ? 12_000 : 0;
    const now = Date.now();
    if (minRefreshIntervalMs > 0 && (now - runMentionsLastFetchedAtRef.current) < minRefreshIntervalMs) {
      return;
    }

    runMentionsLastFetchedAtRef.current = now;
    let cancelled = false;

    fetchSessionDetailCached(id, { tailBlocks: 400 }, versions.sessions)
      .then((detail) => {
        if (cancelled) {
          return;
        }

        setDetectedRunMentions(collectConversationRunMentions(detail.blocks.map(displayBlockToMessageBlock)));
      })
      .catch(() => {
        if (!cancelled) {
          setDetectedRunMentions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, versions.sessions, isSessionRunning]);

  useEffect(() => {
    setChangingCwd(false);
    setRequestedCwd('');
    setPickCwdBusy(false);
    setChangeCwdBusy(false);
    setChangeCwdError(null);
    setOpenCwdError(null);
    setRemotePickerOpen(false);
    setRemotePickerBusy(false);
    setRemotePickerError(null);
    setRemotePickerListing(null);
    setRunsExpanded(false);
  }, [id]);

  useEffect(() => {
    if (!changingCwd) {
      setRequestedCwd(data?.cwd ?? '');
    }
  }, [data?.cwd, changingCwd]);

  useEffect(() => {
    function handleConversationProjectsChanged(event: Event) {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      if (detail?.conversationId && detail.conversationId !== id) {
        return;
      }

      load();
    }

    window.addEventListener(CONVERSATION_PROJECTS_CHANGED_EVENT, handleConversationProjectsChanged);
    return () => window.removeEventListener(CONVERSATION_PROJECTS_CHANGED_EVENT, handleConversationProjectsChanged);
  }, [id, load]);

  const relatedProjectIds = data?.relatedProjectIds ?? [];
  const remoteTargetId = execution?.location === 'remote' ? execution.targetId : null;
  const isRemoteConversation = typeof remoteTargetId === 'string' && remoteTargetId.length > 0;
  const availableProjects = allProjects.filter((project) => !relatedProjectIds.includes(project.id) && !isProjectArchived(project));
  const availableProjectIds = availableProjects.map((project) => project.id);
  const selectedAttachProject = availableProjects.find((project) => project.id === attachProjectId) ?? null;
  const selectedRunId = getConversationRunIdFromSearch(location.search);
  const currentConversationRunId = createConversationLiveRunId(id);
  const connectedBackgroundRuns = useMemo(() => {
    return [...runRecordsById.values()]
      .filter((run) => run.runId !== currentConversationRunId)
      .filter((run) => run.manifest?.kind === 'background-run')
      .filter((run) => getRunConnections(run, runLookups).some((connection) => connection.key === `conversation:${id}`))
      .sort((left, right) => {
        const leftActive = isRefreshingRun(left) ? 1 : 0;
        const rightActive = isRefreshingRun(right) ? 1 : 0;
        if (leftActive !== rightActive) {
          return rightActive - leftActive;
        }

        return getRunSortTimestamp(right).localeCompare(getRunSortTimestamp(left));
      });
  }, [currentConversationRunId, id, runLookups, runRecordsById]);
  const visibleRunMentions = useMemo(() => {
    const next: Array<{
      runId: string;
      label: string;
      meta: string;
      selected: boolean;
      kind: 'conversation' | 'connected' | 'mentioned';
    }> = [];
    const seen = new Set<string>();

    const push = (runId: string, label: string, meta: string, kind: 'conversation' | 'connected' | 'mentioned') => {
      if (seen.has(runId)) {
        return;
      }

      seen.add(runId);
      next.push({
        runId,
        label,
        meta,
        selected: selectedRunId === runId,
        kind,
      });
    };

    push(currentConversationRunId, 'Conversation run', 'Tracks this conversation state and recovery metadata.', 'conversation');

    for (const run of connectedBackgroundRuns) {
      push(run.runId, run.runId, 'Started from this conversation.', 'connected');
    }

    for (const mention of detectedRunMentions) {
      const mentionMeta = mention.mentionCount > 1
        ? `Mentioned ${mention.mentionCount} times · last seen ${timeAgo(mention.lastSeenAt)}`
        : `Mentioned ${timeAgo(mention.lastSeenAt)}`;
      push(mention.runId, mention.runId, mentionMeta, 'mentioned');
    }

    return next;
  }, [connectedBackgroundRuns, currentConversationRunId, detectedRunMentions, selectedRunId]);

  const visibleRunCards = useMemo(() => {
    return visibleRunMentions.map((mention) => {
      const record = runRecordsById.get(mention.runId);
      const headline = record ? getRunHeadline(record, runLookups) : null;
      const connections = record ? getRunConnections(record, runLookups) : [];
      const primaryConnection = connections.find((connection) => connection.label !== 'Source file');
      const status = record ? runStatusText(record) : { text: 'unresolved', cls: 'text-dim' };
      const activityAt = record?.status?.completedAt
        ?? record?.status?.updatedAt
        ?? record?.status?.startedAt
        ?? record?.manifest?.createdAt;

      return {
        mention,
        record,
        headline,
        primaryConnection,
        status,
        activityAt,
      };
    });
  }, [runLookups, runRecordsById, visibleRunMentions]);

  const activeRunCount = visibleRunCards.reduce((count, { record }) => (record && isRefreshingRun(record) ? count + 1 : count), 0);
  const runIssueCount = visibleRunCards.reduce((count, { record }) => (record && record.problems.length > 0 ? count + 1 : count), 0);
  const unresolvedRunCount = visibleRunCards.reduce((count, { record }) => (!record ? count + 1 : count), 0);
  const runSummary = useMemo(() => {
    if (runsLoading && visibleRunCards.every(({ record }) => !record)) {
      return 'Refreshing run metadata…';
    }

    const parts = [`${visibleRunCards.length} ${visibleRunCards.length === 1 ? 'run' : 'runs'}`];

    if (activeRunCount > 0) {
      parts.push(`${activeRunCount} active`);
    }

    if (runIssueCount > 0) {
      parts.push(`${runIssueCount} with issues`);
    }

    if (unresolvedRunCount > 0) {
      parts.push(`${unresolvedRunCount} unresolved`);
    }

    return parts.join(' · ');
  }, [activeRunCount, runIssueCount, runsLoading, unresolvedRunCount, visibleRunCards]);

  useEffect(() => {
    if (runsExpanded || selectedRunId || autoExpandedConnectedRunsConversationIdRef.current === id) {
      return;
    }

    const hasActiveConnectedRun = connectedBackgroundRuns.some((run) => isRefreshingRun(run));
    if (!hasActiveConnectedRun) {
      return;
    }

    autoExpandedConnectedRunsConversationIdRef.current = id;
    setRunsExpanded(true);
  }, [connectedBackgroundRuns, id, runsExpanded, selectedRunId]);

  useEffect(() => {
    const nextFocusedProjectId = pickFocusedProjectId(relatedProjectIds, focusedProjectId);
    if (nextFocusedProjectId !== focusedProjectId) {
      setFocusedProjectId(nextFocusedProjectId);
    }
  }, [focusedProjectId, relatedProjectIds]);

  useEffect(() => {
    const nextAttachProjectId = pickAttachProjectId(availableProjectIds, attachProjectId);
    if (nextAttachProjectId !== attachProjectId) {
      setAttachProjectId(nextAttachProjectId);
    }
  }, [attachProjectId, availableProjectIds]);

  useEffect(() => {
    let cancelled = false;

    if (!focusedProjectId) {
      setFocusedProject(null);
      setFocusedLoading(false);
      return () => { cancelled = true; };
    }

    setFocusedLoading(true);
    api.projectById(focusedProjectId)
      .then((detail) => {
        if (cancelled) return;
        setFocusedProject(detail);
        setFocusedLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFocusedProject(null);
        setFocusedLoading(false);
      });

    return () => { cancelled = true; };
  }, [focusedProjectId]);

  async function attachSelectedProject() {
    if (!attachProjectId || linkBusy) return;
    setLinkBusy(true);
    try {
      await api.addConversationProject(id, attachProjectId);
      emitConversationProjectsChanged(id);
      load();
    } finally {
      setLinkBusy(false);
    }
  }

  async function removeLinkedProject(projectId: string) {
    if (linkBusy) return;
    setLinkBusy(true);
    try {
      await api.removeConversationProject(id, projectId);
      emitConversationProjectsChanged(id);
      load();
    } finally {
      setLinkBusy(false);
    }
  }

  function openRun(runId: string) {
    navigate({
      pathname: location.pathname,
      search: setConversationRunIdInSearch(
        setConversationArtifactIdInSearch(location.search, null),
        runId,
      ),
    });
  }

  async function loadRemoteConversationFolders(pathOverride?: string) {
    if (!remoteTargetId || !data) {
      return;
    }

    setRemotePickerBusy(true);
    setRemotePickerError(null);
    try {
      const result = await api.browseRemoteFolder(
        remoteTargetId,
        pathOverride ?? (data.cwd || undefined),
        data.cwd || undefined,
      );
      setRemotePickerListing(result);
    } catch (error) {
      setRemotePickerError(error instanceof Error ? error.message : 'Could not browse remote folders.');
    } finally {
      setRemotePickerBusy(false);
    }
  }

  async function pickAndSubmitCwd() {
    if (!data || pickCwdBusy || changeCwdBusy) {
      return;
    }

    setPickCwdBusy(true);
    setOpenCwdError(null);
    setChangeCwdError(null);
    try {
      if (remoteTargetId) {
        setRemotePickerOpen(true);
        await loadRemoteConversationFolders();
        return;
      }

      const result = await api.pickFolder(data.cwd);
      if (result.cancelled || !result.path) {
        return;
      }

      setRequestedCwd(result.path);
      setChangingCwd(false);
      await submitCwdChange(result.path);
    } catch (error) {
      setChangeCwdError(error instanceof Error ? error.message : 'Could not choose a folder.');
    } finally {
      setPickCwdBusy(false);
    }
  }

  async function openCwdInVscode() {
    if (!data || openCwdBusy || isRemoteConversation) return;

    setOpenCwdBusy(true);
    setOpenCwdError(null);
    try {
      const result = await api.run('code --reuse-window . || open -a "Visual Studio Code" .', data.cwd);
      if (result.exitCode !== 0) {
        throw new Error(result.output.trim() || 'Unable to open VS Code.');
      }
    } catch {
      setOpenCwdError('Could not open VS Code.');
    } finally {
      setOpenCwdBusy(false);
    }
  }

  function startChangingCwd() {
    if (!data || changeCwdBusy || pickCwdBusy || remotePickerBusy) {
      return;
    }

    setRequestedCwd(data.cwd);
    setOpenCwdError(null);
    setChangeCwdError(null);
    setRemotePickerOpen(false);
    setChangingCwd(true);
  }

  function cancelChangingCwd() {
    setRequestedCwd(data?.cwd ?? '');
    setChangeCwdError(null);
    setChangingCwd(false);
  }

  async function submitCwdChange(nextCwdOverride?: string) {
    if (!data || changeCwdBusy) {
      return;
    }

    const nextCwd = (nextCwdOverride ?? requestedCwd).trim();
    if (!nextCwd) {
      setChangeCwdError('Enter a directory path.');
      return;
    }

    setChangeCwdBusy(true);
    setOpenCwdError(null);
    setChangeCwdError(null);

    try {
      const result = await api.changeConversationCwd(id, nextCwd);
      setChangingCwd(false);
      setRemotePickerOpen(false);
      setRemotePickerError(null);
      setRequestedCwd(result.cwd);

      if (!result.changed || result.id === id) {
        load();
        return;
      }

      ensureConversationTabOpen(result.id);
      closeConversationTab(id);
      emitConversationProjectsChanged(result.id);
      navigate(`/conversations/${result.id}`);
    } catch (error) {
      setChangeCwdError(error instanceof Error ? error.message : 'Could not change the working directory.');
    } finally {
      setChangeCwdBusy(false);
    }
  }

  if (loading && !data && !execution) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse">Loading…</div>;
  if (error && !data && !execution) return <div className="px-4 py-4 text-[12px] text-dim/60">Unable to load context.</div>;
  if (!data) return null;

  const gitChangeLabel = data.git
    ? (data.git.changeCount === 0 ? 'working tree clean' : `${data.git.changeCount} ${data.git.changeCount === 1 ? 'change' : 'changes'}`)
    : null;
  const workspaceBrowserLink = isRemoteConversation ? null : buildWorkspaceLink(data.cwd);
  const visibleWorkingTreeChanges = (data.git?.changes ?? []).slice(0, MAX_VISIBLE_WORKING_TREE_CHANGES);
  const hiddenWorkingTreeChangeCount = Math.max(0, (data.git?.changes.length ?? 0) - visibleWorkingTreeChanges.length);

  return (
    <div className="space-y-5 px-4 py-4">
      <Section title="Execution Environment">
        <ConversationExecutionPanel execution={execution} />
      </Section>

      <Section title="Working Directory">
        <SurfacePanel muted className="px-3 py-3 space-y-2.5">
          <div className="flex items-start gap-2">
            <p className="ui-card-body min-w-0 flex-1 overflow-x-auto whitespace-nowrap pr-1 font-mono text-primary" title={data.cwd}>{data.cwd}</p>
            <div className="flex shrink-0 items-center gap-0.5">
              <IconButton
                compact
                onClick={() => { void pickAndSubmitCwd(); }}
                disabled={pickCwdBusy || changeCwdBusy || remotePickerBusy}
                className="text-accent"
                title={pickCwdBusy || remotePickerBusy ? 'Choosing working directory…' : isRemoteConversation ? 'Browse folders on the remote execution target' : 'Choose a new working directory for this conversation'}
                aria-label={isRemoteConversation ? 'Browse folders on the remote execution target' : 'Choose a new working directory for this conversation'}
              >
                <FolderIcon className={pickCwdBusy || remotePickerBusy ? 'animate-pulse' : undefined} />
              </IconButton>
              <IconButton
                compact
                onClick={startChangingCwd}
                disabled={changingCwd || changeCwdBusy || pickCwdBusy || remotePickerBusy}
                title="Enter the working directory manually"
                aria-label="Enter the working directory manually"
              >
                <PencilIcon />
              </IconButton>
              <IconButton
                compact
                onClick={() => { void openCwdInVscode(); }}
                disabled={openCwdBusy || pickCwdBusy || changeCwdBusy || remotePickerBusy || isRemoteConversation}
                title={isRemoteConversation ? 'Open the remote workspace directly from the remote host instead.' : openCwdBusy ? 'Opening VS Code…' : 'Open current working directory in VS Code'}
                aria-label="Open current working directory in VS Code"
                className="shrink-0"
              >
                <ExternalLinkIcon className={openCwdBusy ? 'animate-pulse' : undefined} />
              </IconButton>
            </div>
          </div>
          {(data.branch || data.git || workspaceBrowserLink) && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-secondary">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                {data.branch && (
                  <div className="flex items-center gap-2">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal shrink-0">
                      <line x1="6" y1="3" x2="6" y2="15" />
                      <circle cx="18" cy="6" r="3" />
                      <circle cx="6" cy="18" r="3" />
                      <path d="M18 9a9 9 0 0 1-9 9" />
                    </svg>
                    <Pill tone="teal" mono>{data.branch}</Pill>
                  </div>
                )}
                {data.git && (
                  <span className="font-mono text-dim">
                    {gitChangeLabel}
                    {data.git.changeCount > 0 && (
                      <>
                        {' '}
                        <span className="text-success">+{data.git.linesAdded}</span>{' '}
                        <span className="text-danger">-{data.git.linesDeleted}</span>
                      </>
                    )}
                  </span>
                )}
              </div>
              {workspaceBrowserLink && (
                <Link to={workspaceBrowserLink} className="ui-toolbar-button shrink-0 text-accent">
                  Open workspace browser
                </Link>
              )}
            </div>
          )}
          {remotePickerOpen && isRemoteConversation && (
            <RemoteFolderBrowser
              listing={remotePickerListing}
              loading={remotePickerBusy}
              error={remotePickerError}
              selecting={changeCwdBusy}
              onNavigate={(path) => { void loadRemoteConversationFolders(path); }}
              onSelect={(path) => { void submitCwdChange(path); }}
              onClose={() => {
                setRemotePickerOpen(false);
                setRemotePickerError(null);
              }}
            />
          )}
          {changingCwd && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCwdChange();
              }}
            >
              <input
                autoFocus
                value={requestedCwd}
                onChange={(event) => {
                  setRequestedCwd(event.target.value);
                  if (changeCwdError) {
                    setChangeCwdError(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelChangingCwd();
                  }
                }}
                placeholder={data.cwd}
                spellCheck={false}
                disabled={changeCwdBusy || pickCwdBusy}
                aria-label="Conversation working directory"
                className="w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] font-mono text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-dim">{isRemoteConversation ? 'Browse the remote filesystem above, or enter an absolute, ~, or relative remote path here.' : 'Use the folder picker above for the default flow, or enter an absolute, ~, or relative path here.'}</p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={cancelChangingCwd}
                    disabled={changeCwdBusy || pickCwdBusy}
                    className="ui-toolbar-button"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={changeCwdBusy || pickCwdBusy}
                    className="ui-toolbar-button text-accent"
                  >
                    {changeCwdBusy ? 'Switching…' : 'Switch'}
                  </button>
                </div>
              </div>
            </form>
          )}
          {!isRemoteConversation && visibleWorkingTreeChanges.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="ui-section-label">Changed files</p>
                {hiddenWorkingTreeChangeCount > 0 && (
                  <span className="ui-card-meta">+{hiddenWorkingTreeChangeCount} more</span>
                )}
              </div>
              <div className="space-y-px">
                {visibleWorkingTreeChanges.map(({ relativePath, change }) => (
                  <Link
                    key={`${change}:${relativePath}`}
                    to={buildWorkspaceLink(data.cwd, relativePath)}
                    className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-surface/80"
                    title={`Open ${relativePath} in the workspace editor`}
                  >
                    <WorkingTreeChangeMark change={change} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-secondary group-hover:text-primary">{relativePath}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {(openCwdError || changeCwdError) && (
            <p className="text-[11px] text-danger/80">{changeCwdError ?? openCwdError}</p>
          )}
        </SurfacePanel>
      </Section>

      <Section title="Todo list">
        <ConversationAutomationPanel conversationId={id} />
      </Section>

      <Section title="Referenced projects">
        <div className="space-y-3">
          {relatedProjectIds.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              {relatedProjectIds.map((projectId) => {
                const isFocused = projectId === focusedProjectId;
                return (
                  <button
                    key={projectId}
                    onClick={() => setFocusedProjectId(projectId)}
                    className={isFocused ? 'ui-pill ui-pill-accent font-mono max-w-full truncate' : 'ui-pill ui-pill-muted font-mono hover:text-primary max-w-full truncate'}
                    title={`Focus referenced project ${projectId}`}
                  >
                    {projectId}
                  </button>
                );
              })}
            </div>
          )}

          {focusedLoading && <div className="text-[12px] text-dim animate-pulse">Loading project…</div>}
          {!focusedLoading && focusedProject && (
            <LinkedProjectOverviewPanel
              project={focusedProject}
              onRemove={() => { void removeLinkedProject(focusedProject.project.id); }}
              removeDisabled={linkBusy}
            />
          )}

          {availableProjects.length > 0 && (
            <SurfacePanel muted className="px-3 py-3 space-y-2.5">
              <p className="ui-section-label">Reference project</p>
              <div className="flex items-center gap-2">
                <select
                  value={attachProjectId}
                  onChange={(event) => setAttachProjectId(event.target.value)}
                  className="flex-1 truncate bg-base border border-border-subtle rounded-lg px-2.5 py-2 text-[12px] text-secondary focus:outline-none focus:border-accent/60"
                  aria-label="Reference project"
                  title={selectedAttachProject ? `${selectedAttachProject.title} (${selectedAttachProject.id})${selectedAttachProject.description ? ` — ${selectedAttachProject.description}` : ''}` : ''}
                >
                  {availableProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.title}</option>
                  ))}
                </select>
                <button
                  onClick={() => { void attachSelectedProject(); }}
                  disabled={!attachProjectId || linkBusy}
                  className="ui-pill ui-pill-accent disabled:opacity-40"
                >
                  {linkBusy ? 'Saving…' : 'Reference'}
                </button>
              </div>
            </SurfacePanel>
          )}

          {!focusedProject && !focusedLoading && availableProjects.length === 0 && relatedProjectIds.length === 0 && (
            <p className="text-[12px] text-dim">No projects available.</p>
          )}
        </div>
      </Section>

      <Section title="Runs">
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => setRunsExpanded((open) => !open)}
            aria-expanded={runsExpanded}
            aria-controls={`conversation-runs-${id}`}
            className={runsExpanded ? 'w-full rounded-lg border border-accent/25 bg-accent/10 px-3 py-2 text-left transition-colors' : 'w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-left transition-colors hover:border-accent/25 hover:bg-elevated/70'}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-secondary">{runSummary}</span>
              <span className={runsExpanded ? 'text-[10px] uppercase tracking-[0.14em] text-accent' : 'text-[10px] uppercase tracking-[0.14em] text-dim'}>
                {runsExpanded ? 'hide' : 'inspect'}
              </span>
            </div>
          </button>

          {runsExpanded && (
            <div id={`conversation-runs-${id}`} className="space-y-2.5">
              {runsLoading && visibleRunCards.every(({ record }) => !record) && (
                <p className="text-[11px] text-dim animate-pulse">Refreshing run metadata…</p>
              )}
              {runsError && (
                <p className="text-[11px] text-danger/80">{runsError}</p>
              )}
              {visibleRunCards.map(({ mention, record, headline, primaryConnection, status, activityAt }) => {
                const isSelected = mention.selected;
                const title = headline?.title ?? mention.label;
                const summary = headline?.summary ?? mention.meta;
                const issueCount = record?.problems.length ?? 0;
                const showRecovery = record && record.recoveryAction !== 'none';
                const timeLabel = activityAt ? timeAgo(activityAt) : null;

                return (
                  <button
                    key={mention.runId}
                    type="button"
                    onClick={() => openRun(mention.runId)}
                    className={isSelected ? 'w-full rounded-lg border border-accent/30 bg-accent/10 px-3 py-2.5 text-left transition-colors' : 'w-full rounded-lg border border-border-subtle bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/25 hover:bg-elevated/70'}
                    title={mention.runId}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-[12px] font-medium text-primary">{title}</p>
                          {mention.kind === 'conversation' && (
                            <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-dim">session</span>
                          )}
                          {mention.kind === 'connected' && (
                            <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-dim">linked</span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-secondary break-words">{summary}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
                          <span className={status.cls}>{status.text}</span>
                          {timeLabel && (
                            <>
                              <span className="opacity-35">·</span>
                              <span className="text-dim">{timeLabel}</span>
                            </>
                          )}
                          {showRecovery && record && (
                            <>
                              <span className="opacity-35">·</span>
                              <span className="text-warning">{formatRecoveryAction(record.recoveryAction)}</span>
                            </>
                          )}
                          {issueCount > 0 && (
                            <>
                              <span className="opacity-35">·</span>
                              <span className="text-danger">{issueCount} issue{issueCount === 1 ? '' : 's'}</span>
                            </>
                          )}
                        </div>
                        {primaryConnection?.detail && (
                          <p className="mt-1 text-[11px] text-dim break-words">{primaryConnection.detail}</p>
                        )}
                        <p className="mt-1 break-all font-mono text-[10px] text-dim">{mention.runId}</p>
                      </div>
                      <span className={isSelected ? 'shrink-0 text-[10px] uppercase tracking-[0.14em] text-accent' : 'shrink-0 text-[10px] uppercase tracking-[0.14em] text-dim'}>
                        {isSelected ? 'open' : 'inspect'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

// ── Task detail ───────────────────────────────────────────────────────────────

// ── Inbox item detail ─────────────────────────────────────────────────────────

function pickInboxItemConversationId(entry: Pick<ActivityEntry, 'relatedConversationIds'>): string | null {
  const relatedConversationIds = (entry.relatedConversationIds ?? [])
    .filter((conversationId): conversationId is string => typeof conversationId === 'string' && conversationId.trim().length > 0);

  return relatedConversationIds.length > 0
    ? relatedConversationIds[relatedConversationIds.length - 1] ?? null
    : null;
}

function InboxItemContext({ id }: { id: string }) {
  const navigate = useNavigate();
  const { openSession } = useConversations();
  const [entry, setEntry] = useState<ActivityEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setActionBusy(false);
    setActionError(null);

    api.activityById(id)
      .then((nextEntry) => {
        if (cancelled) {
          return;
        }

        setEntry(nextEntry);
        setLoading(false);

        if (!nextEntry.read) {
          void api.markActivityRead(id).catch(() => {
            // Ignore optimistic read-state failures; refresh can recover.
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEntry(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse">Loading…</div>;
  if (!entry) return <div className="px-4 py-4 text-[12px] text-dim">Not found.</div>;

  const meta = kindMeta(entry.kind);
  const primaryConversationId = pickInboxItemConversationId(entry);
  const relatedConversationIds = [...(entry.relatedConversationIds ?? [])].reverse();

  function openConversation(conversationId: string) {
    setActionError(null);
    openSession(conversationId);
    navigate(`/conversations/${encodeURIComponent(conversationId)}`);
  }

  async function handlePrimaryAction() {
    if (actionBusy) {
      return;
    }

    if (primaryConversationId) {
      openConversation(primaryConversationId);
      return;
    }

    const currentEntry = entry;
    if (!currentEntry) {
      return;
    }

    setActionBusy(true);
    setActionError(null);

    try {
      const result = await api.startActivityConversation(currentEntry.id);
      openSession(result.id);
      navigate(`/conversations/${encodeURIComponent(result.id)}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      setActionBusy(false);
    }
  }

  return (
    <div className="px-4 py-4 space-y-4 overflow-y-auto">
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="ui-card-title">{entry.summary}</p>
          <p className="ui-card-meta">
            <span className={meta.color}>{meta.label}</span>
            <span className="opacity-40 mx-1.5">·</span>
            {formatDate(entry.createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { void handlePrimaryAction(); }}
            disabled={actionBusy}
            className="ui-toolbar-button text-accent"
          >
            {primaryConversationId ? 'Open conversation' : (actionBusy ? 'Starting…' : 'Start conversation')}
          </button>
        </div>

        {actionError && <p className="text-[12px] text-danger">{actionError}</p>}
      </div>

      {entry.details && (
        <div className="border-t border-border-subtle pt-3">
          <p className="ui-section-label mb-1.5">Details</p>
          <div className="text-[12px] text-secondary whitespace-pre-wrap break-words leading-relaxed">
            {entry.details}
          </div>
        </div>
      )}

      {(relatedConversationIds.length > 0 || (entry.relatedProjectIds && entry.relatedProjectIds.length > 0)) && (
        <div className="border-t border-border-subtle pt-3">
          <p className="ui-section-label mb-2">Related</p>
          <div className="space-y-3">
            {relatedConversationIds.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-[0.12em] text-dim">Conversations</p>
                {relatedConversationIds.map((conversationId) => (
                  <Link
                    key={conversationId}
                    to={`/conversations/${conversationId}`}
                    onClick={() => openSession(conversationId)}
                    className="ui-card-meta font-mono text-accent hover:text-accent/80"
                  >
                    {conversationId}
                  </Link>
                ))}
              </div>
            )}

            {entry.relatedProjectIds && entry.relatedProjectIds.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-[0.12em] text-dim">Projects</p>
                {entry.relatedProjectIds.map((projectId) => (
                  <Link key={projectId} to={`/knowledge?section=projects&project=${encodeURIComponent(projectId)}`} className="ui-card-meta font-mono text-accent hover:text-accent/80">
                    {projectId}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-border-subtle pt-3">
        <div className="ui-detail-list">
          {[
            { label: 'id', value: entry.id },
            { label: 'profile', value: entry.profile },
            ...(entry.notificationState ? [{ label: 'notify', value: entry.notificationState }] : []),
          ].map(({ label, value }) => (
            <div key={label} className="ui-detail-row">
              <span className="ui-detail-label">{label}</span>
              <span className="ui-detail-value break-all">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Project detail ───────────────────────────────────────────────────────────

const VIEW_PROFILE_SEARCH_PARAM = 'viewProfile';

function ProjectDetailContext({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const viewProfile = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const value = params.get(VIEW_PROFILE_SEARCH_PARAM)?.trim();
    return value && value !== 'all' ? value : undefined;
  }, [location.search]);
  const fetcher = useCallback(() => api.projectById(id, viewProfile ? { profile: viewProfile } : undefined), [id, viewProfile]);
  const { data: project, loading, error, refetch } = useApi(fetcher, `${id}:${viewProfile ?? ''}`);
  const { data: profileState } = useApi(api.profiles);

  useEffect(() => {
    function handleProjectChanged() {
      void refetch({ resetLoading: false });
    }

    window.addEventListener(PROJECTS_CHANGED_EVENT, handleProjectChanged);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, handleProjectChanged);
  }, [refetch]);

  if (loading) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse">Loading…</div>;
  if (error) return <div className="px-4 py-4 text-[12px] text-dim">Project not found.</div>;
  if (!project) return <div className="px-4 py-4 text-[12px] text-dim">Project not found.</div>;

  const nextSearch = viewProfile ? `?${VIEW_PROFILE_SEARCH_PARAM}=${encodeURIComponent(viewProfile)}` : '';

  return suspendRailPanel(
    <ProjectDetailPanel
      project={project}
      activeProfile={profileState?.currentProfile}
      onChanged={() => {
        void refetch({ resetLoading: false });
        emitProjectsChanged();
      }}
      onDeleted={() => {
        navigate(`/projects${nextSearch}`);
        emitProjectsChanged();
      }}
    />,
    'Loading project…',
  );
}

// ── Managed memory packages ──────────────────────────────────────────────────

const MANAGED_MEMORY_ID_SEARCH_PARAM = 'memory';
const MANAGED_MEMORY_FILE_SEARCH_PARAM = 'file';

function buildManagedMemorySearch(locationSearch: string, memoryId: string | null, relativePath: string | null = null): string {
  const params = new URLSearchParams(locationSearch);

  if (memoryId) {
    params.set(MANAGED_MEMORY_ID_SEARCH_PARAM, memoryId);
  } else {
    params.delete(MANAGED_MEMORY_ID_SEARCH_PARAM);
  }

  if (relativePath) {
    params.set(MANAGED_MEMORY_FILE_SEARCH_PARAM, relativePath);
  } else {
    params.delete(MANAGED_MEMORY_FILE_SEARCH_PARAM);
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

function MemoryDocContext({ memoryId, relativePath }: { memoryId: string; relativePath: string | null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { openSession } = useConversations();
  const fetcher = useCallback(() => api.memoryDoc(memoryId), [memoryId]);
  const { data, loading, refreshing, error, refetch } = useApi(fetcher, memoryId);
  const [draft, setDraft] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [selectedContent, setSelectedContent] = useState('');
  const [selectedContentLoading, setSelectedContentLoading] = useState(false);
  const [selectedContentError, setSelectedContentError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'accent' | 'danger'; text: string } | null>(null);

  const setSelectedMemory = useCallback((nextMemoryId: string | null, nextRelativePath: string | null = null, replace = false) => {
    const nextSearch = buildManagedMemorySearch(location.search, nextMemoryId, nextRelativePath);
    navigate(`/memories${nextSearch}`, { replace });
  }, [location.search, navigate]);

  const memory = data?.memory ?? null;
  const references = data?.references ?? [];
  const selectedReference = useMemo(
    () => references.find((reference) => reference.relativePath === relativePath) ?? null,
    [references, relativePath],
  );
  const selectedFilePath = selectedReference?.path ?? memory?.path ?? null;
  const selectedFileLabel = selectedReference?.title ?? memory?.title ?? 'Memory';
  const selectedFileSummary = selectedReference?.summary ?? memory?.summary ?? '';
  const selectedFileRelativePath = selectedReference?.relativePath ?? 'MEMORY.md';
  const dirty = draft !== savedContent;

  useEffect(() => {
    if (!memory || !relativePath) {
      return;
    }

    if (!references.some((reference) => reference.relativePath === relativePath)) {
      setSelectedMemory(memory.id, null, true);
    }
  }, [memory, references, relativePath, setSelectedMemory]);

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedContent() {
      if (!memory) {
        return;
      }

      if (!selectedReference) {
        setSelectedContent(data?.content ?? '');
        setSelectedContentError(null);
        setSelectedContentLoading(false);
        return;
      }

      setSelectedContentLoading(true);
      setSelectedContentError(null);
      try {
        const result = await api.memoryFile(selectedReference.path);
        if (cancelled) {
          return;
        }
        setSelectedContent(result.content);
      } catch (selectedError) {
        if (cancelled) {
          return;
        }
        setSelectedContentError(selectedError instanceof Error ? selectedError.message : String(selectedError));
        setSelectedContent('');
      } finally {
        if (!cancelled) {
          setSelectedContentLoading(false);
        }
      }
    }

    void loadSelectedContent();
    return () => {
      cancelled = true;
    };
  }, [data?.content, memory?.id, selectedReference?.path]);

  useEffect(() => {
    setDraft(selectedContent);
    setSavedContent(selectedContent);
  }, [selectedContent, selectedFilePath]);

  async function handleSave() {
    if (!memory || !selectedFilePath || saveBusy || !dirty) {
      return;
    }

    setSaveBusy(true);
    setNotice(null);

    try {
      if (selectedReference) {
        await api.memoryFileSave(selectedReference.path, draft);
        const refreshedFile = await api.memoryFile(selectedReference.path);
        setSelectedContent(refreshedFile.content);
        setDraft(refreshedFile.content);
        setSavedContent(refreshedFile.content);
        await refetch({ resetLoading: false });
        setNotice({ tone: 'accent', text: `Saved ${selectedReference.relativePath}.` });
      } else {
        const result = await api.saveMemoryDoc(memory.id, draft);
        setSelectedContent(result.content);
        setDraft(result.content);
        setSavedContent(result.content);
        setNotice({ tone: 'accent', text: `Saved @${result.memory.id}.` });

        if (result.memory.id !== memory.id) {
          setSelectedMemory(result.memory.id, null, true);
          return;
        }

        await refetch({ resetLoading: false });
      }

      emitMemoriesChanged();
    } catch (saveError) {
      setNotice({ tone: 'danger', text: saveError instanceof Error ? saveError.message : String(saveError) });
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleDelete() {
    if (!memory || deleteBusy || selectedReference) {
      return;
    }

    if (!window.confirm(`Delete memory package @${memory.id}? This removes the full package, including references and assets.`)) {
      return;
    }

    setDeleteBusy(true);
    setNotice(null);

    try {
      await api.deleteMemoryDoc(memory.id);
      emitMemoriesChanged();
      setSelectedMemory(null, null, true);
    } catch (deleteError) {
      setNotice({ tone: 'danger', text: deleteError instanceof Error ? deleteError.message : String(deleteError) });
      setDeleteBusy(false);
    }
  }

  async function handleStartConversation() {
    if (!memory || startBusy) {
      return;
    }

    setStartBusy(true);
    setNotice(null);

    try {
      const result = await api.startMemoryConversation(memory.id);
      openSession(result.id);
      navigate(`/conversations/${encodeURIComponent(result.id)}`);
    } catch (startError) {
      setNotice({ tone: 'danger', text: startError instanceof Error ? startError.message : String(startError) });
      setStartBusy(false);
    }
  }

  if (loading && !data) {
    return <LoadingState label="Loading memory…" className="px-4 py-4" />;
  }

  if (error && !data) {
    return <ErrorState message={`Failed to load memory: ${error}`} className="px-4 py-4" />;
  }

  if (!memory) {
    return <div className="px-4 py-4 text-[12px] text-dim">Memory not found.</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-4 border-b border-border-subtle px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-card-title truncate">{selectedFileLabel}</p>
            <p className="ui-card-meta mt-0.5 font-mono truncate" title={`@${memory.id}`}>@{memory.id} · {selectedFileRelativePath}</p>
          </div>
          <button
            type="button"
            onClick={() => { void refetch({ resetLoading: false }); }}
            disabled={refreshing || selectedContentLoading}
            className="ui-toolbar-button shrink-0"
          >
            {refreshing || selectedContentLoading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>

        <div className="space-y-2">
          <div className="ui-detail-row">
            <span className="ui-detail-label">Package</span>
            <Link to={`/memories${buildManagedMemorySearch(location.search, memory.id)}`} className="ui-detail-value text-accent hover:underline">
              @{memory.id}
            </Link>
          </div>
          <div className="ui-detail-row">
            <span className="ui-detail-label">File</span>
            <span className="ui-detail-value break-all font-mono">{selectedFilePath}</span>
          </div>
          {selectedFileSummary && (
            <div className="ui-detail-row items-start">
              <span className="ui-detail-label">Summary</span>
              <span className="ui-detail-value">{selectedFileSummary}</span>
            </div>
          )}
          {memory.updated && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">Package updated</span>
              <span className="ui-detail-value">{timeAgo(memory.updated)}</span>
            </div>
          )}
          {memory.role && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">Role</span>
              <span className="ui-detail-value">{memory.role}</span>
            </div>
          )}
          {memory.type && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">Type</span>
              <span className="ui-detail-value">{memory.type}</span>
            </div>
          )}
          {memory.status && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">Status</span>
              <span className="ui-detail-value">{memory.status}</span>
            </div>
          )}
          {memory.area && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">Area</span>
              <span className="ui-detail-value">{memory.area}</span>
            </div>
          )}
          {memory.parent && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">Parent</span>
              <Link
                to={`/memories${buildManagedMemorySearch(location.search, memory.parent)}`}
                className="ui-detail-value text-accent hover:underline"
              >
                @{memory.parent}
              </Link>
            </div>
          )}
          {memory.related && memory.related.length > 0 && (
            <div className="ui-detail-row items-start">
              <span className="ui-detail-label">Related</span>
              <span className="ui-detail-value flex flex-wrap gap-x-2 gap-y-1">
                {memory.related.map((relatedId) => (
                  <Link
                    key={relatedId}
                    to={`/memories${buildManagedMemorySearch(location.search, relatedId)}`}
                    className="text-accent hover:underline"
                  >
                    @{relatedId}
                  </Link>
                ))}
              </span>
            </div>
          )}
          {memory.tags.length > 0 && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">Tags</span>
              <span className="ui-detail-value">{memory.tags.join(' · ')}</span>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-border-subtle pt-4">
          <div className="space-y-1">
            <p className="ui-section-label">Package files</p>
            <p className="ui-card-meta">Browse `MEMORY.md` and package-local references. Assets remain on disk inside `assets/`.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Link
              to={`/memories${buildManagedMemorySearch(location.search, memory.id)}`}
              className={relativePath ? 'ui-toolbar-button' : 'ui-toolbar-button text-accent'}
            >
              MEMORY.md
            </Link>
            {references.map((reference) => (
              <Link
                key={reference.path}
                to={`/memories${buildManagedMemorySearch(location.search, memory.id, reference.relativePath)}`}
                className={reference.relativePath === relativePath ? 'ui-toolbar-button text-accent' : 'ui-toolbar-button'}
              >
                <span className="truncate">{reference.title}</span>
                <span className="ml-1 truncate text-dim">· {reference.relativePath}</span>
              </Link>
            ))}
            {references.length === 0 && <p className="ui-card-meta">No reference files yet.</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => { void handleStartConversation(); }}
            disabled={startBusy || loading}
            className="ui-toolbar-button text-accent"
          >
            {startBusy ? 'Starting…' : 'Start convo'}
          </button>
          <button
            type="button"
            onClick={() => { void handleSave(); }}
            disabled={!dirty || saveBusy || loading || selectedContentLoading || Boolean(selectedContentError)}
            className={dirty ? 'ui-toolbar-button text-accent' : 'ui-toolbar-button'}
          >
            {saveBusy ? 'Saving…' : 'Save'}
          </button>
          {!selectedReference && (
            <button
              type="button"
              onClick={() => { void handleDelete(); }}
              disabled={deleteBusy || loading}
              className="ui-toolbar-button text-danger"
            >
              {deleteBusy ? 'Deleting…' : 'Delete package'}
            </button>
          )}
          {dirty && !saveBusy && <span className="ui-card-meta">Unsaved changes</span>}
        </div>

        {notice && (
          <p className={notice.tone === 'danger' ? 'text-[12px] text-danger' : 'text-[12px] text-accent'}>
            {notice.text}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 px-4 py-4">
        {selectedContentError ? (
          <ErrorState message={`Failed to load file: ${selectedContentError}`} className="px-0 py-0" />
        ) : selectedContentLoading ? (
          <LoadingState label="Loading file…" className="px-0 py-0" />
        ) : (
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                void handleSave();
              }
            }}
            className="h-full min-h-[24rem] w-full resize-none rounded-lg border border-border-default bg-base px-3 py-3 font-mono text-[12px] leading-relaxed text-primary outline-none transition-colors focus:border-accent/60"
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}

// ── Memory file content ───────────────────────────────────────────────────────

function MemoryFileContext({ path }: { path: string }) {
  const fetcher = useCallback(() => api.memoryFile(path), [path]);
  const { data, loading, error, refetch } = useApi(fetcher, path);
  const editingStorageKey = `pa:reload:memory-file:${path}:editing`;
  const draftStorageKey = `pa:reload:memory-file:${path}:draft`;
  const [editing, setEditing] = useReloadState<boolean>({
    storageKey: editingStorageKey,
    initialValue: false,
    shouldPersist: (value) => value,
  });
  const [draft, setDraft] = useReloadState<string>({
    storageKey: draftStorageKey,
    initialValue: '',
    shouldPersist: (value) => editing && value !== (data?.content ?? ''),
  });
  const [saving,   setSaving]   = useState(false);
  const [saveErr,  setSaveErr]  = useState<string | null>(null);
  const [savedOk,  setSavedOk]  = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (data?.content === undefined || editing) {
      return;
    }

    setDraft(data.content);
  }, [data?.content, editing, setDraft]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 600)}px`;
    }
  }, [editing, draft]);

  async function save() {
    setSaving(true); setSaveErr(null); setSavedOk(false);
    try {
      await api.memoryFileSave(path, draft);
      setEditing(false);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
      refetch();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  if (loading) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse font-mono">Loading…</div>;
  if (error)   return <div className="px-4 py-4 text-[12px] text-danger/80 font-mono">Error: {error}</div>;

  const fileName = path.split('/').pop() ?? path;

  return (
    <div className="px-4 py-4 space-y-3">
      <p className="text-[12px] font-mono text-dim/60 truncate" title={path}>{fileName}</p>
      {editing ? (
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="w-full text-[13px] font-mono text-secondary leading-[1.75] bg-base border border-border-default rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-accent/60 min-h-[120px]"
            spellCheck={false}
          />
          {saveErr && <p className="text-[12px] text-danger/80">{saveErr}</p>}
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving} className="text-[12px] font-medium text-accent hover:text-accent/70 transition-colors disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
            {savedOk && <span className="text-[12px] text-success">✓ Saved</span>}
            <button
              onClick={() => {
                setDraft(data?.content ?? '');
                setEditing(false);
              }}
              disabled={saving}
              className="text-[12px] text-secondary hover:text-primary transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="relative group/content">
          <pre className="text-[13px] font-mono text-secondary leading-[1.75] whitespace-pre-wrap break-words overflow-x-auto max-h-[calc(100vh-200px)] overflow-y-auto">
            {data?.content}
          </pre>
          <button
            onClick={() => {
              setDraft(data?.content ?? '');
              setEditing(true);
            }}
            className="absolute top-0 right-0 opacity-0 group-hover/content:opacity-100 transition-opacity text-[10px] text-secondary hover:text-primary"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

function MemoryOverviewContext() {
  const { data, loading, error } = useApi(api.memory);

  if (loading) return <LoadingState label="Loading memory…" className="px-4 py-4" />;
  if (error) return <ErrorState message={`Failed to load memory: ${error}`} className="px-4 py-4" />;
  if (!data) return null;

  const summary = buildMemoryPageSummary(data);
  const identity = buildIdentitySummary(data);
  const capabilities = buildCapabilityCards(data).slice(0, 3);
  const knowledge = buildKnowledgeSections(data);

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="space-y-1">
        <p className="ui-card-title">Agent memory</p>
        <p className="ui-card-meta">Select an item on the left to inspect the raw markdown.</p>
      </div>

      <p className="ui-card-meta">
        {summary.role}
        {' · '}
        {summary.knowledgeCount} knowledge items
        {' · '}
        {summary.capabilityCount} capabilities
      </p>

      <div className="space-y-3 border-t border-border-subtle pt-4">
        <div className="space-y-1.5">
          <p className="ui-section-label">Identity</p>
          <p className="ui-card-meta">{identity.ruleCount} behavior rules · {identity.role}</p>
        </div>

        <div className="space-y-1.5 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Knowledge</p>
          {knowledge.recent.length === 0
            ? <p className="ui-card-meta">No recently used knowledge yet.</p>
            : knowledge.recent.map((item) => (
              <p key={item.item.path} className="ui-card-meta">{item.title} · {item.usageLabel}</p>
            ))}
        </div>

        <div className="space-y-1.5 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Capabilities</p>
          {capabilities.length === 0
            ? <p className="ui-card-meta">No capabilities loaded yet.</p>
            : capabilities.map((item) => (
              <p key={item.item.path} className="ui-card-meta">{item.title} · {item.usageLabel}</p>
            ))}
        </div>
      </div>
    </div>
  );
}

function RailMetadataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="ui-detail-row">
      <span className="ui-detail-label">{label}</span>
      <span className="ui-detail-value break-words">{value}</span>
    </div>
  );
}

function RailMarkdownPreview({ content, className }: { content: string; className?: string }) {
  return (
    <pre className={[
      'overflow-x-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-secondary',
      className,
    ].filter(Boolean).join(' ')}>
      {content}
    </pre>
  );
}

function sortKnowledgeProjects(items: ProjectRecord[]): ProjectRecord[] {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title));
}

function sortKnowledgeMemories(items: MemoryDocItem[]): MemoryDocItem[] {
  return [...items].sort((left, right) => {
    const leftTimestamp = left.updated ?? left.lastUsedAt ?? '';
    const rightTimestamp = right.updated ?? right.lastUsedAt ?? '';
    return rightTimestamp.localeCompare(leftTimestamp) || left.title.localeCompare(right.title);
  });
}

function sortKnowledgeSkills(items: MemorySkillItem[]): MemorySkillItem[] {
  return [...items].sort((left, right) => {
    const leftUsage = Number(left.usedInLastSession) * 10 + (left.recentSessionCount ?? 0);
    const rightUsage = Number(right.usedInLastSession) * 10 + (right.recentSessionCount ?? 0);
    return rightUsage - leftUsage
      || (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? '')
      || humanizeSkillName(left.name).localeCompare(humanizeSkillName(right.name));
  });
}

function sortCapabilityTasks(items: ScheduledTaskSummary[]): ScheduledTaskSummary[] {
  return [...items].sort((left, right) => {
    const leftWeight = Number(left.running) * 10 + Number(left.lastStatus === 'failure') * 5 + Number(left.enabled);
    const rightWeight = Number(right.running) * 10 + Number(right.lastStatus === 'failure') * 5 + Number(right.enabled);
    return rightWeight - leftWeight
      || (right.lastRunAt ?? '').localeCompare(left.lastRunAt ?? '')
      || left.id.localeCompare(right.id);
  });
}

function sortCapabilityTools(items: AgentToolInfo[]): AgentToolInfo[] {
  return [...items].sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name));
}

function toolParameterDetails(tool: Pick<AgentToolInfo, 'parameters'>): Array<{ name: string; required: boolean; description?: string; type?: string }> {
  const properties = tool.parameters.properties ?? {};
  const required = new Set(tool.parameters.required ?? []);

  return Object.entries(properties).map(([name, schema]) => ({
    name,
    required: required.has(name),
    description: schema.description,
    type: typeof schema.type === 'string' ? schema.type : undefined,
  }));
}

function taskStatusLabel(task: ScheduledTaskSummary): string {
  if (task.running) return 'running';
  if (task.lastStatus === 'failure') return 'failed';
  if (task.lastStatus === 'success') return 'ok';
  if (!task.enabled) return 'disabled';
  return 'pending';
}

function ConversationsWorkspaceContext() {
  const { pinnedSessions, tabs, archivedSessions, loading, refetch } = useConversations();
  const attentionSessions = useMemo(
    () => [...pinnedSessions, ...tabs, ...archivedSessions].filter((session) => sessionNeedsAttention(session)),
    [archivedSessions, pinnedSessions, tabs],
  );

  if (loading) {
    return <LoadingState label="Loading conversations…" className="px-4 py-4" />;
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="ui-card-title">Workspace</p>
          <p className="ui-card-meta">Browse pinned, open, and archived conversations from the main pane. Open a conversation to switch this rail into live session context.</p>
        </div>
        <button type="button" onClick={() => { void refetch({ resetLoading: false }); }} className="ui-toolbar-button shrink-0">↻ Refresh</button>
      </div>

      <div className="space-y-2">
        <RailMetadataRow label="Pinned" value={pinnedSessions.length} />
        <RailMetadataRow label="Open" value={tabs.length} />
        <RailMetadataRow label="Archived" value={archivedSessions.length} />
        <RailMetadataRow label="Attention" value={attentionSessions.length} />
      </div>

      <div className="space-y-2 border-t border-border-subtle pt-4">
        <p className="ui-section-label">Needs attention</p>
        {attentionSessions.length === 0 ? (
          <p className="ui-card-meta">No conversations currently need review.</p>
        ) : (
          <div className="space-y-2">
            {attentionSessions.slice(0, 5).map((session) => (
              <Link key={session.id} to={`/conversations/${encodeURIComponent(session.id)}`} className="block rounded-lg border border-border-subtle bg-base px-3 py-2 hover:bg-elevated/60">
                <p className="text-[12px] font-medium text-primary break-words">{session.title}</p>
                <p className="ui-card-meta mt-1">{timeAgo(session.lastActivityAt ?? session.timestamp)} · {session.model?.split('/').pop() ?? 'model unknown'}</p>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border-subtle pt-4">
        <p className="ui-section-label">Workspace samples</p>
        {[
          ...pinnedSessions.map((session) => ({ session, label: 'pinned' })),
          ...tabs.map((session) => ({ session, label: 'open' })),
        ].slice(0, 5).length === 0 ? (
          <p className="ui-card-meta">No open conversations yet.</p>
        ) : (
          <div className="space-y-2">
            {[
              ...pinnedSessions.map((session) => ({ session, label: 'pinned' })),
              ...tabs.map((session) => ({ session, label: 'open' })),
            ].slice(0, 5).map(({ session, label }) => (
              <Link key={session.id} to={`/conversations/${encodeURIComponent(session.id)}`} className="block rounded-lg border border-border-subtle bg-base px-3 py-2 hover:bg-elevated/60">
                <p className="text-[12px] font-medium text-primary break-words">{session.title}</p>
                <p className="ui-card-meta mt-1">{label} · {timeAgo(session.lastActivityAt ?? session.timestamp)}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KnowledgeOverviewContext({
  section,
  memoryData,
  projects,
}: {
  section: ReturnType<typeof getKnowledgeSection>;
  memoryData: MemoryData | null;
  projects: ProjectRecord[];
}) {
  const location = useLocation();
  const activeProjects = projects.filter((project) => !isProjectArchived(project));
  const memories = sortKnowledgeMemories(memoryData?.memoryDocs ?? []);
  const skills = sortKnowledgeSkills(memoryData?.skills ?? []);
  const instructions = (memoryData?.agentsMd ?? []).filter((item) => item.exists).sort((left, right) => left.source.localeCompare(right.source));
  const identity = memoryData ? buildIdentitySummary(memoryData) : null;
  const knowledge = memoryData ? buildKnowledgeSections(memoryData) : null;
  const capabilityCards = memoryData ? buildCapabilityCards(memoryData) : [];

  if (section === 'projects') {
    return (
      <div className="px-4 py-4 space-y-4">
        <div className="space-y-1">
          <p className="ui-card-title">Projects</p>
          <p className="ui-card-meta">Select a project on the left to inspect its active plan, blockers, and linked work.</p>
        </div>
        <div className="space-y-2">
          <RailMetadataRow label="Active" value={activeProjects.length} />
          <RailMetadataRow label="Archived" value={projects.length - activeProjects.length} />
        </div>
        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Recently updated</p>
          {projects.length === 0 ? <p className="ui-card-meta">No projects available.</p> : sortKnowledgeProjects(projects).slice(0, 5).map((project) => (
            <Link key={project.id} to={`/knowledge${buildKnowledgeSearch(location.search, { section: 'projects', projectId: project.id })}`} className="block rounded-lg border border-border-subtle bg-base px-3 py-2 hover:bg-elevated/60">
              <p className="text-[12px] font-medium text-primary">{project.title}</p>
              <p className="ui-card-meta mt-1">{formatProjectStatus(project.status)} · updated {timeAgo(project.updatedAt)}</p>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  if (section === 'memories') {
    return (
      <div className="px-4 py-4 space-y-4">
        <div className="space-y-1">
          <p className="ui-card-title">Memories</p>
          <p className="ui-card-meta">Select a memory package on the left to inspect its overview and package-local references.</p>
        </div>
        <div className="space-y-2">
          <RailMetadataRow label="Packages" value={memories.length} />
          <RailMetadataRow label="Recently used" value={memories.filter((item) => item.usedInLastSession).length} />
        </div>
        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Recent packages</p>
          {memories.length === 0 ? <p className="ui-card-meta">No memory packages available.</p> : memories.slice(0, 5).map((memory) => (
            <Link key={memory.id} to={`/knowledge${buildKnowledgeSearch(location.search, { section: 'memories', memoryId: memory.id })}`} className="block rounded-lg border border-border-subtle bg-base px-3 py-2 hover:bg-elevated/60">
              <p className="text-[12px] font-medium text-primary">{memory.title}</p>
              <p className="ui-card-meta mt-1">@{memory.id}{memory.updated ? ` · updated ${timeAgo(memory.updated)}` : ''}</p>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  if (section === 'skills') {
    return (
      <div className="px-4 py-4 space-y-4">
        <div className="space-y-1">
          <p className="ui-card-title">Skills</p>
          <p className="ui-card-meta">Select a skill on the left to inspect when to use it and read its SKILL.md definition.</p>
        </div>
        <div className="space-y-2">
          <RailMetadataRow label="Available" value={skills.length} />
          <RailMetadataRow label="Used recently" value={skills.filter((item) => item.usedInLastSession).length} />
        </div>
        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Top workflows</p>
          {capabilityCards.length === 0 ? <p className="ui-card-meta">No skills available.</p> : capabilityCards.slice(0, 5).map((card) => (
            <Link key={card.item.name} to={`/knowledge${buildKnowledgeSearch(location.search, { section: 'skills', skillName: card.item.name })}`} className="block rounded-lg border border-border-subtle bg-base px-3 py-2 hover:bg-elevated/60">
              <p className="text-[12px] font-medium text-primary">{card.title}</p>
              <p className="ui-card-meta mt-1">{card.usageLabel}</p>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  if (section === 'instructions') {
    return (
      <div className="px-4 py-4 space-y-4">
        <div className="space-y-1">
          <p className="ui-card-title">Instructions</p>
          <p className="ui-card-meta">Select an instruction source on the left to inspect the durable role and operating policy it contributes.</p>
        </div>
        <div className="space-y-2">
          <RailMetadataRow label="Sources" value={instructions.length} />
          <RailMetadataRow label="Rules" value={identity?.ruleCount ?? 0} />
        </div>
        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Loaded sources</p>
          {instructions.length === 0 ? <p className="ui-card-meta">No instruction sources loaded.</p> : instructions.map((item) => (
            <Link key={item.path} to={`/knowledge${buildKnowledgeSearch(location.search, { section: 'instructions', instructionPath: item.path })}`} className="block rounded-lg border border-border-subtle bg-base px-3 py-2 hover:bg-elevated/60">
              <p className="text-[12px] font-medium text-primary">{item.source}</p>
              <p className="ui-card-meta mt-1 break-all">{item.path}</p>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="space-y-1">
        <p className="ui-card-title">Knowledge Base</p>
        <p className="ui-card-meta">Durable context lives here: projects, memory packages, skills, and instruction sources.</p>
      </div>

      <div className="space-y-2">
        <RailMetadataRow label="Projects" value={activeProjects.length} />
        <RailMetadataRow label="Memories" value={memories.length} />
        <RailMetadataRow label="Skills" value={skills.length} />
        <RailMetadataRow label="Instructions" value={instructions.length} />
      </div>

      {identity && (
        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Identity</p>
          <p className="ui-card-meta">{identity.role}</p>
          <p className="ui-card-meta">{identity.ruleCount} durable behavior rules in effect.</p>
        </div>
      )}

      {knowledge && (
        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Recent knowledge</p>
          {knowledge.recent.length === 0 ? <p className="ui-card-meta">No recent durable knowledge usage yet.</p> : knowledge.recent.slice(0, 4).map((item) => (
            <Link key={item.item.id} to={`/knowledge${buildKnowledgeSearch(location.search, { section: 'memories', memoryId: item.item.id })}`} className="block rounded-lg border border-border-subtle bg-base px-3 py-2 hover:bg-elevated/60">
              <p className="text-[12px] font-medium text-primary">{item.title}</p>
              <p className="ui-card-meta mt-1">{item.usageLabel}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function KnowledgeProjectContext({ projectId }: { projectId: string }) {
  const location = useLocation();
  const viewProfile = useMemo(() => {
    const value = new URLSearchParams(location.search).get(VIEW_PROFILE_SEARCH_PARAM)?.trim();
    return value && value !== 'all' ? value : undefined;
  }, [location.search]);
  const fetcher = useCallback(() => api.projectById(projectId, viewProfile ? { profile: viewProfile } : undefined), [projectId, viewProfile]);
  const { data, loading, error, refreshing, refetch } = useApi(fetcher, `knowledge-project-rail:${projectId}:${viewProfile ?? ''}`);

  if (loading && !data) return <LoadingState label="Loading project…" className="px-4 py-4" />;
  if (error && !data) return <ErrorState message={`Failed to load project: ${error}`} className="px-4 py-4" />;
  if (!data) return <div className="px-4 py-4 text-[12px] text-dim">Project not found.</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border-subtle px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="ui-card-title">Project</p>
            <p className="ui-card-meta">{data.project.title}</p>
          </div>
          <button type="button" onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing} className="ui-toolbar-button shrink-0">
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {suspendRailPanel(<ProjectOverviewPanel project={data} />, 'Loading project…')}
      </div>
    </div>
  );
}

function KnowledgeMemoryContext({ memoryId }: { memoryId: string }) {
  const { data, loading, error, refreshing, refetch } = useApi(() => api.memoryDoc(memoryId), `knowledge-memory-rail:${memoryId}`);

  if (loading && !data) return <LoadingState label="Loading memory…" className="px-4 py-4" />;
  if (error && !data) return <ErrorState message={`Failed to load memory: ${error}`} className="px-4 py-4" />;
  if (!data) return <div className="px-4 py-4 text-[12px] text-dim">Memory not found.</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-4 border-b border-border-subtle px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-card-title break-words">{data.memory.title}</p>
            <p className="ui-card-meta mt-1 font-mono">@{data.memory.id}</p>
          </div>
          <button type="button" onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing} className="ui-toolbar-button shrink-0">
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
        <div className="space-y-2">
          <RailMetadataRow label="Type" value={data.memory.type ?? '—'} />
          <RailMetadataRow label="Status" value={data.memory.status ?? '—'} />
          <RailMetadataRow label="Updated" value={data.memory.updated ? timeAgo(data.memory.updated) : 'unknown'} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/memories?memory=${encodeURIComponent(data.memory.id)}`} className="ui-toolbar-button">Open memory browser</Link>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="space-y-1.5">
          <p className="ui-section-label">Summary</p>
          <p className="ui-card-body">{data.memory.summary || 'No summary provided.'}</p>
        </div>
        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Overview</p>
          <RailMarkdownPreview content={data.content} />
        </div>
        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="ui-section-label">References</p>
          {data.references.length === 0 ? <p className="ui-card-meta">No package-local references yet.</p> : data.references.map((reference) => (
            <div key={reference.path} className="space-y-0.5 rounded-lg border border-border-subtle bg-base px-3 py-2">
              <p className="text-[12px] font-medium text-primary">{reference.title}</p>
              <p className="ui-card-meta break-all">{reference.relativePath}</p>
              {reference.summary && <p className="text-[12px] leading-relaxed text-secondary">{reference.summary}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KnowledgeSkillContext({ skill }: { skill: MemorySkillItem }) {
  const { data, loading, error, refreshing, refetch } = useApi(() => api.memoryFile(skill.path), `knowledge-skill-rail:${skill.path}`);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-4 border-b border-border-subtle px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-card-title break-words">{humanizeSkillName(skill.name)}</p>
            <p className="ui-card-meta mt-1">{skill.source}</p>
          </div>
          <button type="button" onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing} className="ui-toolbar-button shrink-0">
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
        <div className="space-y-2">
          <RailMetadataRow label="Name" value={skill.name} />
          <RailMetadataRow label="Usage" value={formatUsageLabel(skill.recentSessionCount, skill.lastUsedAt, skill.usedInLastSession, 'Not used recently')} />
          <RailMetadataRow label="Path" value={<span className="font-mono break-all">{skill.path}</span>} />
        </div>
        {skill.description && <p className="ui-card-body">{skill.description}</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading && !data ? <LoadingState label="Loading skill…" className="px-0 py-0" /> : error && !data ? <ErrorState message={`Failed to load skill: ${error}`} className="px-0 py-0" /> : data?.content ? <RailMarkdownPreview content={data.content} /> : <p className="ui-card-meta">No skill definition content available.</p>}
      </div>
    </div>
  );
}

function KnowledgeInstructionContext({ item }: { item: MemoryAgentsItem }) {
  return (
    <div className="px-4 py-4 space-y-4">
      <div className="space-y-1">
        <p className="ui-card-title break-words">{item.source}</p>
        <p className="ui-card-meta break-all">{item.path}</p>
      </div>
      <div className="space-y-2">
        <RailMetadataRow label="Source" value={item.source} />
        <RailMetadataRow label="Path" value={<span className="font-mono break-all">{item.path}</span>} />
      </div>
      <div className="space-y-2 border-t border-border-subtle pt-4">
        <p className="ui-section-label">Instructions</p>
        {item.content ? <RailMarkdownPreview content={item.content} /> : <p className="ui-card-meta">This source exists but no content was loaded.</p>}
      </div>
    </div>
  );
}

function KnowledgeContextPanel() {
  const location = useLocation();
  const section = getKnowledgeSection(location.search);
  const selectedProjectId = getKnowledgeProjectId(location.search);
  const selectedMemoryId = getKnowledgeMemoryId(location.search);
  const selectedSkillName = getKnowledgeSkillName(location.search);
  const selectedInstructionPath = getKnowledgeInstructionPath(location.search);
  const memoryResult = useApi(api.memory, 'knowledge-rail-memory');
  const projectsResult = useApi(api.projects, 'knowledge-rail-projects');

  const memoryData = memoryResult.data ?? null;
  const projects = sortKnowledgeProjects(projectsResult.data ?? []);
  const skills = sortKnowledgeSkills(memoryData?.skills ?? []);
  const instructions = (memoryData?.agentsMd ?? []).filter((item) => item.exists).sort((left, right) => left.source.localeCompare(right.source));
  const selectedSkill = skills.find((item) => item.name === selectedSkillName) ?? null;
  const selectedInstruction = instructions.find((item) => item.path === selectedInstructionPath) ?? null;

  if (selectedProjectId) return <KnowledgeProjectContext projectId={selectedProjectId} />;
  if (selectedMemoryId) return <KnowledgeMemoryContext memoryId={selectedMemoryId} />;
  if (selectedSkill) return <KnowledgeSkillContext skill={selectedSkill} />;
  if (selectedInstruction) return <KnowledgeInstructionContext item={selectedInstruction} />;
  if (memoryResult.loading && !memoryData && projectsResult.loading && projects.length === 0) return <LoadingState label="Loading knowledge base…" className="px-4 py-4" />;
  if (!memoryData && !projectsResult.data && (memoryResult.error || projectsResult.error)) {
    return <ErrorState message={`Failed to load knowledge base: ${[memoryResult.error, projectsResult.error].filter(Boolean).join(' · ')}`} className="px-4 py-4" />;
  }

  return <KnowledgeOverviewContext section={section} memoryData={memoryData} projects={projects} />;
}

function CapabilitiesOverviewContext({
  section,
  presets,
  defaultPresetIds,
  tasks,
  tools,
  unavailableCliCount,
  mcpServerCount,
}: {
  section: ReturnType<typeof getCapabilitiesSection>;
  presets: ConversationAutomationWorkflowPreset[];
  defaultPresetIds: string[];
  tasks: ScheduledTaskSummary[];
  tools: AgentToolInfo[];
  unavailableCliCount: number;
  mcpServerCount: number;
}) {
  const location = useLocation();
  const activeTools = tools.filter((tool) => tool.active);
  const failingTasks = tasks.filter((task) => task.lastStatus === 'failure');

  if (section === 'presets') {
    return (
      <div className="px-4 py-4 space-y-4">
        <div className="space-y-1">
          <p className="ui-card-title">Todo Presets</p>
          <p className="ui-card-meta">Select a preset on the left to inspect its ordered automation steps and defaults.</p>
        </div>
        <div className="space-y-2">
          <RailMetadataRow label="Presets" value={presets.length} />
          <RailMetadataRow label="Defaults" value={defaultPresetIds.length} />
        </div>
        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Defaults</p>
          {defaultPresetIds.length === 0 ? <p className="ui-card-meta">No default presets configured.</p> : defaultPresetIds.map((presetId) => {
            const preset = presets.find((item) => item.id === presetId);
            if (!preset) {
              return null;
            }
            return (
              <Link key={preset.id} to={`/capabilities${buildCapabilitiesSearch(location.search, { section: 'presets', presetId: preset.id })}`} className="block rounded-lg border border-border-subtle bg-base px-3 py-2 hover:bg-elevated/60">
                <p className="text-[12px] font-medium text-primary">{preset.name}</p>
                <p className="ui-card-meta mt-1">{preset.items.length} items</p>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  if (section === 'scheduled') {
    return (
      <div className="px-4 py-4 space-y-4">
        <div className="space-y-1">
          <p className="ui-card-title">Scheduled Tasks</p>
          <p className="ui-card-meta">Select a task on the left to inspect its prompt, schedule, and recent runtime state.</p>
        </div>
        <div className="space-y-2">
          <RailMetadataRow label="Enabled" value={tasks.filter((task) => task.enabled).length} />
          <RailMetadataRow label="Running" value={tasks.filter((task) => task.running).length} />
          <RailMetadataRow label="Failing" value={failingTasks.length} />
        </div>
        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Needs attention</p>
          {failingTasks.length === 0 ? <p className="ui-card-meta">No scheduled tasks currently need attention.</p> : failingTasks.slice(0, 5).map((task) => (
            <Link key={task.id} to={`/capabilities${buildCapabilitiesSearch(location.search, { section: 'scheduled', taskId: task.id })}`} className="block rounded-lg border border-border-subtle bg-base px-3 py-2 hover:bg-elevated/60">
              <p className="text-[12px] font-medium text-primary">{task.id}</p>
              <p className="ui-card-meta mt-1">failed {task.lastRunAt ? timeAgo(task.lastRunAt) : 'recently'}</p>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  if (section === 'tools') {
    return (
      <div className="px-4 py-4 space-y-4">
        <div className="space-y-1">
          <p className="ui-card-title">Tools</p>
          <p className="ui-card-meta">Select a tool on the left to inspect its parameter schema and runtime role.</p>
        </div>
        <div className="space-y-2">
          <RailMetadataRow label="Active tools" value={activeTools.length} />
          <RailMetadataRow label="CLI issues" value={unavailableCliCount} />
          <RailMetadataRow label="MCP servers" value={mcpServerCount} />
        </div>
        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Active by default</p>
          {activeTools.length === 0 ? <p className="ui-card-meta">No active tools reported.</p> : activeTools.slice(0, 6).map((tool) => (
            <Link key={tool.name} to={`/capabilities${buildCapabilitiesSearch(location.search, { section: 'tools', toolName: tool.name })}`} className="block rounded-lg border border-border-subtle bg-base px-3 py-2 hover:bg-elevated/60">
              <p className="text-[12px] font-medium text-primary">{tool.name}</p>
              <p className="ui-card-meta mt-1">{toolParameterDetails(tool).length} parameter{toolParameterDetails(tool).length === 1 ? '' : 's'}</p>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="space-y-1">
        <p className="ui-card-title">Capabilities</p>
        <p className="ui-card-meta">Presets, scheduled tasks, and tools define what the agent can execute and automate.</p>
      </div>
      <div className="space-y-2">
        <RailMetadataRow label="Presets" value={presets.length} />
        <RailMetadataRow label="Scheduled" value={tasks.filter((task) => task.enabled).length} />
        <RailMetadataRow label="Tools" value={activeTools.length} />
      </div>
      <div className="space-y-2 border-t border-border-subtle pt-4">
        <p className="ui-section-label">Current health</p>
        <p className="ui-card-meta">{tasks.filter((task) => task.running).length} running scheduled task{tasks.filter((task) => task.running).length === 1 ? '' : 's'} · {failingTasks.length} failing · {unavailableCliCount} CLI issue{unavailableCliCount === 1 ? '' : 's'}.</p>
      </div>
    </div>
  );
}

function CapabilitiesPresetContext({ preset, isDefault }: { preset: ConversationAutomationWorkflowPreset; isDefault: boolean }) {
  return (
    <div className="px-4 py-4 space-y-4">
      <div className="space-y-1">
        <p className="ui-card-title break-words">{preset.name}</p>
        <p className="ui-card-meta">{preset.id}</p>
      </div>
      <div className="space-y-2">
        <RailMetadataRow label="Items" value={preset.items.length} />
        <RailMetadataRow label="Default" value={isDefault ? 'Yes' : 'No'} />
        <RailMetadataRow label="Updated" value={preset.updatedAt ? new Date(preset.updatedAt).toLocaleString() : 'Saved in settings'} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/plans?plan=${encodeURIComponent(preset.id)}`} className="ui-toolbar-button">Open preset editor</Link>
      </div>
      <div className="space-y-2 border-t border-border-subtle pt-4">
        <p className="ui-section-label">Items</p>
        {preset.items.map((item) => (
          <div key={item.id} className="rounded-lg border border-border-subtle bg-base px-3 py-2">
            <p className="text-[12px] font-medium text-primary">{item.label}</p>
            <p className="ui-card-meta mt-1">{item.kind === 'instruction' ? item.text : `${item.skillName}${item.skillArgs ? ` ${item.skillArgs}` : ''}`}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CapabilitiesTaskContext({ taskId }: { taskId: string }) {
  const navigate = useNavigate();
  const { data, loading, error, refreshing, refetch } = useApi(() => api.taskDetail(taskId), `capabilities-task-rail:${taskId}`);
  const [runningNow, setRunningNow] = useState(false);

  const handleRunNow = useCallback(async () => {
    if (!data || runningNow || data.running) {
      return;
    }

    setRunningNow(true);
    try {
      const result = await api.runTaskNow(data.id);
      await refetch({ resetLoading: false });
      navigate(`/system?run=${encodeURIComponent(result.runId)}`);
    } finally {
      setRunningNow(false);
    }
  }, [data, navigate, refetch, runningNow]);

  if (loading && !data) return <LoadingState label="Loading task…" className="px-4 py-4" />;
  if (error && !data) return <ErrorState message={`Failed to load task: ${error}`} className="px-4 py-4" />;
  if (!data) return <div className="px-4 py-4 text-[12px] text-dim">Task not found.</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-4 border-b border-border-subtle px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-card-title break-words">{data.id}</p>
            <p className="ui-card-meta mt-1">{data.running ? 'running' : data.lastStatus ?? (data.enabled ? 'enabled' : 'disabled')}</p>
          </div>
          <button type="button" onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing} className="ui-toolbar-button shrink-0">
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
        <div className="space-y-2">
          <RailMetadataRow label="Schedule" value={data.cron || data.at ? formatTaskSchedule(data) : 'manual only'} />
          <RailMetadataRow label="Model" value={data.model ?? 'Default model'} />
          <RailMetadataRow label="Cwd" value={<span className="font-mono break-all">{data.cwd ?? 'No cwd set'}</span>} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { void handleRunNow(); }} disabled={runningNow || data.running} className="ui-toolbar-button text-accent">
            {runningNow ? 'Running…' : 'Run now'}
          </button>
          <Link to={`/scheduled/${encodeURIComponent(data.id)}`} className="ui-toolbar-button">Open task editor</Link>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="space-y-2">
          <p className="ui-section-label">Prompt</p>
          <RailMarkdownPreview content={data.prompt} />
        </div>
        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Task file</p>
          <RailMarkdownPreview content={data.fileContent} />
        </div>
      </div>
    </div>
  );
}

function CapabilitiesToolContext({ tool }: { tool: AgentToolInfo }) {
  const parameters = toolParameterDetails(tool);

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="space-y-1">
        <p className="ui-card-title break-words">{tool.name}</p>
        <p className="ui-card-meta">{tool.active ? 'Active by default' : 'Available on demand'}</p>
      </div>
      <p className="ui-card-body">{tool.description}</p>
      <div className="space-y-2">
        <RailMetadataRow label="Default" value={tool.active ? 'Yes' : 'No'} />
        <RailMetadataRow label="Parameters" value={parameters.length} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/tools" className="ui-toolbar-button">Open full tools page</Link>
      </div>
      <div className="space-y-2 border-t border-border-subtle pt-4">
        <p className="ui-section-label">Parameters</p>
        {parameters.length === 0 ? <p className="ui-card-meta">No parameters.</p> : parameters.map((parameter) => (
          <div key={parameter.name} className="rounded-lg border border-border-subtle bg-base px-3 py-2">
            <p className="text-[12px] font-medium text-primary">{parameter.name}</p>
            <p className="ui-card-meta mt-1">{parameter.required ? 'required' : 'optional'}{parameter.type ? ` · ${parameter.type}` : ''}</p>
            {parameter.description && <p className="text-[12px] leading-relaxed text-secondary mt-1">{parameter.description}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function CapabilitiesContextPanel() {
  const location = useLocation();
  const section = getCapabilitiesSection(location.search);
  const selectedPresetId = getCapabilitiesPresetId(location.search);
  const selectedTaskId = getCapabilitiesTaskId(location.search);
  const selectedToolName = getCapabilitiesToolName(location.search);
  const presetsResult = useApi(api.conversationPlansWorkspace, 'capabilities-rail-presets');
  const tasksResult = useApi(api.tasks, 'capabilities-rail-tasks');
  const toolsResult = useApi(api.tools, 'capabilities-rail-tools');

  const presets = [...(presetsResult.data?.presetLibrary.presets ?? [])].sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '') || left.name.localeCompare(right.name));
  const tasks = sortCapabilityTasks(tasksResult.data ?? []);
  const tools = sortCapabilityTools(toolsResult.data?.tools ?? []);
  const defaultPresetIds = presetsResult.data?.presetLibrary.defaultPresetIds ?? [];
  const selectedPreset = presets.find((item) => item.id === selectedPresetId) ?? null;
  const selectedTool = tools.find((item) => item.name === selectedToolName) ?? null;

  if (selectedPreset) return <CapabilitiesPresetContext preset={selectedPreset} isDefault={defaultPresetIds.includes(selectedPreset.id)} />;
  if (selectedTaskId) return <CapabilitiesTaskContext taskId={selectedTaskId} />;
  if (selectedTool) return <CapabilitiesToolContext tool={selectedTool} />;
  if (presetsResult.loading && !presetsResult.data && tasksResult.loading && !tasksResult.data && toolsResult.loading && !toolsResult.data) {
    return <LoadingState label="Loading capabilities…" className="px-4 py-4" />;
  }
  if (!presetsResult.data && !tasksResult.data && !toolsResult.data && (presetsResult.error || tasksResult.error || toolsResult.error)) {
    return <ErrorState message={`Failed to load capabilities: ${[presetsResult.error, tasksResult.error, toolsResult.error].filter(Boolean).join(' · ')}`} className="px-4 py-4" />;
  }

  return (
    <CapabilitiesOverviewContext
      section={section}
      presets={presets}
      defaultPresetIds={defaultPresetIds}
      tasks={tasks}
      tools={tools}
      unavailableCliCount={(toolsResult.data?.dependentCliTools ?? []).filter((tool) => !tool.binary.available).length}
      mcpServerCount={toolsResult.data?.mcp.servers.length ?? 0}
    />
  );
}

function SettingsOverviewContext() {
  return (
    <div className="px-4 py-4 space-y-4">
      <div className="space-y-1">
        <p className="ui-card-title">Settings</p>
        <p className="ui-card-meta">This page controls runtime defaults, profiles, layout preferences, and integration settings for the web UI.</p>
      </div>

      <div className="space-y-2">
        <RailMetadataRow label="Profiles" value="Active profile, requested profile, and switching" />
        <RailMetadataRow label="Defaults" value="Model, cwd, and new-session behavior" />
        <RailMetadataRow label="Layout" value="Sidebar width, rail width, and reset actions" />
      </div>

      <div className="space-y-2 border-t border-border-subtle pt-4">
        <p className="ui-section-label">What lives here</p>
        <p className="ui-card-meta">Use Settings for stable preferences. Use System for live service state, runs, logs, and operational debugging.</p>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function ContextRail() {
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);
  const section = parts[0];
  const id = parts[1];
  const selectedArtifactId = getConversationArtifactIdFromSearch(location.search);
  const selectedRunId = getConversationRunIdFromSearch(location.search);
  const scheduledSection = section === 'scheduled' || section === 'automations' || section === 'tasks';
  const creatingScheduledTask = scheduledSection && new URLSearchParams(location.search).get('new') === '1';
  const selectedPlanId = new URLSearchParams(location.search).get('plan')?.trim() || null;
  const creatingPlan = new URLSearchParams(location.search).get('new') === '1';

  // Presets
  if (section === 'plans') return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <RailHeader label="Todo Presets" sub={selectedPlanId ?? (creatingPlan ? 'new preset' : undefined)} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {suspendRailPanel(
          selectedPlanId || creatingPlan
            ? <AutomationPresetPanel presetId={selectedPlanId} creatingNew={creatingPlan} />
            : <EmptyPrompt text="Select a todo preset or create a new one to edit reusable todo presets." />,
          'Loading todo presets…',
        )}
      </div>
    </div>
  );

  // Conversations
  if (section === 'conversations' && id && selectedArtifactId) return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <RailHeader label="Artifact" sub={selectedArtifactId} />
      {suspendRailPanel(
        <ConversationArtifactPanel conversationId={id} artifactId={selectedArtifactId} />,
        'Loading artifact…',
      )}
    </div>
  );
  if (section === 'conversations' && id === DRAFT_CONVERSATION_ID) return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <RailHeader label="Draft" />
      <DraftConversationContextPanel />
    </div>
  );
  if (section === 'conversations' && id && selectedRunId) return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <RailHeader label="Run" sub={selectedRunId} />
      <RunContextPanel conversationId={id} runId={selectedRunId} />
    </div>
  );
  if (section === 'conversations' && id) return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <RailHeader label="Session" />
      <LiveSessionContextPanel id={id} />
    </div>
  );
  if (section === 'conversations') return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <RailHeader label="Conversations" sub="workspace" />
      <ConversationsWorkspaceContext />
    </div>
  );

  // Scheduled tasks
  if (creatingScheduledTask) return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <RailHeader label="Scheduled task" sub="new" />
      {suspendRailPanel(<ScheduledTaskCreatePanel />, 'Loading task editor…')}
    </div>
  );
  if (scheduledSection && id) return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <RailHeader label="Scheduled task" sub={id} />
      {suspendRailPanel(<ScheduledTaskPanel id={id} />, 'Loading scheduled task…')}
    </div>
  );
  if (scheduledSection) return (
    <div className="flex-1 flex flex-col">
      <RailHeader label="Scheduled" />
      <EmptyPrompt text="Select a scheduled task or start a new one." />
    </div>
  );

  // Inbox
  if (section === 'inbox' && id) return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <RailHeader label="Inbox" sub={id} />
      <div className="flex-1 overflow-y-auto">
        <InboxItemContext id={id} />
      </div>
    </div>
  );
  if (section === 'inbox') return (
    <div className="flex-1 flex flex-col">
      <RailHeader label="Inbox" />
      <EmptyPrompt text="Select an item to see details." />
    </div>
  );

  // Projects
  if (section === 'projects' && id) return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <RailHeader label="Project" />
      <div className="flex-1 overflow-y-auto">
        <ProjectDetailContext id={id} />
      </div>
    </div>
  );
  if (section === 'projects') return (
    <div className="flex-1 flex flex-col">
      <RailHeader label="Project" />
      <EmptyPrompt text="Select a project to inspect and edit it." />
    </div>
  );

  // Managed memories
  if (section === 'memories') {
    const params = new URLSearchParams(location.search);
    const memoryId = params.get(MANAGED_MEMORY_ID_SEARCH_PARAM)?.trim() || null;
    const relativePath = params.get(MANAGED_MEMORY_FILE_SEARCH_PARAM)?.trim() || null;

    if (memoryId) {
      return (
        <div className="flex-1 flex flex-col overflow-hidden">
          <RailHeader label="Memory" sub={relativePath ? `@${memoryId} · ${relativePath}` : `@${memoryId}`} />
          <div className="flex-1 overflow-y-auto">
            <MemoryDocContext memoryId={memoryId} relativePath={relativePath} />
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col">
        <RailHeader label="Memory" />
        <EmptyPrompt text="Select a memory package to inspect its MEMORY.md, relationships, and package-local references." />
      </div>
    );
  }

  // Tools
  if (section === 'tools') {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <RailHeader label="Tools" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {suspendRailPanel(<ToolsContextPanel />, 'Loading tools…')}
        </div>
      </div>
    );
  }

  // Memory
  if (section === 'memory') {
    const itemPath = new URLSearchParams(location.search).get('item');
    if (itemPath) {
      const fileName = itemPath.split('/').pop() ?? itemPath;
      return (
        <div className="flex-1 flex flex-col overflow-hidden">
          <RailHeader label="Memory" sub={fileName} />
          <div className="flex-1 overflow-y-auto">
            <MemoryFileContext path={itemPath} />
          </div>
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <RailHeader label="Memory" />
        <div className="flex-1 overflow-y-auto">
          <MemoryOverviewContext />
        </div>
      </div>
    );
  }

  // Workspace
  if (section === 'workspace') {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <RailHeader label="Workspace" sub="files" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {suspendRailPanel(<WorkspaceRail />, 'Loading workspace tree…')}
        </div>
      </div>
    );
  }

  // Knowledge Base
  if (section === 'knowledge') {
    const knowledgeSection = getKnowledgeSection(location.search);
    const projectId = getKnowledgeProjectId(location.search);
    const memoryId = getKnowledgeMemoryId(location.search);
    const skillName = getKnowledgeSkillName(location.search);
    const instructionPath = getKnowledgeInstructionPath(location.search);
    const knowledgeSub = projectId
      ?? (memoryId ? `@${memoryId}` : null)
      ?? skillName
      ?? (instructionPath ? instructionPath.split('/').pop() ?? instructionPath : null)
      ?? knowledgeSection;

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <RailHeader label="Knowledge Base" sub={knowledgeSub} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <KnowledgeContextPanel />
        </div>
      </div>
    );
  }

  // Capabilities
  if (section === 'capabilities') {
    const capabilitiesSection = getCapabilitiesSection(location.search);
    const presetId = getCapabilitiesPresetId(location.search);
    const taskId = getCapabilitiesTaskId(location.search);
    const toolName = getCapabilitiesToolName(location.search);
    const capabilitiesSub = presetId ?? taskId ?? toolName ?? capabilitiesSection;

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <RailHeader label="Capabilities" sub={capabilitiesSub} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CapabilitiesContextPanel />
        </div>
      </div>
    );
  }

  // System
  if (section === 'system') {
    const runId = getSystemRunIdFromSearch(location.search);
    const componentId = getSystemComponentFromSearch(location.search);
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <RailHeader label="System" sub={runId ? 'Run' : getSystemComponentLabel(componentId)} />
        <div className="min-h-0 flex-1">
          {runId ? <RunContextPanel runId={runId} simplified /> : <SystemContextPanel componentId={componentId} />}
        </div>
      </div>
    );
  }

  if (section === 'settings') {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <RailHeader label="Settings" sub="preferences" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SettingsOverviewContext />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
      <p className="text-[12px] text-dim">Select a conversation, project, or inbox item to see context.</p>
    </div>
  );
}
