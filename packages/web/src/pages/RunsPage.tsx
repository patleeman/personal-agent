import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAppData, useSseConnection } from '../contexts';
import { useDurableRunStream } from '../hooks/useDurableRunStream';
import {
  getRunCategory,
  getRunConnections,
  getRunHeadline,
  getRunMoment,
  getRunPrimaryActionLabel,
  getRunPrimaryConnection,
  getRunSortTimestamp,
  getRunTimeline,
  type RunCategory,
  type RunPresentationLookups,
} from '../runPresentation';
import type { DurableRunDetailResult, DurableRunRecord } from '../types';
import { formatDate } from '../utils';
import { EmptyState, ErrorState, LoadingState, PageHeader, PageHeading, ToolbarButton, cx } from '../components/ui';

function runStatusDot(run: DurableRunRecord): string {
  const status = run.status?.status;

  if (status === 'running' || status === 'recovering') return 'bg-accent animate-pulse';
  if (status === 'completed') return 'bg-success';
  if (status === 'cancelled') return 'bg-border-default';
  if (run.recoveryAction === 'resume' || run.recoveryAction === 'rerun') return 'bg-warning';
  if (run.problems.length > 0 || status === 'failed' || status === 'interrupted') return 'bg-danger';
  return 'bg-border-default/50';
}

function runStatusText(run: DurableRunRecord): { text: string; cls: string } {
  const status = run.status?.status;

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

function formatMomentLabel(run: DurableRunRecord): string | null {
  const moment = getRunMoment(run);
  if (!moment.at) {
    return null;
  }

  return `${moment.label} ${formatDate(moment.at)}`;
}

type RunFilterValue = 'all' | RunCategory;

const RUN_FILTERS: Array<{ value: RunFilterValue; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'conversation', label: 'Conversations' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'background', label: 'Background' },
  { value: 'other', label: 'Other' },
];

function RunRow({
  run,
  isSelected,
  lookups,
}: {
  run: DurableRunRecord;
  isSelected: boolean;
  lookups: RunPresentationLookups;
}) {
  const status = runStatusText(run);
  const headline = getRunHeadline(run, lookups);
  const momentLabel = formatMomentLabel(run);
  const showRecovery = run.recoveryAction !== 'none';
  const primaryConnection = getRunPrimaryConnection(run, lookups);
  const primaryActionLabel = getRunPrimaryActionLabel(primaryConnection);

  return (
    <div className={cx('group', 'ui-list-row', isSelected ? 'ui-list-row-selected' : 'ui-list-row-hover')}>
      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${runStatusDot(run)}`} />
      <Link to={`/runs/${encodeURIComponent(run.runId)}`} className="flex-1 min-w-0">
        <p className="ui-row-title">{headline.title}</p>
        <p className="ui-row-summary">{headline.summary}</p>
        <p className="ui-row-meta flex items-center gap-1.5 flex-wrap">
          <span className={status.cls}>{status.text}</span>
          {momentLabel && (
            <>
              <span className="opacity-40">·</span>
              <span>{momentLabel}</span>
            </>
          )}
          {showRecovery && (
            <>
              <span className="opacity-40">·</span>
              <span>{formatRecoveryAction(run.recoveryAction)}</span>
            </>
          )}
          {run.problems.length > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span className="text-danger">{run.problems.length} issue{run.problems.length === 1 ? '' : 's'}</span>
            </>
          )}
          <>
            <span className="opacity-40">·</span>
            <span className="truncate">run {run.runId}</span>
          </>
        </p>
      </Link>
      {primaryConnection?.to && primaryActionLabel && (
        <Link
          to={primaryConnection.to}
          className="mt-0.5 shrink-0 text-[11px] font-mono text-dim hover:text-accent transition-colors"
          title={primaryConnection.value}
        >
          {primaryActionLabel} ↗
        </Link>
      )}
    </div>
  );
}

function RunDetail({
  detail,
  log,
  loading,
  error,
  lookups,
  onCancel,
  cancelling,
}: {
  detail: DurableRunDetailResult | null;
  log: { path: string; log: string } | null;
  loading: boolean;
  error: string | null;
  lookups: RunPresentationLookups;
  onCancel: (runId: string) => void;
  cancelling: boolean;
}) {
  if (loading) {
    return <LoadingState className="mb-5" label="Loading run…" />;
  }

  if (error) {
    return <ErrorState className="mb-5" message={`Failed to load run: ${error}`} />;
  }

  if (!detail) {
    return null;
  }

  const run = detail.run;
  const status = runStatusText(run);
  const headline = getRunHeadline(run, lookups);
  const connections = getRunConnections(run, lookups);
  const timeline = getRunTimeline(run);
  const showRecovery = run.recoveryAction !== 'none';
  const canCancel = run.manifest?.kind === 'background-run' && (
    run.status?.status === 'queued'
    || run.status?.status === 'waiting'
    || run.status?.status === 'running'
    || run.status?.status === 'recovering'
  );

  return (
    <div className="mb-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <h2 className="text-[16px] font-medium text-primary break-words">{headline.title}</h2>
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
        {canCancel && (
          <ToolbarButton onClick={() => onCancel(run.runId)} disabled={cancelling}>
            {cancelling ? 'Cancelling…' : 'Cancel run'}
          </ToolbarButton>
        )}
      </div>

      {connections.length > 0 && (
        <div className="border-t border-border-subtle pt-4 space-y-3">
          <p className="ui-section-label">Connected to</p>
          <div className="space-y-3">
            {connections.map((connection) => {
              const value = connection.to
                ? <Link to={connection.to} className="text-[13px] text-accent hover:underline break-all">{connection.value}</Link>
                : <p className="text-[13px] text-primary break-all">{connection.value}</p>;

              return (
                <div key={connection.key} className="space-y-0.5">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-dim">{connection.label}</p>
                  {value}
                  {connection.detail && <p className="text-[12px] text-secondary break-words">{connection.detail}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {timeline.length > 0 && (
        <div className="border-t border-border-subtle pt-4 space-y-3">
          <p className="ui-section-label">Timeline</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {timeline.map((item) => (
              <div key={item.label} className="space-y-1">
                <p className="text-[11px] uppercase tracking-[0.12em] text-dim">{item.label}</p>
                <p className="text-[13px] text-primary">{formatDate(item.at)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-border-subtle pt-4 grid gap-3 sm:grid-cols-2">
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
        <div className="border-t border-border-subtle pt-4 space-y-3">
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

      <div className="border-t border-border-subtle pt-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="ui-section-label">Output log</p>
          {log?.path && <p className="text-[10px] font-mono text-dim truncate">{log.path.split('/').slice(-2).join('/')}</p>}
        </div>
        <pre className="text-[11px] font-mono text-secondary whitespace-pre-wrap break-all bg-elevated rounded-lg p-3 max-h-80 overflow-y-auto leading-relaxed">
          {log?.log || '(empty)'}
        </pre>
      </div>
    </div>
  );
}

export function RunsPage() {
  const { id: selectedId } = useParams<{ id?: string }>();
  const { tasks, sessions, runs, setRuns } = useAppData();
  const { status: sseStatus } = useSseConnection();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const [filter, setFilter] = useState<RunFilterValue>('all');

  const lookups = useMemo<RunPresentationLookups>(() => ({ tasks, sessions }), [tasks, sessions]);
  const {
    detail,
    log: detailLog,
    loading: loadingDetail,
    error: detailError,
    reconnect: reconnectSelectedRun,
  } = useDurableRunStream(selectedId ?? null, 120);

  const refreshRuns = useCallback(async () => {
    try {
      const next = await api.runs();
      setRuns(next);
      setRefreshError(null);
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRefreshError(message);
      return null;
    }
  }, [setRuns]);

  const handleCancelRun = useCallback(async (runId: string) => {
    setCancellingRunId(runId);
    try {
      await api.cancelDurableRun(runId);
      await refreshRuns();
      reconnectSelectedRun();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRefreshError(message);
    } finally {
      setCancellingRunId(null);
    }
  }, [reconnectSelectedRun, refreshRuns]);

  const runRecords = useMemo(() => {
    const next = [...(runs?.runs ?? [])];
    next.sort((a, b) => {
      const byTime = getRunSortTimestamp(b).localeCompare(getRunSortTimestamp(a));
      if (byTime !== 0) {
        return byTime;
      }

      return b.runId.localeCompare(a.runId);
    });
    return next;
  }, [runs]);

  const isLoading = runs === null && sseStatus !== 'offline';
  const visibleError = runs === null && sseStatus === 'offline'
    ? refreshError ?? 'Live updates are offline. Use refresh to load the latest runs.'
    : refreshError;

  const filterCounts = useMemo(() => {
    return runRecords.reduce<Record<RunCategory, number>>((counts, run) => {
      counts[getRunCategory(run)] += 1;
      return counts;
    }, {
      scheduled: 0,
      conversation: 0,
      deferred: 0,
      background: 0,
      other: 0,
    });
  }, [runRecords]);

  const filterOptions = useMemo(() => {
    return RUN_FILTERS.filter((option) => option.value === 'all' || filterCounts[option.value] > 0);
  }, [filterCounts]);

  useEffect(() => {
    if (filter !== 'all' && !filterOptions.some((option) => option.value === filter)) {
      setFilter('all');
    }
  }, [filter, filterOptions]);

  const filteredRuns = useMemo(() => {
    if (filter === 'all') {
      return runRecords;
    }

    return runRecords.filter((run) => getRunCategory(run) === filter);
  }, [filter, runRecords]);

  const summary = useMemo(() => {
    const running = runRecords.filter((run) => {
      const status = run.status?.status;
      return status === 'running' || status === 'recovering';
    }).length;
    const needsRecovery = runRecords.filter((run) => run.recoveryAction === 'resume' || run.recoveryAction === 'rerun').length;
    const issues = runRecords.filter((run) => run.problems.length > 0 || run.recoveryAction === 'invalid').length;

    return { running, needsRecovery, issues };
  }, [runRecords]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader actions={<ToolbarButton onClick={() => { void refreshRuns(); reconnectSelectedRun(); }}>↻ Refresh</ToolbarButton>}>
        <PageHeading
          title="Agent Runs"
          meta={(
            runs && (
              <>
                {runs.summary.total} {runs.summary.total === 1 ? 'run' : 'runs'}
                {summary.running > 0 && <span className="ml-2 text-accent">· {summary.running} active</span>}
                {summary.needsRecovery > 0 && <span className="ml-2 text-warning">· {summary.needsRecovery} recoverable</span>}
                {summary.issues > 0 && <span className="ml-2 text-danger">· {summary.issues} with issues</span>}
                {filter !== 'all' && <span className="ml-2 text-secondary">· {filteredRuns.length} shown</span>}
              </>
            )
          )}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading && <LoadingState label="Loading runs…" />}
        {visibleError && <ErrorState message={`Failed to load runs: ${visibleError}`} />}

        {!isLoading && !visibleError && runRecords.length > 0 && (
          <div className="mb-5">
            <div className="ui-segmented-control" role="group" aria-label="Run filter">
              {filterOptions.map((option) => {
                const count = option.value === 'all' ? runRecords.length : filterCounts[option.value];
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFilter(option.value)}
                    className={cx('ui-segmented-button', filter === option.value && 'ui-segmented-button-active')}
                  >
                    {option.label} <span className="tabular-nums text-dim/70">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!isLoading && !visibleError && selectedId && (
          <RunDetail
            detail={detail}
            log={detailLog}
            loading={loadingDetail}
            error={detailError}
            lookups={lookups}
            onCancel={handleCancelRun}
            cancelling={cancellingRunId === selectedId}
          />
        )}

        {!isLoading && !visibleError && runRecords.length === 0 && (
          <EmptyState
            title="No runs yet."
            body={(
              <>
                Agent runs appear here after background work starts through the daemon. You can also start a scheduled task from the <Link to="/scheduled" className="text-accent hover:underline">Scheduled</Link> page.
              </>
            )}
          />
        )}

        {!isLoading && !visibleError && runRecords.length > 0 && filteredRuns.length === 0 && (
          <EmptyState
            title="No runs match this filter."
            body="Try another run type or switch back to all."
            action={<ToolbarButton onClick={() => setFilter('all')}>Show all</ToolbarButton>}
          />
        )}

        {!isLoading && !visibleError && filteredRuns.length > 0 && (
          <div className="space-y-px">
            {filteredRuns.map((run) => (
              <RunRow key={run.runId} run={run} isSelected={run.runId === selectedId} lookups={lookups} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
