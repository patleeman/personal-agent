import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAppData, useSseConnection } from '../contexts';
import {
  getRunCategory,
  getRunHeadline,
  getRunMoment,
  getRunPrimaryActionLabel,
  getRunPrimaryConnection,
  getRunSortTimestamp,
  summarizeActiveRuns,
  type RunCategory,
  type RunPresentationLookups,
} from '../runPresentation';
import type { DurableRunRecord } from '../types';
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

export function RunsPage() {
  const { id: selectedId } = useParams<{ id?: string }>();
  const { tasks, sessions, runs, setRuns } = useAppData();
  const { status: sseStatus } = useSseConnection();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RunFilterValue>('all');

  const lookups = useMemo<RunPresentationLookups>(() => ({ tasks, sessions }), [tasks, sessions]);

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
    const active = summarizeActiveRuns({ tasks, sessions, runs }).total;
    const needsRecovery = runRecords.filter((run) => run.recoveryAction === 'resume' || run.recoveryAction === 'rerun').length;
    const issues = runRecords.filter((run) => run.problems.length > 0 || run.recoveryAction === 'invalid').length;

    return { active, needsRecovery, issues };
  }, [runRecords, runs, sessions, tasks]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader actions={<ToolbarButton onClick={() => { void refreshRuns(); }}>↻ Refresh</ToolbarButton>}>
        <PageHeading
          title="Agent Runs"
          meta={(
            runs && (
              <>
                {runs.summary.total} {runs.summary.total === 1 ? 'run' : 'runs'}
                {summary.active > 0 && <span className="ml-2 text-accent">· {summary.active} active</span>}
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
          <div className="mb-5 space-y-2">
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
            <p className="ui-card-meta">Select a run to inspect it in the right panel.</p>
          </div>
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
