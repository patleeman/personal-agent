import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  DRAFT_CONVERSATION_ID,
} from '../draftConversation';
import { useReloadState } from '../reloadState';
import {
  getRunConnections,
  getRunHeadline,
  getRunTimeline,
  type RunPresentationLookups,
} from '../runPresentation';
import {
  pickAttachProjectId,
  pickFocusedProjectId,
} from '../contextRailProject';
import { useApi } from '../hooks';
import { displayBlockToMessageBlock } from '../messageBlocks';
import { buildCapabilityCards, buildIdentitySummary, buildKnowledgeSections, buildMemoryPageSummary } from '../memoryOverview';
import { getScheduledTaskBody, isScheduledTaskDetail } from '../scheduledTaskDetail';
import type { ActivityEntry, DurableRunDetailResult, DurableRunRecord, LiveSessionContext, ProjectDetail, ProjectRecord, ScheduledTaskDetail } from '../types';
import { formatDate, kindMeta, timeAgo } from '../utils';
import { useAppData, useAppEvents } from '../contexts';
import { emitProjectsChanged, PROJECTS_CHANGED_EVENT } from '../projectEvents';
import { CONVERSATION_PROJECTS_CHANGED_EVENT, emitConversationProjectsChanged } from '../conversationProjectEvents';
import { closeConversationTab, ensureConversationTabOpen } from '../sessionTabs';
import { ConversationArtifactPanel } from './ConversationArtifactPanel';
import { ProjectDetailPanel } from './ProjectDetailPanel';
import { ProjectOverviewPanel } from './ProjectOverviewPanel';
import { ErrorState, IconButton, LoadingState, Pill, SurfacePanel } from './ui';

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

function ConversationRunContextPanel({ conversationId, runId }: { conversationId: string; runId: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { tasks, sessions } = useAppData();
  const [detail, setDetail] = useState<DurableRunDetailResult | null>(null);
  const [log, setLog] = useState<{ path: string; log: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const lookups = useMemo<RunPresentationLookups>(() => ({ tasks, sessions }), [tasks, sessions]);

  const closeRun = useCallback(() => {
    navigate({
      pathname: location.pathname,
      search: setConversationRunIdInSearch(location.search, null),
    });
  }, [location.pathname, location.search, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextDetail, nextLog] = await Promise.all([
        api.durableRun(runId),
        api.durableRunLog(runId, 120),
      ]);
      setDetail(nextDetail);
      setLog(nextLog);
      setError(null);
    } catch (nextError) {
      setDetail(null);
      setLog(null);
      setError(nextError instanceof Error ? nextError.message : 'Could not load execution.');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isRefreshingRun(detail?.run ?? null)) {
      return;
    }

    const handle = window.setInterval(() => {
      void load();
    }, 2000);

    return () => {
      window.clearInterval(handle);
    };
  }, [detail?.run, load]);

  async function handleCancel() {
    if (!detail || cancelling || !canCancelRun(detail.run)) {
      return;
    }

    setCancelling(true);
    try {
      await api.cancelDurableRun(detail.run.runId);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not cancel execution.');
    } finally {
      setCancelling(false);
    }
  }

  if (loading && !detail) {
    return <LoadingState label="Loading execution…" className="px-4 py-4" />;
  }

  if (error && !detail) {
    return <ErrorState message={error} className="px-4 py-4" />;
  }

  if (!detail) {
    return <div className="px-4 py-4 text-[12px] text-dim">Execution not found.</div>;
  }

  const run = detail.run;
  const status = runStatusText(run);
  const headline = getRunHeadline(run, lookups);
  const connections = getRunConnections(run, lookups);
  const timeline = getRunTimeline(run);
  const showRecovery = run.recoveryAction !== 'none';
  const cancelable = canCancelRun(run);
  const closeSearch = setConversationRunIdInSearch(location.search, null);

  return (
    <div className="space-y-4 px-4 py-4 overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={closeRun} className="ui-toolbar-button">
          ← Session
        </button>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => { void load(); }} className="ui-toolbar-button">
            ↻ Refresh
          </button>
          <Link to={`/runs/${encodeURIComponent(runId)}`} className="ui-toolbar-button text-accent" title="Open on the executions page">
            Full page
          </Link>
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
          <p className="text-[12px] text-secondary">This background execution can still be cancelled.</p>
          <button type="button" onClick={() => { void handleCancel(); }} disabled={cancelling} className="ui-toolbar-button text-danger">
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        </div>
      )}

      {connections.length > 0 && (
        <div className="border-t border-border-subtle pt-3">
          <p className="ui-section-label mb-2">Connected to</p>
          <div className="space-y-2">
            {connections.map((connection) => (
              <div key={connection.key} className="space-y-0.5">
                <p className="text-[11px] uppercase tracking-[0.12em] text-dim">{connection.label}</p>
                {connection.to ? (
                  <Link to={connection.to + (connection.label.startsWith('Conversation') ? closeSearch : '')} className="text-[13px] text-accent hover:underline break-all">
                    {connection.value}
                  </Link>
                ) : (
                  <p className="text-[13px] text-primary break-all">{connection.value}</p>
                )}
                {connection.detail && <p className="text-[12px] text-secondary break-words">{connection.detail}</p>}
              </div>
            ))}
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
          <p className="ui-section-label">Execution state</p>
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
      {conversationId && <p className="text-[10px] text-dim">Opened from conversation {conversationId}.</p>}
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
  return (
    <ProjectOverviewPanel
      project={project}
      onRemove={onRemove}
      removeDisabled={removeDisabled}
    />
  );
}

function DraftConversationContextPanel() {
  const [draftCwd, setDraftCwd, clearDraftCwd] = useReloadState<string>({
    storageKey: buildDraftConversationCwdStorageKey(),
    initialValue: '',
    shouldPersist: (value) => value.trim().length > 0,
  });
  const [changingCwd, setChangingCwd] = useState(false);
  const [requestedCwd, setRequestedCwd] = useState(draftCwd);
  const [pickCwdBusy, setPickCwdBusy] = useState(false);
  const [openCwdBusy, setOpenCwdBusy] = useState(false);
  const [openCwdError, setOpenCwdError] = useState<string | null>(null);
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
    setOpenCwdError(null);
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

  async function openCwdInVscode() {
    if (!hasExplicitCwd || openCwdBusy) {
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
    setOpenCwdError(null);
    setChangeCwdError(null);
    setChangingCwd(false);
  }

  return (
    <div className="space-y-5 px-4 py-4">
      <Section title="Working Directory">
        <SurfacePanel muted className="px-3 py-3 space-y-2.5">
          <div className="flex items-start gap-2">
            {hasExplicitCwd ? (
              <p className="ui-card-body break-all min-w-0 flex-1" title={draftCwd}>{draftCwd}</p>
            ) : (
              <p className="text-[12px] text-dim min-w-0 flex-1">No explicit working directory set yet.</p>
            )}
            <div className="flex items-center gap-1 shrink-0 mt-0.5">
              {hasExplicitCwd && !changingCwd && (
                <button
                  type="button"
                  onClick={clearExplicitCwd}
                  className="ui-toolbar-button"
                  title="Clear the draft working directory"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => { void pickDraftCwd(); }}
                disabled={pickCwdBusy}
                className="ui-toolbar-button text-accent whitespace-nowrap"
                title="Choose the initial working directory for this draft conversation"
              >
                {pickCwdBusy ? 'Choosing…' : 'Choose folder…'}
              </button>
              <button
                type="button"
                onClick={startChangingCwd}
                disabled={pickCwdBusy}
                className="ui-toolbar-button whitespace-nowrap"
                title="Enter the working directory manually"
              >
                Manual
              </button>
              <IconButton
                compact
                onClick={() => { void openCwdInVscode(); }}
                disabled={!hasExplicitCwd || openCwdBusy || pickCwdBusy}
                title={openCwdBusy ? 'Opening VS Code…' : 'Open the draft working directory in VS Code'}
                aria-label="Open the draft working directory in VS Code"
                className="shrink-0"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.25 4.5h5.25v5.25" />
                  <path d="M19.5 4.5 10.5 13.5" />
                  <path d="M19.5 13.5v4.125A1.875 1.875 0 0 1 17.625 19.5H6.375A1.875 1.875 0 0 1 4.5 17.625V6.375A1.875 1.875 0 0 1 6.375 4.5H10.5" />
                </svg>
              </IconButton>
            </div>
          </div>
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
          <p className="text-[11px] text-dim">
            {hasExplicitCwd
              ? 'This path will be used when the draft becomes a live conversation.'
              : 'Use the folder picker as the default flow. Manual entry still works, and leaving the field blank lets a single referenced project repo root or the default process cwd choose for you.'}
          </p>
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

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    Promise.all([api.liveSessionContext(id), api.projects()])
      .then(([context, projects]) => {
        if (cancelled) return;
        setData(context);
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

  useEffect(() => load(), [load]);
  useEffect(() => {
    void loadRuns();
  }, [id, loadRuns, versions.runs]);

  useEffect(() => {
    runMentionsLastFetchedAtRef.current = 0;
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

    api.sessionDetail(id)
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
  const availableProjects = allProjects.filter((project) => !relatedProjectIds.includes(project.id));
  const availableProjectIds = availableProjects.map((project) => project.id);
  const selectedAttachProject = availableProjects.find((project) => project.id === attachProjectId) ?? null;
  const selectedRunId = getConversationRunIdFromSearch(location.search);
  const currentConversationRunId = createConversationLiveRunId(id);
  const visibleRunMentions = useMemo(() => {
    const next: Array<{
      runId: string;
      label: string;
      meta: string;
      selected: boolean;
      kind: 'conversation' | 'mentioned';
    }> = [];
    const seen = new Set<string>();

    const push = (runId: string, label: string, meta: string, kind: 'conversation' | 'mentioned') => {
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

    push(currentConversationRunId, 'Conversation execution', 'Tracks this conversation state and recovery metadata.', 'conversation');

    for (const mention of detectedRunMentions) {
      const mentionMeta = mention.mentionCount > 1
        ? `Mentioned ${mention.mentionCount} times · last seen ${timeAgo(mention.lastSeenAt)}`
        : `Mentioned ${timeAgo(mention.lastSeenAt)}`;
      push(mention.runId, mention.runId, mentionMeta, 'mentioned');
    }

    return next;
  }, [currentConversationRunId, detectedRunMentions, selectedRunId]);

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

  const shouldPollRuns = visibleRunCards.some(({ record }) => !record || isRefreshingRun(record));

  useEffect(() => {
    if (!shouldPollRuns) {
      return;
    }

    const handle = window.setInterval(() => {
      void loadRuns();
    }, 3000);

    return () => {
      window.clearInterval(handle);
    };
  }, [loadRuns, shouldPollRuns]);

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

  async function pickAndSubmitCwd() {
    if (!data || pickCwdBusy || changeCwdBusy) {
      return;
    }

    setPickCwdBusy(true);
    setOpenCwdError(null);
    setChangeCwdError(null);
    try {
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
    if (!data || openCwdBusy) return;

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
    if (!data || changeCwdBusy || pickCwdBusy) {
      return;
    }

    setRequestedCwd(data.cwd);
    setOpenCwdError(null);
    setChangeCwdError(null);
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

  const dirParts = data.cwd.replace(/^\//, '').split('/');
  const cwdShort = dirParts.length > 3 ? '…/' + dirParts.slice(-3).join('/') : data.cwd;
  const gitChangeLabel = data.git
    ? `${data.git.changeCount} ${data.git.changeCount === 1 ? 'change' : 'changes'}`
    : null;

  return (
    <div className="space-y-5 px-4 py-4">
      <Section title="Working Directory">
        <SurfacePanel muted className="px-3 py-3 space-y-2.5">
          <div className="flex items-start gap-2">
            <p className="ui-card-body break-all min-w-0 flex-1" title={data.cwd}>{cwdShort}</p>
            <div className="flex items-center gap-1 shrink-0 mt-0.5">
              <button
                type="button"
                onClick={() => { void pickAndSubmitCwd(); }}
                disabled={pickCwdBusy || changeCwdBusy}
                className="ui-toolbar-button text-accent whitespace-nowrap"
                title="Choose a new working directory for this conversation"
              >
                {pickCwdBusy ? 'Choosing…' : 'Choose folder…'}
              </button>
              <button
                type="button"
                onClick={startChangingCwd}
                disabled={changingCwd || changeCwdBusy || pickCwdBusy}
                className="ui-toolbar-button whitespace-nowrap"
                title="Enter the working directory manually"
              >
                Manual
              </button>
              <IconButton
                compact
                onClick={() => { void openCwdInVscode(); }}
                disabled={openCwdBusy || pickCwdBusy || changeCwdBusy}
                title={openCwdBusy ? 'Opening VS Code…' : 'Open current working directory in VS Code'}
                aria-label="Open current working directory in VS Code"
                className="shrink-0"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.25 4.5h5.25v5.25" />
                  <path d="M19.5 4.5 10.5 13.5" />
                  <path d="M19.5 13.5v4.125A1.875 1.875 0 0 1 17.625 19.5H6.375A1.875 1.875 0 0 1 4.5 17.625V6.375A1.875 1.875 0 0 1 6.375 4.5H10.5" />
                </svg>
              </IconButton>
            </div>
          </div>
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
                <p className="text-[11px] text-dim">Use the folder picker above for the default flow, or enter an absolute, ~, or relative path here.</p>
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

function cronHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour] = parts;
  const m = hour.match(/^\*\/(\d+)$/);
  if (m && min !== '*') return `every ${m[1]}h at :${min.padStart(2,'0')}`;
  if (hour !== '*' && min !== '*' && !hour.includes('*')) return `daily at ${hour.padStart(2,'0')}:${min.padStart(2,'0')}`;
  return cron;
}

function TaskContext({ id }: { id: string }) {
  const [task, setTask] = useState<ScheduledTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    setTask(null);

    api.taskDetail(id)
      .then((detail) => {
        if (cancelled) {
          return;
        }

        if (!isScheduledTaskDetail(detail)) {
          throw new Error('Task details are unavailable.');
        }

        setTask(detail);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : 'Could not load task details.');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <LoadingState label="Loading task…" className="px-4 py-4" />;
  if (error) return <ErrorState message={error} className="px-4 py-4" />;
  if (!task) return <div className="px-4 py-4 text-[12px] text-dim">Task not found.</div>;

  const body = getScheduledTaskBody(task.fileContent);
  const lines = body.split('\n');
  const statusCls = task.running ? 'text-accent' : task.lastStatus === 'success' ? 'text-success' : task.lastStatus === 'failure' ? 'text-danger' : 'text-dim';
  const statusText = task.running ? 'running' : task.lastStatus ?? 'never run';
  const scheduleText = task.cron ? cronHuman(task.cron) : null;

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="space-y-1">
        <p className="ui-card-title font-mono">{id}</p>
        <p className="ui-card-meta">
          <span className={statusCls}>{statusText}</span>
          {task.lastRunAt && <><span className="opacity-40 mx-1.5">·</span>last run {timeAgo(task.lastRunAt)}</>}
          {!task.enabled && <><span className="opacity-40 mx-1.5">·</span>disabled</>}
        </p>
      </div>

      <div className="border-t border-border-subtle pt-3">
        <div className="ui-detail-list">
          {scheduleText && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">schedule</span>
              <div className="min-w-0">
                <p className="ui-detail-value">{scheduleText}</p>
                <p className="ui-card-meta mt-0.5">{task.cron}</p>
              </div>
            </div>
          )}
          {task.model && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">model</span>
              <p className="ui-detail-value">{task.model.split('/').pop()}</p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border-subtle pt-3">
        <p className="ui-section-label mb-2">Prompt</p>
        <div className="text-[12px] leading-relaxed text-secondary space-y-1 whitespace-pre-wrap break-words">
          {lines.map((line, i) => {
            if (line.startsWith('## ') || line.startsWith('# ')) return <p key={i} className="text-primary font-semibold text-[13px] mt-2">{line.replace(/^#+\s/, '')}</p>;
            if (line.startsWith('- ') || line.match(/^\d+\. /)) return <p key={i} className="pl-2">{line}</p>;
            if (line.trim() === '') return <div key={i} className="h-1.5" />;
            return <p key={i}>{line}</p>;
          })}
        </div>
      </div>
      <TaskLogSection taskId={id} />
    </div>
  );
}

function TaskLogSection({ taskId }: { taskId: string }) {
  const [log, setLog]     = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [open, setOpen]   = useState(false);
  const [loading, setLoading] = useState(false);

  function loadLog() {
    if (log !== null) { setOpen(o => !o); return; }
    setLoading(true);
    fetch(`/api/tasks/${taskId}/log`)
      .then(r => r.ok ? r.json() as Promise<{ log: string; path: string }> : Promise.reject())
      .then(d => { setLog(d.log); setLogPath(d.path); setOpen(true); setLoading(false); })
      .catch(() => { setLog('No log available.'); setOpen(true); setLoading(false); });
  }

  return (
    <div className="border-t border-border-subtle pt-3">
      <button onClick={loadLog} className="text-[11px] text-accent hover:underline flex items-center gap-1.5">
        {loading ? <span className="animate-spin text-[10px]">⟳</span> : (open ? '▾' : '▸')}
        Last run log
      </button>
      {open && log !== null && (
        <div className="mt-2">
          {logPath && <p className="text-[9px] font-mono text-dim/50 truncate mb-1">{logPath.split('/').slice(-1)[0]}</p>}
          <pre className="text-[10px] font-mono text-secondary whitespace-pre-wrap break-all bg-elevated rounded-lg p-2.5 max-h-64 overflow-y-auto leading-relaxed">
            {log || '(empty)'}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Inbox item detail ─────────────────────────────────────────────────────────

function InboxItemContext({ id }: { id: string }) {
  const [entry, setEntry] = useState<ActivityEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/activity/${encodeURIComponent(id)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: ActivityEntry & { read?: boolean }) => {
        setEntry(d);
        setLoading(false);
        // Mark as read when detail opens
        if (!d.read) {
          void fetch(`/api/activity/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ read: true }) });
        }
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse">Loading…</div>;
  if (!entry)  return <div className="px-4 py-4 text-[12px] text-dim">Not found.</div>;

  const meta = kindMeta(entry.kind);

  return (
    <div className="px-4 py-4 space-y-4 overflow-y-auto">
      <div className="space-y-1">
        <p className="ui-card-title">{entry.summary}</p>
        <p className="ui-card-meta">
          <span className={meta.color}>{meta.label}</span>
          <span className="opacity-40 mx-1.5">·</span>
          {formatDate(entry.createdAt)}
        </p>
      </div>

      {entry.details && (
        <div className="border-t border-border-subtle pt-3">
          <p className="ui-section-label mb-1.5">Details</p>
          <div className="text-[12px] text-secondary whitespace-pre-wrap break-words leading-relaxed">
            {entry.details}
          </div>
        </div>
      )}

      {entry.relatedProjectIds && entry.relatedProjectIds.length > 0 && (
        <div className="border-t border-border-subtle pt-3">
          <p className="ui-section-label mb-2">Related</p>
          <div className="space-y-1.5">
            {entry.relatedProjectIds.map((wsId) => (
              <Link key={wsId} to={`/projects/${wsId}`} className="ui-card-meta font-mono text-accent hover:text-accent/80">
                {wsId}
              </Link>
            ))}
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

function ProjectDetailContext({ id }: { id: string }) {
  const navigate = useNavigate();
  const fetcher = useCallback(() => api.projectById(id), [id]);
  const { data: project, loading, error, refetch } = useApi(fetcher, id);

  useEffect(() => {
    function handleProjectChanged() {
      refetch();
    }

    window.addEventListener(PROJECTS_CHANGED_EVENT, handleProjectChanged);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, handleProjectChanged);
  }, [refetch]);

  if (loading) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse">Loading…</div>;
  if (error) return <div className="px-4 py-4 text-[12px] text-dim">Project not found.</div>;
  if (!project) return <div className="px-4 py-4 text-[12px] text-dim">Project not found.</div>;

  return (
    <ProjectDetailPanel
      project={project}
      onChanged={() => {
        void refetch();
        emitProjectsChanged();
      }}
      onDeleted={() => {
        navigate('/projects');
        emitProjectsChanged();
      }}
    />
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

  // Conversations
  if (section === 'conversations' && id && selectedArtifactId) return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <RailHeader label="Artifact" sub={selectedArtifactId} />
      <ConversationArtifactPanel conversationId={id} artifactId={selectedArtifactId} />
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
      <RailHeader label="Execution" sub={selectedRunId} />
      <ConversationRunContextPanel conversationId={id} runId={selectedRunId} />
    </div>
  );
  if (section === 'conversations' && id) return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <RailHeader label="Session" />
      <LiveSessionContextPanel id={id} />
    </div>
  );

  // Scheduled tasks
  if (scheduledSection && id) return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <RailHeader label="Scheduled task" sub={id} />
      <TaskContext id={id} />
    </div>
  );
  if (scheduledSection) return (
    <div className="flex-1 flex flex-col">
      <RailHeader label="Scheduled" />
      <EmptyPrompt text="Select a scheduled task to see its prompt and schedule." />
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
