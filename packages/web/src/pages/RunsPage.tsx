import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAppData } from '../contexts';
import { useInvalidateOnTopics } from '../hooks/useInvalidateOnTopics';
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
import type { DurableRunDetailResult, DurableRunListResult, DurableRunRecord } from '../types';
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
    return <LoadingState className="mb-5" label="Loading execution…" />;
  }

  if (error) {
    return <ErrorState className="mb-5" message={`Failed to load execution: ${error}`} />;
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
            {cancelling ? 'Cancelling…' : 'Cancel execution'}
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
  const { tasks, sessions } = useAppData();
  const [listResult, setListResult] = useState<DurableRunListResult | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [detail, setDetail] = useState<DurableRunDetailResult | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLog, setDetailLog] = useState<{ path: string; log: string } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const [filter, setFilter] = useState<RunFilterValue>('all');

  const lookups = useMemo<RunPresentationLookups>(() => ({ tasks, sessions }), [tasks, sessions]);

  const refreshRuns = useCallback(async () => {
    setLoadingList(true);
    try {
      const next = await api.runs();
      setListResult(next);
      setListError(null);
      return next;
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadDetail = useCallback(async (runId: string) => {
    setLoadingDetail(true);
    try {
      const [nextDetail, nextLog] = await Promise.all([
        api.durableRun(runId),
        api.durableRunLog(runId, 120),
      ]);
      setDetail(nextDetail);
      setDetailLog(nextLog);
      setDetailError(null);
    } catch (error) {
      setDetail(null);
      setDetailLog(null);
      setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const handleCancelRun = useCallback(async (runId: string) => {
    setCancellingRunId(runId);
    try {
      await api.cancelDurableRun(runId);
      await refreshRuns();
      await loadDetail(runId);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      setCancellingRunId(null);
    }
  }, [loadDetail, refreshRuns]);

  const refetchRuns = useCallback(async () => {
    await refreshRuns();
    if (selectedId) {
      await loadDetail(selectedId);
    }
  }, [loadDetail, refreshRuns, selectedId]);

  useInvalidateOnTopics(['runs'], refetchRuns);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailLog(null);
      setDetailError(null);
      setLoadingDetail(false);
      return;
    }

    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  const runs = useMemo(() => {
    const next = [...(listResult?.runs ?? [])];
    next.sort((a, b) => {
      const byTime = getRunSortTimestamp(b).localeCompare(getRunSortTimestamp(a));
      if (byTime !== 0) {
        return byTime;
      }

      return b.runId.localeCompare(a.runId);
    });
    return next;
  }, [listResult?.runs]);

  const filterCounts = useMemo(() => {
    return runs.reduce<Record<RunCategory, number>>((counts, run) => {
      counts[getRunCategory(run)] += 1;
      return counts;
    }, {
      scheduled: 0,
      conversation: 0,
      deferred: 0,
      background: 0,
      other: 0,
    });
  }, [runs]);

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
      return runs;
    }

    return runs.filter((run) => getRunCategory(run) === filter);
  }, [filter, runs]);

  const summary = useMemo(() => {
    const running = runs.filter((run) => {
      const status = run.status?.status;
      return status === 'running' || status === 'recovering';
    }).length;
    const needsRecovery = runs.filter((run) => run.recoveryAction === 'resume' || run.recoveryAction === 'rerun').length;
    const issues = runs.filter((run) => run.problems.length > 0 || run.recoveryAction === 'invalid').length;

    return { running, needsRecovery, issues };
  }, [runs]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader actions={<ToolbarButton onClick={() => { void refreshRuns(); if (selectedId) void loadDetail(selectedId); }}>↻ Refresh</ToolbarButton>}>
        <PageHeading
          title="Executions"
          meta={(
            listResult && (
              <>
                {listResult.summary.total} {listResult.summary.total === 1 ? 'execution' : 'executions'}
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
        {loadingList && <LoadingState label="Loading executions…" />}
        {listError && <ErrorState message={`Failed to load executions: ${listError}`} />}

        {!loadingList && !listError && runs.length > 0 && (
          <div className="mb-5">
            <div className="ui-segmented-control" role="group" aria-label="Execution filter">
              {filterOptions.map((option) => {
                const count = option.value === 'all' ? runs.length : filterCounts[option.value];
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

        {!loadingList && !listError && selectedId && (
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

        {!loadingList && !listError && runs.length === 0 && (
          <EmptyState
            title="No executions yet."
            body={(
              <>
                Executions appear here after background work is started through the daemon. You can also start a scheduled task from the <Link to="/scheduled" className="text-accent hover:underline">Scheduled</Link> page.
              </>
            )}
          />
        )}

        {!loadingList && !listError && runs.length > 0 && filteredRuns.length === 0 && (
          <EmptyState
            title="No executions match this filter."
            body="Try another execution type or switch back to all."
            action={<ToolbarButton onClick={() => setFilter('all')}>Show all</ToolbarButton>}
          />
        )}

        {!loadingList && !listError && filteredRuns.length > 0 && (
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
