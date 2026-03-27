import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useAppData, useSseConnection } from '../contexts';
import {
  getRunHeadline,
  getRunImportState,
  getRunMoment,
  getRunPrimaryConnection,
  getRunSortTimestamp,
  isRunInProgress,
  runNeedsAttention,
  type RunPresentationLookups,
} from '../runPresentation';
import type { DurableRunRecord } from '../types';
import { timeAgo } from '../utils';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, Pill, ToolbarButton, type PillTone } from '../components/ui';

function toneDotClass(tone: PillTone): string {
  switch (tone) {
    case 'success':
      return 'bg-success';
    case 'warning':
      return 'bg-warning';
    case 'danger':
      return 'bg-danger';
    default:
      return 'bg-border-default';
  }
}

function runStatusTone(run: DurableRunRecord): PillTone {
  const status = run.status?.status;

  if (run.problems.length > 0 || run.recoveryAction === 'invalid' || status === 'failed' || status === 'interrupted' || getRunImportState(run) === 'failed') {
    return 'danger';
  }
  if (run.recoveryAction === 'resume' || run.recoveryAction === 'rerun' || run.recoveryAction === 'attention' || status === 'recovering' || getRunImportState(run) === 'ready') {
    return 'warning';
  }
  if (status === 'running' || status === 'completed') {
    return 'success';
  }
  return 'muted';
}

function runStatusLabel(run: DurableRunRecord): string {
  const status = run.status?.status;

  if (run.problems.length > 0 || run.recoveryAction === 'invalid' || status === 'failed' || status === 'interrupted' || getRunImportState(run) === 'failed') {
    return 'issue';
  }
  if (run.recoveryAction === 'resume' || run.recoveryAction === 'rerun' || run.recoveryAction === 'attention' || status === 'recovering' || getRunImportState(run) === 'ready') {
    return 'review';
  }
  if (status === 'running') {
    return 'running';
  }
  if (status === 'completed') {
    return 'done';
  }
  return 'queued';
}

function formatRecoveryAction(action: string): string {
  switch (action) {
    case 'resume':
      return 'resume';
    case 'rerun':
      return 'rerun';
    case 'invalid':
      return 'invalid';
    case 'attention':
      return 'manual review';
    default:
      return action;
  }
}

function runMomentLabel(run: DurableRunRecord): string | null {
  const moment = getRunMoment(run);
  return moment.at ? `${moment.label} ${timeAgo(moment.at)}` : null;
}

function isGenericRunSummary(summary: string): boolean {
  return /^(Live conversation|Background run|Scheduled task|Wakeup|Remote execution)( · .+)?$/.test(summary)
    || summary === 'Conversation node distillation'
    || summary === 'Shell run'
    || summary === 'Workflow'
    || summary === 'Run';
}

function buildRunSummary(headline: ReturnType<typeof getRunHeadline>): string | null {
  return isGenericRunSummary(headline.summary) ? null : headline.summary;
}

function sortRunsForPage(runRecords: DurableRunRecord[], selectedRunId: string | null): DurableRunRecord[] {
  const sorted = [...runRecords].sort((left, right) => {
    const leftAttention = runNeedsAttention(left) ? 1 : 0;
    const rightAttention = runNeedsAttention(right) ? 1 : 0;
    if (leftAttention !== rightAttention) {
      return rightAttention - leftAttention;
    }

    const leftActive = isRunInProgress(left) ? 1 : 0;
    const rightActive = isRunInProgress(right) ? 1 : 0;
    if (leftActive !== rightActive) {
      return rightActive - leftActive;
    }

    return getRunSortTimestamp(right).localeCompare(getRunSortTimestamp(left)) || right.runId.localeCompare(left.runId);
  });

  if (!selectedRunId) {
    return sorted;
  }

  const selectedIndex = sorted.findIndex((run) => run.runId === selectedRunId);
  if (selectedIndex <= 0) {
    return sorted;
  }

  const next = [...sorted];
  const [selectedRun] = next.splice(selectedIndex, 1);
  next.unshift(selectedRun);
  return next;
}

export function RunsPage() {
  const { id: selectedRunId } = useParams<{ id?: string }>();
  const { runs, sessions, tasks, setRuns } = useAppData();
  const { status: sseStatus } = useSseConnection();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    if (runs !== null) {
      return;
    }

    let cancelled = false;
    void api.runs()
      .then((nextRuns) => {
        if (!cancelled) {
          setRuns(nextRuns);
          setRefreshError(null);
        }
      })
      .catch((error) => {
        if (!cancelled && sseStatus === 'offline') {
          setRefreshError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runs, setRuns, sseStatus]);

  const refreshRuns = useCallback(async () => {
    setRefreshing(true);
    try {
      const nextRuns = await api.runs();
      setRuns(nextRuns);
      setRefreshError(null);
      return nextRuns;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRefreshError(message);
      return null;
    } finally {
      setRefreshing(false);
    }
  }, [setRuns]);

  const lookups = useMemo<RunPresentationLookups>(() => ({ tasks, sessions }), [sessions, tasks]);
  const orderedRuns = useMemo(
    () => sortRunsForPage(runs?.runs ?? [], selectedRunId ?? null),
    [runs?.runs, selectedRunId],
  );
  const activeCount = useMemo(() => orderedRuns.filter((run) => isRunInProgress(run)).length, [orderedRuns]);
  const reviewCount = useMemo(() => orderedRuns.filter((run) => runNeedsAttention(run)).length, [orderedRuns]);
  const isLoading = runs === null && (sseStatus === 'connecting' || sseStatus === 'reconnecting');
  const visibleError = runs === null && sseStatus === 'offline'
    ? refreshError ?? 'Live updates are offline. Use refresh to load the latest durable runs.'
    : refreshError;

  return (
    <div className="flex h-full flex-col">
      <PageHeader actions={<ToolbarButton onClick={() => { void refreshRuns(); }} disabled={refreshing}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</ToolbarButton>}>
        <PageHeading
          title="Runs"
          meta={runs
            ? (
              <>
                {orderedRuns.length} {orderedRuns.length === 1 ? 'run' : 'runs'}
                {activeCount > 0 && <span className="ml-2 text-secondary">· {activeCount} active</span>}
                {reviewCount > 0 && <span className="ml-2 text-warning">· {reviewCount} need review</span>}
                <span className={`ml-2 ${sseStatus === 'open' ? 'text-secondary' : 'text-warning'}`}>
                  · live updates {sseStatus === 'open' ? 'via SSE' : 'offline'}
                </span>
              </>
            )
            : 'Durable background work, active runs, and recovery review.'}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading && <LoadingState label="Loading durable runs…" />}
        {visibleError && <ErrorState message={`Failed to load durable runs: ${visibleError}`} />}
        {!isLoading && !visibleError && runs && orderedRuns.length === 0 && (
          <EmptyState
            title="No durable runs yet"
            body="Runs from background tasks, scheduled work, deferred resumes, and other daemon-backed workflows will show up here."
          />
        )}
        {!isLoading && runs && orderedRuns.length > 0 && (
          <div className="space-y-px pb-5">
            {orderedRuns.map((run) => {
              const headline = getRunHeadline(run, lookups);
              const tone = runStatusTone(run);
              const statusLabel = runStatusLabel(run);
              const moment = runMomentLabel(run);
              const primaryConnection = getRunPrimaryConnection(run, lookups);
              const connectionLabel = primaryConnection?.label === 'Conversation to reopen'
                ? 'conversation'
                : primaryConnection?.label?.toLowerCase();
              const summary = buildRunSummary(headline);
              const recoveryLabel = formatRecoveryAction(run.recoveryAction);
              const metaParts = [moment, connectionLabel].filter((value): value is string => typeof value === 'string' && value.length > 0);
              if (run.recoveryAction !== 'none' && recoveryLabel !== statusLabel) {
                metaParts.push(recoveryLabel);
              }
              if (run.problems.length > 0) {
                metaParts.push(`${run.problems.length} issue${run.problems.length === 1 ? '' : 's'}`);
              }
              metaParts.push(run.runId);

              return (
                <ListLinkRow
                  key={run.runId}
                  to={`/runs/${encodeURIComponent(run.runId)}`}
                  selected={selectedRunId === run.runId}
                  leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${toneDotClass(tone)}`} />}
                  trailing={<span className={`mt-0.5 text-[11px] font-mono ${selectedRunId === run.runId ? 'text-accent' : 'text-dim group-hover:text-secondary'}`}>details</span>}
                >
                  <div className="flex items-center gap-2">
                    <p className="ui-row-title">{headline.title}</p>
                    <Pill tone={tone}>{statusLabel}</Pill>
                  </div>
                  {summary && <p className="ui-row-summary">{summary}</p>}
                  <p className="ui-row-meta break-words">{metaParts.join(' · ')}</p>
                </ListLinkRow>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
