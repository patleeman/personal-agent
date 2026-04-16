import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../client/api';
import { setConversationArtifactIdInSearch } from '../conversation/conversationArtifacts';
import {
  collectConversationRunMentions,
  createConversationLiveRunId,
  getConversationRunIdFromSearch,
  setConversationRunIdInSearch,
} from '../conversation/conversationRuns';
import {
  buildDraftConversationCwdStorageKey,
  DRAFT_CONVERSATION_ID,
} from '../conversation/draftConversation';
import { buildCapabilitiesSearch, getCapabilitiesPresetId, getCapabilitiesSection, getCapabilitiesTaskId, getCapabilitiesToolName } from '../navigation/capabilitiesSelection';
import { useReloadState } from '../local/reloadState';
import {
  getRunConnections,
  getRunHeadline,
  getRunTargetCommand,
  getRunTargetModel,
  getRunTargetProfile,
  getRunTargetPrompt,
  getRunTaskSlug,
  getRunTimeline,
  getRunWorkingDirectory,
  isRunActive,
  listConnectedConversationBackgroundRuns,
  type RunPresentationLookups,
} from '../automation/runPresentation';
import { useApi } from '../hooks';
import { useDurableRunStream } from '../hooks/useDurableRunStream';
import { useConversations } from '../hooks/useConversations';
import { fetchSessionDetailCached } from '../hooks/useSessions';
import { displayBlockToMessageBlock } from '../transcript/messageBlocks';
import { formatTaskSchedule } from '../automation/taskSchedule';
import type {
  AgentToolInfo,
  DurableRunDetailResult,
  ScheduledTaskSummary,
} from '../types';
import { timeAgo } from '../utils';
import { useAppData, useAppEvents } from '../contexts';
import { completeConversationOpenPhase } from '../client/perfDiagnostics';
import { sessionNeedsAttention } from '../session/sessionIndicators';
import { ErrorState, IconButton, LoadingState, Pill, cx } from './ui';
import { RichMarkdownRenderer } from './editor/RichMarkdownRenderer';

const ScheduledTaskPanel = lazy(() => import('./ScheduledTaskPanel').then((module) => ({ default: module.ScheduledTaskPanel })));

function suspendRailPanel(element: React.ReactNode, label = 'Loading…') {
  return (
    <Suspense fallback={<LoadingState label={label} className="justify-center h-full" />}>
      {element}
    </Suspense>
  );
}

export function prefetchConversationRailData(input: {
  conversationId: string;
  workspaceVersion: number;
  runsVersion: number;
}): Promise<void> {
  void input.conversationId;
  void input.workspaceVersion;
  void input.runsVersion;
  return Promise.resolve();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('space-y-3 border-t border-border-subtle pt-4 first:border-t-0 first:pt-0', className)}>
      <h3 className="text-[13px] font-semibold text-primary">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ConversationInspectorShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ui-node-workspace-chrome h-full min-h-0 overflow-y-auto px-5 py-5">
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

type ConversationRelatedWorkGroupKey = 'conversation' | 'background' | 'mentioned' | 'other';

interface ConversationRelatedWorkMention {
  runId: string;
  label: string;
  meta: string;
  selected: boolean;
  source: ConversationRelatedWorkGroupKey;
}

interface ConversationRelatedWorkCard {
  mention: ConversationRelatedWorkMention;
  record?: DurableRunDetailResult['run'];
  headline: ReturnType<typeof getRunHeadline> | null;
  status: { text: string; cls: string };
  activityAt?: string;
}

export function groupConversationRailRunCards<T extends { mention: { source: ConversationRelatedWorkGroupKey } }>(cards: T[]): Array<{
  key: ConversationRelatedWorkGroupKey;
  title: string;
  items: T[];
}> {
  const groups: Array<{
    key: ConversationRelatedWorkGroupKey;
    title: string;
    items: T[];
  }> = [
    { key: 'conversation', title: 'This conversation', items: [] },
    { key: 'background', title: 'Background work', items: [] },
    { key: 'mentioned', title: 'Mentioned in the thread', items: [] },
    { key: 'other', title: 'Other related work', items: [] },
  ];

  for (const card of cards) {
    const group = groups.find((entry) => entry.key === card.mention.source) ?? groups[groups.length - 1]!;
    group.items.push(card);
  }

  return groups.filter((group) => group.items.length > 0);
}

export function formatConversationRailRunSummary(input: {
  loading: boolean;
  totalCount: number;
  activeCount: number;
  reviewCount: number;
  hasOnlyUnresolvedCards: boolean;
}): string {
  if (input.loading && input.hasOnlyUnresolvedCards) {
    return 'Refreshing runs…';
  }

  if (input.totalCount === 0) {
    return 'No runs';
  }

  if (input.activeCount === input.totalCount && input.reviewCount === 0) {
    return `${input.activeCount} active`;
  }

  const parts = [`${input.totalCount} run${input.totalCount === 1 ? '' : 's'}`];
  if (input.activeCount > 0) {
    parts.push(`${input.activeCount} active`);
  }
  if (input.reviewCount > 0) {
    parts.push(`${input.reviewCount} need review`);
  }
  return parts.join(' · ');
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

function compactRunCardSummary(
  summary: string | null | undefined,
  title?: string | null,
  conversationId?: string,
): string | null {
  let trimmed = summary?.trim() ?? '';
  if (!trimmed) {
    return null;
  }

  if (conversationId) {
    const suffix = ` · ${conversationId}`;
    if (trimmed.endsWith(suffix)) {
      trimmed = trimmed.slice(0, -suffix.length).trim();
    }
  }

  if (!trimmed || (title && trimmed === title.trim())) {
    return null;
  }

  if (/^(Live conversation|Conversation run|Background run|Wakeup|Scheduled task|Shell run|Workflow)( · .+)?$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function formatRecoveryAction(action: string): string {
  switch (action) {
    case 'none': return 'stable';
    case 'resume': return 'resume';
    case 'rerun': return 'rerun';
    case 'attention': return 'manual review';
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
  return isRunActive(detail);
}

function RunContextPanel({
  runId,
  ownerRoute,
  closeLabel,
  simplified = false,
}: {
  runId: string;
  ownerRoute?: string;
  closeLabel?: string;
  simplified?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { tasks, sessions, setRuns } = useAppData();
  const [cancelling, setCancelling] = useState(false);
  const [markingReviewed, setMarkingReviewed] = useState(false);
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
    navigate({
      pathname: location.pathname,
      search: setConversationRunIdInSearch(location.search, null),
    });
  }, [location.pathname, location.search, navigate]);

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

  async function handleMarkReviewed() {
    if (!detail || markingReviewed || !detail.run.attentionSignature) {
      return;
    }

    setActionError(null);
    setMarkingReviewed(true);
    try {
      await api.markDurableRunAttentionRead(detail.run.runId);
      setRuns(await api.runs());
      reconnect();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not mark the run as reviewed.');
    } finally {
      setMarkingReviewed(false);
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
  const taskSlug = getRunTaskSlug(run);
  const targetPrompt = getRunTargetPrompt(run);
  const targetCommand = getRunTargetCommand(run);
  const targetCwd = getRunWorkingDirectory(run);
  const targetModel = getRunTargetModel(run);
  const targetProfile = getRunTargetProfile(run);
  const connections = getRunConnections(run, lookups).filter((connection) => connection.label !== 'Source file');
  const timeline = getRunTimeline(run);
  const showRecovery = run.recoveryAction !== 'none';
  const cancelable = canCancelRun(run);
  const showOwnerChrome = Boolean(closeLabel);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 py-4 space-y-4">
        <div className={showOwnerChrome ? 'flex items-center justify-between gap-2' : 'flex items-center justify-end gap-1.5'}>
          {showOwnerChrome && (
            <button type="button" onClick={closeRun} className="ui-toolbar-button">
              ← {closeLabel}
            </button>
          )}
          <div className="flex items-center gap-1.5">
            {run.attentionSignature && (
              <button
                type="button"
                onClick={() => { void handleMarkReviewed(); }}
                disabled={markingReviewed || run.attentionDismissed}
                className="ui-toolbar-button"
              >
                {run.attentionDismissed ? 'Reviewed' : markingReviewed ? 'Reviewing…' : 'Mark reviewed'}
              </button>
            )}
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

        {connections.length > 0 && (
          <div className="border-t border-border-subtle pt-3">
            <p className="ui-section-label mb-2">Connected to</p>
            <div className="space-y-2">
              {connections.map((connection) => {
                const isCurrentOwnerConnection = ownerRoute !== undefined && connection.to === ownerRoute;
                const detailText = isCurrentOwnerConnection
                  ? ['Current view', connection.detail].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' · ')
                  : connection.detail;
                const connectionHref = connection.to ?? null;

                return (
                  <div key={connection.key} className="space-y-0.5">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-dim">{connection.label}</p>
                    {isCurrentOwnerConnection ? (
                      <button
                        type="button"
                        onClick={closeRun}
                        className="text-left text-[13px] text-accent hover:underline break-all"
                        title="Return to the current view"
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

        <div className="border-t border-border-subtle pt-3 space-y-2">
          <p className="ui-section-label">Run details</p>
          <div className="space-y-2">
            {taskSlug && <RailMetadataRow label="Task" value={taskSlug} />}
            {targetPrompt && <RailMetadataRow label="Prompt" value={<span className="whitespace-pre-wrap break-words text-[12px] text-primary">{targetPrompt}</span>} />}
            {targetCommand && <RailMetadataRow label="Command" value={<span className="break-all font-mono text-[12px] text-primary">{targetCommand}</span>} />}
            {targetCwd && <RailMetadataRow label="Working dir" value={<span className="break-all font-mono text-[12px] text-primary">{targetCwd}</span>} />}
            {targetModel && <RailMetadataRow label="Model" value={targetModel} />}
            {targetProfile && <RailMetadataRow label="Profile" value={targetProfile} />}
            <RailMetadataRow label="Run" value={run.manifest?.kind ?? 'unknown kind'} />
            <RailMetadataRow label="Source" value={run.manifest?.source?.type ?? 'unknown'} />
            <RailMetadataRow label="Attempt" value={run.status?.activeAttempt ?? 0} />
            {run.checkpoint?.step && <RailMetadataRow label="Checkpoint" value={run.checkpoint.step} />}
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

function DraftConversationContextPanel() {
  const [draftCwd, setDraftCwd, clearDraftCwd] = useReloadState<string>({
    storageKey: buildDraftConversationCwdStorageKey(),
    initialValue: '',
    shouldPersist: (value) => value.trim().length > 0,
  });
  const [changingCwd, setChangingCwd] = useState(false);
  const [requestedCwd, setRequestedCwd] = useState(draftCwd);
  const [pickCwdBusy, setPickCwdBusy] = useState(false);
  const [changeCwdError, setChangeCwdError] = useState<string | null>(null);

  useEffect(() => {
    if (!changingCwd) {
      setRequestedCwd(draftCwd);
    }
  }, [draftCwd, changingCwd]);

  const hasExplicitCwd = draftCwd.trim().length > 0;

  async function pickDraftCwd() {
    if (pickCwdBusy) {
      return;
    }

    setPickCwdBusy(true);
    setChangeCwdError(null);
    try {
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

  function startChangingCwd() {
    setRequestedCwd(draftCwd);
    setChangeCwdError(null);
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
    setChangingCwd(false);
  }

  function clearExplicitCwd() {
    clearDraftCwd();
    setRequestedCwd('');
    setChangeCwdError(null);
    setChangingCwd(false);
  }

  return (
    <div className="px-4 py-4">
      <Section title="Working Directory">
        <div className="flex items-start gap-2">
          {hasExplicitCwd ? (
            <p className="ui-card-body min-w-0 flex-1 break-all pr-1 font-mono text-primary" title={draftCwd}>{draftCwd}</p>
          ) : (
            <p className="ui-card-body min-w-0 flex-1 text-dim">No working directory set.</p>
          )}
          <div className="flex shrink-0 items-center gap-0.5">
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
              disabled={pickCwdBusy}
              className="text-accent"
              title={pickCwdBusy ? 'Choosing working directory…' : 'Choose the initial working directory for this draft conversation'}
              aria-label="Choose the initial working directory for this draft conversation"
            >
              <FolderIcon className={pickCwdBusy ? 'animate-pulse' : undefined} />
            </IconButton>
            <IconButton
              compact
              onClick={startChangingCwd}
              disabled={pickCwdBusy}
              title="Enter the working directory manually"
              aria-label="Enter the working directory manually"
            >
              <PencilIcon />
            </IconButton>
          </div>
        </div>
        {changingCwd && (
          <form
            className="space-y-2 border-t border-border-subtle/70 pt-3"
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
              placeholder="~/workingdir/repo"
              spellCheck={false}
              disabled={pickCwdBusy}
              aria-label="Draft conversation working directory"
              className="w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] font-mono text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-dim">Use the folder picker above for the default flow, or enter an absolute, ~, or relative path here.</p>
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
        {changeCwdError && (
          <p className="text-[11px] text-danger/80">{changeCwdError}</p>
        )}
      </Section>
    </div>
  );
}

function LiveSessionContextPanel({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { versions } = useAppEvents();
  const { tasks, sessions, runs, setRuns } = useAppData();
  const [detectedRunMentions, setDetectedRunMentions] = useState<ReturnType<typeof collectConversationRunMentions>>([]);
  const [runsExpanded, setRunsExpanded] = useState(false);

  useEffect(() => {
    if (runs !== null) {
      return;
    }

    let cancelled = false;
    void api.runs()
      .then((nextRuns) => {
        if (!cancelled) {
          setRuns(nextRuns);
        }
      })
      .catch(() => {
        // Leave the connected-runs section in loading state until the next retry.
      });

    return () => {
      cancelled = true;
    };
  }, [runs, setRuns]);

  const runRecordsById = useMemo(
    () => new Map((runs?.runs ?? []).map((run) => [run.runId, run] as const)),
    [runs],
  );
  const runsLoading = runs === null;
  const runsError = null;
  const runLookups = useMemo<RunPresentationLookups>(() => ({ tasks, sessions }), [tasks, sessions]);
  const isSessionRunning = Boolean(sessions?.find((session) => session.id === id)?.isRunning);
  const runMentionsLastFetchedAtRef = useRef(0);
  const autoExpandedConnectedRunsConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      completeConversationOpenPhase(id, 'rail', {
        state: 'loaded',
        hasContext: false,
        hasExecution: false,
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [id]);

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

    fetchSessionDetailCached(id, { tailBlocks: 400 }, versions.sessionFiles)
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
  }, [id, versions.sessionFiles, isSessionRunning]);

  useEffect(() => {
    setRunsExpanded(false);
  }, [id]);

  const selectedRunId = getConversationRunIdFromSearch(location.search);
  const currentConversationRunId = createConversationLiveRunId(id);
  const connectedBackgroundRuns = useMemo(() => listConnectedConversationBackgroundRuns({
    conversationId: id,
    runs,
    lookups: runLookups,
    excludeConversationRunId: currentConversationRunId,
  }), [currentConversationRunId, id, runLookups, runs]);
  const visibleRunMentions = useMemo(() => {
    const next: ConversationRelatedWorkMention[] = [];
    const seen = new Set<string>();

    const push = (
      runId: string,
      label: string,
      meta: string,
      source: ConversationRelatedWorkGroupKey,
    ) => {
      if (seen.has(runId)) {
        return;
      }

      seen.add(runId);
      next.push({
        runId,
        label,
        meta,
        selected: selectedRunId === runId,
        source,
      });
    };

    push(currentConversationRunId, 'This conversation', 'Tracks this conversation state and recovery metadata.', 'conversation');

    for (const run of connectedBackgroundRuns) {
      push(run.runId, 'Background work', 'Started from this conversation.', 'background');
    }

    for (const mention of detectedRunMentions) {
      const mentionMeta = mention.mentionCount > 1
        ? `Mentioned ${mention.mentionCount} times · last seen ${timeAgo(mention.lastSeenAt)}`
        : `Mentioned ${timeAgo(mention.lastSeenAt)}`;
      push(mention.runId, 'Mentioned in the thread', mentionMeta, 'mentioned');
    }

    return next;
  }, [connectedBackgroundRuns, currentConversationRunId, detectedRunMentions, selectedRunId]);

  const visibleRunCards = useMemo<ConversationRelatedWorkCard[]>(() => {
    return visibleRunMentions.map((mention) => {
      const record = runRecordsById.get(mention.runId);
      const headline = record ? getRunHeadline(record, runLookups) : null;
      const status = record ? runStatusText(record) : { text: 'unresolved', cls: 'text-dim' };
      const activityAt = record?.status?.completedAt
        ?? record?.status?.updatedAt
        ?? record?.status?.startedAt
        ?? record?.manifest?.createdAt;

      return {
        mention,
        record,
        headline,
        status,
        activityAt,
      };
    });
  }, [runLookups, runRecordsById, visibleRunMentions]);

  const groupedRunCards = useMemo(
    () => groupConversationRailRunCards(visibleRunCards),
    [visibleRunCards],
  );
  const activeRunCount = visibleRunCards.reduce((count, { record }) => (record && isRefreshingRun(record) ? count + 1 : count), 0);
  const runIssueCount = visibleRunCards.reduce((count, { record }) => (record && record.problems.length > 0 ? count + 1 : count), 0);
  const unresolvedRunCount = visibleRunCards.reduce((count, { record }) => (!record ? count + 1 : count), 0);
  const reviewRunCount = runIssueCount + unresolvedRunCount;
  const runSummary = useMemo(() => formatConversationRailRunSummary({
    loading: runsLoading,
    totalCount: visibleRunCards.length,
    activeCount: activeRunCount,
    reviewCount: reviewRunCount,
    hasOnlyUnresolvedCards: visibleRunCards.every(({ record }) => !record),
  }), [activeRunCount, reviewRunCount, runsLoading, visibleRunCards]);

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

  function openRun(runId: string) {
    navigate({
      pathname: location.pathname,
      search: setConversationRunIdInSearch(
        setConversationArtifactIdInSearch(location.search, null),
        runId,
      ),
    });
  }

  
  return (
    <div className="space-y-4">
      <Section title="Runs">
        <button
          type="button"
          onClick={() => setRunsExpanded((open) => !open)}
          aria-expanded={runsExpanded}
          aria-controls={`conversation-runs-${id}`}
          className="w-full text-left transition-colors hover:text-primary"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-secondary">{runSummary}</span>
            <span className={runsExpanded ? 'text-[10px] uppercase tracking-[0.14em] text-accent' : 'text-[10px] uppercase tracking-[0.14em] text-dim'}>
              {runsExpanded ? 'hide' : 'show'}
            </span>
          </div>
        </button>

        {runsExpanded && (
          <div id={`conversation-runs-${id}`} className="space-y-3 border-t border-border-subtle/70 pt-3">
            {runsLoading && visibleRunCards.every(({ record }) => !record) && (
              <p className="text-[11px] text-dim animate-pulse">Refreshing runs…</p>
            )}
            {runsError && (
              <p className="text-[11px] text-danger/80">{runsError}</p>
            )}
            {groupedRunCards.length > 0 ? (
              <div className="space-y-4">
                {groupedRunCards.map((group) => (
                  <div key={group.key} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="ui-section-label">{group.title}</p>
                      <span className="text-[10px] text-dim">{group.items.length}</span>
                    </div>
                    <div className="divide-y divide-border-subtle/70">
                      {group.items.map(({ mention, record, headline, status, activityAt }) => {
                        const isSelected = mention.selected;
                        const rawTitle = headline?.title ?? mention.label;
                        const title = record && (rawTitle === record.runId || rawTitle.startsWith('run-') || rawTitle.startsWith('conversation-'))
                          ? mention.label
                          : rawTitle;
                        const summary = compactRunCardSummary(headline?.summary ?? mention.meta, title, id);
                        const showSummary = Boolean(summary && summary !== title);
                        const issueCount = record?.problems.length ?? 0;
                        const showRecovery = record && record.recoveryAction !== 'none';
                        const timeLabel = activityAt ? timeAgo(activityAt) : null;

                        return (
                          <button
                            key={mention.runId}
                            type="button"
                            onClick={() => openRun(mention.runId)}
                            className={cx(
                              'w-full py-2.5 text-left transition-colors',
                              isSelected ? 'text-primary' : 'text-secondary hover:text-primary',
                            )}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-[12px] font-medium text-primary">{title}</p>
                              {showSummary && (
                                <p className="mt-0.5 truncate text-[11px] text-secondary">{summary}</p>
                              )}
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
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              !runsLoading && !runsError && <p className="text-[11px] text-dim">No runs right now.</p>
            )}
          </div>
        )}
      </Section>

      <details className="ui-disclosure">
        <summary className="ui-disclosure-summary">
          <span>Details</span>
          <span className="ui-disclosure-meta">Conversation id and execution</span>
        </summary>
        <div className="ui-disclosure-body">
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.14em] text-dim">Conversation</p>
              <p className="break-all font-mono text-[12px] text-secondary">{id}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.14em] text-dim">Execution</p>
              <p className="text-[12px] text-secondary">Local</p>
            </div>
          </div>
        </div>
      </details>

    </div>
  );
}

// ── Task detail ───────────────────────────────────────────────────────────────

function RailMetadataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="ui-detail-row">
      <span className="ui-detail-label">{label}</span>
      <span className="ui-detail-value break-words">{value}</span>
    </div>
  );
}

function RailMarkdownPreview({ content, className }: { content: string; className?: string }) {
  return <RichMarkdownRenderer content={content} className={className ?? 'ui-markdown max-w-none text-[13px] leading-relaxed'} stripFrontmatter />;
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

function ConversationsWorkspaceContext() {
  const { pinnedSessions, tabs, archivedSessions, archivedConversationIds = [], loading, refetch } = useConversations();
  const archivedConversationIdSet = useMemo(
    () => new Set(archivedConversationIds),
    [archivedConversationIds],
  );
  const attentionSessions = useMemo(
    () => [
      ...pinnedSessions,
      ...tabs,
      ...archivedSessions.filter((session) => !archivedConversationIdSet.has(session.id)),
    ].filter((session) => sessionNeedsAttention(session)),
    [archivedConversationIdSet, archivedSessions, pinnedSessions, tabs],
  );

  if (loading) {
    return <LoadingState label="Loading conversations…" className="px-4 py-4" />;
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="ui-card-title">Overview</p>
          <p className="ui-card-meta">Browse pinned, open, and archived conversations in the main pane. Open one to switch this rail back into live session context.</p>
        </div>
        <button type="button" onClick={() => { void refetch(); }} className="ui-toolbar-button shrink-0">↻ Refresh</button>
      </div>

      <div className="space-y-2">
        <RailMetadataRow label="Pinned" value={pinnedSessions.length} />
        <RailMetadataRow label="Open" value={tabs.length} />
        <RailMetadataRow label="Archived" value={archivedSessions.length} />
        <RailMetadataRow label="Needs review" value={attentionSessions.length} />
      </div>

      <div className="space-y-2 border-t border-border-subtle pt-4">
        <p className="ui-section-label">Needs review</p>
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
        <p className="ui-section-label">Open now</p>
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
          <p className="ui-card-title">Reminder presets</p>
          <p className="ui-card-meta">Select a preset on the left to inspect its ordered reminders and defaults.</p>
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

function CapabilitiesTaskContext({ taskId }: { taskId: string }) {
  const { data, loading, error, refreshing, refetch } = useApi(() => api.taskDetail(taskId), `capabilities-task-rail:${taskId}`);
  const [runningNow, setRunningNow] = useState(false);

  const handleRunNow = useCallback(async () => {
    if (!data || runningNow || data.running) {
      return;
    }

    setRunningNow(true);
    try {
      await api.runTaskNow(data.id);
      await refetch({ resetLoading: false });
    } finally {
      setRunningNow(false);
    }
  }, [data, refetch, runningNow]);

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
          <Link to={`/automations/${encodeURIComponent(data.id)}`} className="ui-toolbar-button">Open automation</Link>
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
        <p className="ui-card-meta">This page controls runtime defaults, profiles, layout preferences, desktop connections, and integration settings.</p>
      </div>

      <div className="space-y-2">
        <RailMetadataRow label="Profiles" value="Active profile, requested profile, and switching" />
        <RailMetadataRow label="Defaults" value="Model, cwd, and new-session behavior" />
        <RailMetadataRow label="Layout" value="Sidebar width, rail width, and reset actions" />
      </div>

      <div className="space-y-2 border-t border-border-subtle pt-4">
        <p className="ui-section-label">What lives here</p>
        <p className="ui-card-meta">Use Settings for stable preferences, interface controls, desktop connections, and inline runtime service panels. Use Runs for durable background work and recovery review.</p>
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
  const selectedRunId = getConversationRunIdFromSearch(location.search);
  const scheduledSection = section === 'scheduled' || section === 'automations' || section === 'tasks';
  const selectedPlanId = new URLSearchParams(location.search).get('plan')?.trim() || null;
  const creatingPlan = new URLSearchParams(location.search).get('new') === '1';

  // Presets
  if (section === 'plans') return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <RailHeader label="Reminder presets" sub={selectedPlanId ?? (creatingPlan ? 'new preset' : undefined)} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {suspendRailPanel(
          selectedPlanId || creatingPlan
            ? <AutomationPresetPanel presetId={selectedPlanId} creatingNew={creatingPlan} />
            : <EmptyPrompt text="Select a reminder preset or create a new one to edit reusable reminder presets." />,
          'Loading reminder presets…',
        )}
      </div>
    </div>
  );

  // Conversations
  if (section === 'conversations' && id === DRAFT_CONVERSATION_ID) return (
    <ConversationInspectorShell>
      <DraftConversationContextPanel />
    </ConversationInspectorShell>
  );
  if (section === 'conversations' && id && selectedRunId) return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <RunContextPanel runId={selectedRunId} ownerRoute={`/conversations/${encodeURIComponent(id)}`} closeLabel="Conversation" />
    </div>
  );
  if (section === 'conversations' && id) return (
    <ConversationInspectorShell>
      <LiveSessionContextPanel id={id} />
    </ConversationInspectorShell>
  );
  if (section === 'conversations') return (
    <ConversationInspectorShell>
      <ConversationsWorkspaceContext />
    </ConversationInspectorShell>
  );

  // Automations
  if (scheduledSection && id && selectedRunId) return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <RunContextPanel runId={selectedRunId} ownerRoute={`/automations/${encodeURIComponent(id)}`} closeLabel="Automation" />
    </div>
  );
  if (scheduledSection && id) return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <RailHeader label="Automation" sub={id} />
      {suspendRailPanel(<ScheduledTaskPanel id={id} />, 'Loading automation…')}
    </div>
  );
  if (scheduledSection) return (
    <div className="flex-1 flex flex-col">
      <RailHeader label="Scheduled" />
      <EmptyPrompt text="Select an automation or start a new one." />
    </div>
  );

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
      <p className="text-[12px] text-dim">Select a conversation, page, or run to see context.</p>
    </div>
  );
}
