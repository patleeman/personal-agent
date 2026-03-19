import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAppData, useSseConnection } from '../contexts';
import {
  getRunCategory,
  getRunHeadline,
  getRunImportState,
  getRunLocation,
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

type RunLocationFilterValue = 'all' | 'local' | 'remote';
type RunImportFilterValue = 'all' | 'not_ready' | 'ready' | 'imported' | 'failed';

const RUN_LOCATION_FILTERS: Array<{ value: RunLocationFilterValue; label: string }> = [
  { value: 'all', label: 'All locations' },
  { value: 'local', label: 'Local' },
  { value: 'remote', label: 'Remote' },
];

const RUN_IMPORT_FILTERS: Array<{ value: RunImportFilterValue; label: string }> = [
  { value: 'all', label: 'All imports' },
  { value: 'not_ready', label: 'Not ready' },
  { value: 'ready', label: 'Ready' },
  { value: 'imported', label: 'Imported' },
  { value: 'failed', label: 'Import failed' },
];

function runImportStatusMeta(run: DurableRunRecord): { text: string; cls: string } | null {
  const state = getRunImportState(run);
  if (!state) {
    return null;
  }

  switch (state) {
    case 'ready':
      return { text: 'import ready', cls: 'text-warning' };
    case 'imported':
      return { text: 'imported', cls: 'text-success' };
    case 'failed':
      return { text: 'import failed', cls: 'text-danger' };
    default:
      return { text: 'not imported', cls: 'text-dim' };
  }
}

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
  const importStatus = runImportStatusMeta(run);
  const locationLabel = getRunLocation(run) === 'remote' ? 'remote' : 'local';

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
          <>
            <span className="opacity-40">·</span>
            <span>{locationLabel}</span>
          </>
          {importStatus && (
            <>
              <span className="opacity-40">·</span>
              <span className={importStatus.cls}>{importStatus.text}</span>
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
  const [locationFilter, setLocationFilter] = useState<RunLocationFilterValue>('all');
  const [importFilter, setImportFilter] = useState<RunImportFilterValue>('all');

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

  const locationCounts = useMemo(() => {
    return runRecords.reduce<Record<'local' | 'remote', number>>((counts, run) => {
      counts[getRunLocation(run)] += 1;
      return counts;
    }, { local: 0, remote: 0 });
  }, [runRecords]);

  const importCounts = useMemo(() => {
    return runRecords.reduce<Record<'not_ready' | 'ready' | 'imported' | 'failed', number>>((counts, run) => {
      const importState = getRunImportState(run);
      if (!importState) {
        return counts;
      }

      counts[importState] += 1;
      return counts;
    }, { not_ready: 0, ready: 0, imported: 0, failed: 0 });
  }, [runRecords]);

  const locationOptions = useMemo(() => {
    return RUN_LOCATION_FILTERS.filter((option) => option.value === 'all' || locationCounts[option.value] > 0);
  }, [locationCounts]);

  const importOptions = useMemo(() => {
    return RUN_IMPORT_FILTERS.filter((option) => option.value === 'all' || importCounts[option.value] > 0);
  }, [importCounts]);

  useEffect(() => {
    if (filter !== 'all' && !filterOptions.some((option) => option.value === filter)) {
      setFilter('all');
    }
  }, [filter, filterOptions]);

  useEffect(() => {
    if (locationFilter !== 'all' && !locationOptions.some((option) => option.value === locationFilter)) {
      setLocationFilter('all');
    }
  }, [locationFilter, locationOptions]);

  useEffect(() => {
    if (importFilter !== 'all' && !importOptions.some((option) => option.value === importFilter)) {
      setImportFilter('all');
    }
  }, [importFilter, importOptions]);

  const filteredRuns = useMemo(() => {
    return runRecords.filter((run) => {
      if (filter !== 'all' && getRunCategory(run) !== filter) {
        return false;
      }

      if (locationFilter !== 'all' && getRunLocation(run) !== locationFilter) {
        return false;
      }

      if (importFilter !== 'all' && getRunImportState(run) !== importFilter) {
        return false;
      }

      return true;
    });
  }, [filter, importFilter, locationFilter, runRecords]);

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
                {(filter !== 'all' || locationFilter !== 'all' || importFilter !== 'all') && <span className="ml-2 text-secondary">· {filteredRuns.length} shown</span>}
              </>
            )
          )}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading && <LoadingState label="Loading runs…" />}
        {visibleError && <ErrorState message={`Failed to load runs: ${visibleError}`} />}

        {!isLoading && !visibleError && runRecords.length > 0 && (
          <div className="mb-5 space-y-3">
            <div className="space-y-2">
              <div className="ui-segmented-control" role="group" aria-label="Run category filter">
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
              {locationCounts.remote > 0 && (
                <div className="ui-segmented-control" role="group" aria-label="Run location filter">
                  {locationOptions.map((option) => {
                    const count = option.value === 'all' ? runRecords.length : locationCounts[option.value];
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setLocationFilter(option.value)}
                        className={cx('ui-segmented-button', locationFilter === option.value && 'ui-segmented-button-active')}
                      >
                        {option.label} <span className="tabular-nums text-dim/70">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {locationCounts.remote > 0 && (
                <div className="ui-segmented-control" role="group" aria-label="Run import filter">
                  {importOptions.map((option) => {
                    const count = option.value === 'all'
                      ? runRecords.filter((run) => getRunLocation(run) === 'remote').length
                      : importCounts[option.value];
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setImportFilter(option.value)}
                        className={cx('ui-segmented-button', importFilter === option.value && 'ui-segmented-button-active')}
                      >
                        {option.label} <span className="tabular-nums text-dim/70">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <p className="ui-card-meta">Select a run to inspect it in the right panel. Remote work stays in the same list and uses location/import facets instead of a separate category.</p>
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
            action={<ToolbarButton onClick={() => { setFilter('all'); setLocationFilter('all'); setImportFilter('all'); }}>Show all</ToolbarButton>}
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
