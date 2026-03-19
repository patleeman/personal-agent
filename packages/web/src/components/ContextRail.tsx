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
import { useReloadState } from '../reloadState';
import {
  getRunConnections,
  getRunHeadline,
  getRunSortTimestamp,
  getRunTimeline,
  type RunPresentationLookups,
} from '../runPresentation';
import {
  isProjectArchived,
  pickAttachProjectId,
  pickFocusedProjectId,
} from '../contextRailProject';
import { useApi } from '../hooks';
import { useDurableRunStream } from '../hooks/useDurableRunStream';
import { useConversations } from '../hooks/useConversations';
import { displayBlockToMessageBlock } from '../messageBlocks';
import { buildCapabilityCards, buildIdentitySummary, buildKnowledgeSections, buildMemoryPageSummary } from '../memoryOverview';
import { emitMemoriesChanged } from '../memoryDocEvents';
import type { ActivityEntry, ConversationExecutionState, DurableRunDetailResult, DurableRunRecord, LiveSessionContext, ProjectDetail, ProjectRecord, RemoteFolderListing } from '../types';
import { formatDate, kindMeta, timeAgo } from '../utils';
import { useAppData, useAppEvents } from '../contexts';
import { emitProjectsChanged, PROJECTS_CHANGED_EVENT } from '../projectEvents';
import { CONVERSATION_PROJECTS_CHANGED_EVENT, emitConversationProjectsChanged } from '../conversationProjectEvents';
import { closeConversationTab, ensureConversationTabOpen } from '../sessionTabs';
import { ErrorState, IconButton, LoadingState, Pill, SurfacePanel } from './ui';
import { ConversationAutomationPanel } from './ConversationAutomationPanel';

const ConversationArtifactPanel = lazy(() => import('./ConversationArtifactPanel').then((module) => ({ default: module.ConversationArtifactPanel })));
const ProjectDetailPanel = lazy(() => import('./ProjectDetailPanel').then((module) => ({ default: module.ProjectDetailPanel })));
const ProjectOverviewPanel = lazy(() => import('./ProjectOverviewPanel').then((module) => ({ default: module.ProjectOverviewPanel })));
const ScheduledTaskCreatePanel = lazy(() => import('./ScheduledTaskPanel').then((module) => ({ default: module.ScheduledTaskCreatePanel })));
const ScheduledTaskPanel = lazy(() => import('./ScheduledTaskPanel').then((module) => ({ default: module.ScheduledTaskPanel })));
const ToolsContextPanel = lazy(() => import('./ToolsContextPanel').then((module) => ({ default: module.ToolsContextPanel })));
const AutomationPresetPanel = lazy(() => import('./AutomationPresetPanel').then((module) => ({ default: module.AutomationPresetPanel })));

function suspendRailPanel(element: React.ReactNode, label = 'Loading…') {
  return (
    <Suspense fallback={<LoadingState label={label} className="justify-center h-full" />}>
      {element}
    </Suspense>
  );
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

function RunContextPanel({ conversationId, runId }: { conversationId?: string; runId: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { tasks, sessions } = useAppData();
  const [cancelling, setCancelling] = useState(false);
  const [importingRemote, setImportingRemote] = useState(false);
  const lookups = useMemo<RunPresentationLookups>(() => ({ tasks, sessions }), [tasks, sessions]);
  const {
    detail,
    log,
    loading,
    error,
    reconnect,
  } = useDurableRunStream(runId, 120);

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
  const connections = getRunConnections(run, lookups);
  const timeline = getRunTimeline(run);
  const showRecovery = run.recoveryAction !== 'none';
  const cancelable = canCancelRun(run);
  const closeSearch = conversationId ? setConversationRunIdInSearch(location.search, null) : '';
  const currentConversationPath = conversationId ? `/conversations/${encodeURIComponent(conversationId)}` : null;
  const showConversationChrome = Boolean(conversationId);
  const remoteExecution = run.remoteExecution;

  async function handleImportRemote() {
    if (!remoteExecution || importingRemote || remoteExecution.importStatus !== 'ready') {
      return;
    }

    setImportingRemote(true);
    try {
      await api.importRemoteRun(run.runId);
      reconnect();
    } finally {
      setImportingRemote(false);
    }
  }

  return (
    <div className="space-y-4 px-4 py-4 overflow-y-auto">
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
          {showConversationChrome && (
            <Link to={`/runs/${encodeURIComponent(runId)}`} className="ui-toolbar-button text-accent" title="Open on the Agent Runs page">
              Full page
            </Link>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <p className="ui-card-title break-words">{headline.title}</p>
        <p className="ui-card-meta flex flex-wrap items-center gap-1.5">
          <span className={status.cls}>{status.text}</span>
          <span className="opacity-40">·</span>
          <span>{headline.summary}</span>
          {showRecovery && (
            <>
              <span className="opacity-40">·</span>
              <span>{formatRecoveryAction(run.recoveryAction)}</span>
            </>
          )}
        </p>
        <p className="text-[11px] font-mono text-dim break-all">{run.runId}</p>
      </div>

      {cancelable && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2.5">
          <p className="text-[12px] text-secondary">This background run can still be cancelled.</p>
          <button type="button" onClick={() => { void handleCancel(); }} disabled={cancelling} className="ui-toolbar-button text-danger">
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
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
          <p className="text-[12px] text-secondary break-words">{remoteExecution.prompt}</p>
          <p className="text-[12px] text-secondary">
            Import status: <span className={remoteExecution.importStatus === 'imported' ? 'text-success' : remoteExecution.importStatus === 'ready' ? 'text-warning' : remoteExecution.importStatus === 'failed' ? 'text-danger' : 'text-dim'}>{remoteExecution.importStatus}</span>
          </p>
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

      {timeline.length > 0 && (
        <div className="border-t border-border-subtle pt-3">
          <p className="ui-section-label mb-2">Timeline</p>
          <div className="space-y-2">
            {timeline.map((item) => (
              <div key={item.label} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="text-dim uppercase tracking-[0.12em]">{item.label}</span>
                <span className="text-primary text-right">{formatDate(item.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-border-subtle pt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="ui-section-label">Run state</p>
          <p className="text-[13px] text-primary">{run.manifest?.kind ?? 'unknown kind'}</p>
          {run.manifest?.resumePolicy && <p className="text-[12px] text-secondary">resume policy {run.manifest.resumePolicy}</p>}
          {run.manifest?.source?.type && <p className="text-[12px] text-secondary">source {run.manifest.source.type}</p>}
        </div>

        <div className="space-y-1">
          <p className="ui-section-label">Attempts</p>
          <p className="text-[13px] text-primary">{run.status?.activeAttempt ?? 0}</p>
          {run.checkpoint?.step && <p className="text-[12px] text-secondary">checkpoint {run.checkpoint.step}</p>}
          {run.checkpoint?.cursor && <p className="text-[12px] text-secondary">cursor {run.checkpoint.cursor}</p>}
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

      <div className="border-t border-border-subtle pt-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="ui-section-label">Output log</p>
          {log?.path && <p className="text-[10px] font-mono text-dim truncate">{log.path.split('/').slice(-2).join('/')}</p>}
        </div>
        <pre className="max-h-80 overflow-y-auto rounded-lg bg-elevated px-3 py-2.5 text-[11px] leading-relaxed text-secondary whitespace-pre-wrap break-all">
          {log?.log || '(empty)'}
        </pre>
      </div>

      {error && <ErrorState message={error} />}
      {conversationId && <p className="text-[10px] text-dim">This run belongs to the current conversation.</p>}
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
      <Section title="Todo list">
        <ConversationAutomationPanel conversationId={DRAFT_CONVERSATION_ID} />
      </Section>

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
    </div>
  );
}

function LiveSessionContextPanel({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { versions } = useAppEvents();
  const { tasks, sessions } = useAppData();
  const [data, setData] = useState<LiveSessionContext | null>(null);
  const [execution, setExecution] = useState<ConversationExecutionState | null>(null);
  const [allProjects, setAllProjects] = useState<ProjectRecord[]>([]);
  const [focusedProjectId, setFocusedProjectId] = useState('');
  const [attachProjectId, setAttachProjectId] = useState('');
  const [focusedProject, setFocusedProject] = useState<ProjectDetail | null>(null);
  const [detectedRunMentions, setDetectedRunMentions] = useState<ReturnType<typeof collectConversationRunMentions>>([]);
  const [runRecordsById, setRunRecordsById] = useState<Map<string, DurableRunRecord>>(new Map());
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
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

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    Promise.all([api.liveSessionContext(id), api.projects(), api.conversationExecution(id)])
      .then(([context, projects, nextExecution]) => {
        if (cancelled) return;
        setData(context);
        setExecution(nextExecution);
        setAllProjects(projects);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const result = await api.runs();
      setRunRecordsById(new Map(result.runs.map((run) => [run.runId, run] as const)));
      setRunsError(null);
    } catch (nextError) {
      setRunsError(nextError instanceof Error ? nextError.message : 'Could not load run metadata.');
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const runLookups = useMemo<RunPresentationLookups>(() => ({ tasks, sessions }), [tasks, sessions]);
  const isSessionRunning = Boolean(sessions?.find((session) => session.id === id)?.isRunning);
  const runMentionsLastFetchedAtRef = useRef(0);
  const autoExpandedConnectedRunsConversationIdRef = useRef<string | null>(null);

  useEffect(() => load(), [load]);
  useEffect(() => {
    void loadRuns();
  }, [id, loadRuns, versions.runs]);

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

    api.sessionDetail(id, { tailBlocks: 400 })
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

  if (loading) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse">Loading…</div>;
  if (error) return <div className="px-4 py-4 text-[12px] text-dim/60">Unable to load context.</div>;
  if (!data) return null;

  const gitChangeLabel = data.git
    ? `${data.git.changeCount} ${data.git.changeCount === 1 ? 'change' : 'changes'}`
    : null;

  return (
    <div className="space-y-5 px-4 py-4">
      <Section title="Working Directory">
        <SurfacePanel muted className="px-3 py-3 space-y-2.5">
          <div className="space-y-2">
            <p className="ui-card-body min-w-0 overflow-x-auto whitespace-nowrap pr-1 font-mono text-primary" title={data.cwd}>{data.cwd}</p>
            <div className="flex items-center justify-end gap-0.5">
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
          {(data.branch || data.git) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-secondary">
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
                  {gitChangeLabel}{' '}
                  <span className="text-success">+{data.git.linesAdded}</span>{' '}
                  <span className="text-danger">-{data.git.linesDeleted}</span>
                </span>
              )}
            </div>
          )}
          {(openCwdError || changeCwdError) && (
            <p className="text-[11px] text-danger/80">{changeCwdError ?? openCwdError}</p>
          )}
        </SurfacePanel>
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

      <Section title="Todo list">
        <ConversationAutomationPanel conversationId={id} />
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
                  <Link key={projectId} to={`/projects/${projectId}`} className="ui-card-meta font-mono text-accent hover:text-accent/80">
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

  // Checklists
  if (section === 'plans') return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <RailHeader label="Checklists" sub={selectedPlanId ?? (creatingPlan ? 'new checklist' : undefined)} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {suspendRailPanel(
          selectedPlanId || creatingPlan
            ? <AutomationPresetPanel presetId={selectedPlanId} creatingNew={creatingPlan} />
            : <EmptyPrompt text="Select a checklist or create a new one to edit reusable checklists." />,
          'Loading checklists…',
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

  // Agent runs
  if (section === 'runs' && id) return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <RailHeader label="Run" sub={id} />
      <RunContextPanel runId={id} />
    </div>
  );
  if (section === 'runs') return (
    <div className="flex-1 flex flex-col">
      <RailHeader label="Run" />
      <EmptyPrompt text="Select a run to inspect it here." />
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

  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
      <p className="text-[12px] text-dim">Select a conversation, project, or inbox item to see context.</p>
    </div>
  );
}
