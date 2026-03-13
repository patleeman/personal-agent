import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import type { DurableRunDetailResult, DurableRunListResult, DurableRunRecord } from '../types';
import { formatDate, timeAgo } from '../utils';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, ToolbarButton } from '../components/ui';

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

function RunRow({ run, isSelected }: { run: DurableRunRecord; isSelected: boolean }) {
  const status = runStatusText(run);
  const sourceId = run.manifest?.source?.id;
  const sourceType = run.manifest?.source?.type;
  const updatedAt = run.status?.updatedAt ?? run.manifest?.createdAt;

  return (
    <ListLinkRow
      to={`/runs/${encodeURIComponent(run.runId)}`}
      selected={isSelected}
      leading={<span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${runStatusDot(run)}`} />}
    >
      <p className="ui-row-title-mono">{run.runId}</p>
      <p className="ui-row-summary">
        {run.manifest?.kind ?? 'unknown'}
        {sourceId ? ` · ${sourceId}` : sourceType ? ` · ${sourceType}` : ''}
      </p>
      <p className="ui-row-meta flex items-center gap-1.5 flex-wrap">
        <span className={status.cls}>{status.text}</span>
        <span className="opacity-40">·</span>
        <span>{formatRecoveryAction(run.recoveryAction)}</span>
        {run.manifest?.resumePolicy && (
          <>
            <span className="opacity-40">·</span>
            <span>{run.manifest.resumePolicy}</span>
          </>
        )}
        {updatedAt && (
          <>
            <span className="opacity-40">·</span>
            <span>{timeAgo(updatedAt)}</span>
          </>
        )}
        {run.problems.length > 0 && (
          <>
            <span className="opacity-40">·</span>
            <span className="text-danger">{run.problems.length} issue{run.problems.length === 1 ? '' : 's'}</span>
          </>
        )}
      </p>
    </ListLinkRow>
  );
}

function RunDetail({
  detail,
  log,
  loading,
  error,
}: {
  detail: DurableRunDetailResult | null;
  log: { path: string; log: string } | null;
  loading: boolean;
  error: string | null;
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

  return (
    <div className="mb-6 space-y-5">
      <div className="space-y-1">
        <h2 className="text-[16px] font-medium text-primary break-all">{run.runId}</h2>
        <p className="ui-card-meta flex flex-wrap items-center gap-1.5">
          <span className={status.cls}>{status.text}</span>
          <span className="opacity-40">·</span>
          <span>{run.manifest?.kind ?? 'unknown kind'}</span>
          <span className="opacity-40">·</span>
          <span>{formatRecoveryAction(run.recoveryAction)}</span>
          {run.manifest?.resumePolicy && (
            <>
              <span className="opacity-40">·</span>
              <span>{run.manifest.resumePolicy}</span>
            </>
          )}
        </p>
      </div>

      <div className="border-t border-border-subtle pt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="ui-section-label">Source</p>
          <p className="text-[13px] text-primary">{run.manifest?.source?.type ?? 'unknown'}</p>
          {run.manifest?.source?.id && <p className="text-[12px] text-secondary">{run.manifest.source.id}</p>}
          {run.manifest?.source?.filePath && <p className="text-[11px] font-mono text-dim break-all">{run.manifest.source.filePath}</p>}
        </div>

        <div className="space-y-1">
          <p className="ui-section-label">Attempts</p>
          <p className="text-[13px] text-primary">{run.status?.activeAttempt ?? 0}</p>
          {run.status?.updatedAt && <p className="text-[12px] text-secondary">updated {formatDate(run.status.updatedAt)}</p>}
          {run.status?.completedAt && <p className="text-[12px] text-secondary">completed {formatDate(run.status.completedAt)}</p>}
        </div>
      </div>

      {(run.checkpoint || run.status?.lastError || run.problems.length > 0) && (
        <div className="border-t border-border-subtle pt-4 space-y-3">
          {run.checkpoint && (
            <div className="space-y-1">
              <p className="ui-section-label">Checkpoint</p>
              <p className="text-[13px] text-primary">{run.checkpoint.step ?? 'step unavailable'}</p>
              <p className="text-[12px] text-secondary">
                updated {formatDate(run.checkpoint.updatedAt)}
                {run.checkpoint.cursor ? ` · cursor ${run.checkpoint.cursor}` : ''}
              </p>
            </div>
          )}

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
  const [listResult, setListResult] = useState<DurableRunListResult | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [detail, setDetail] = useState<DurableRunDetailResult | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLog, setDetailLog] = useState<{ path: string; log: string } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

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

  const runs = listResult?.runs ?? [];
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
          title="Runs"
          meta={(
            listResult && (
              <>
                {listResult.summary.total} {listResult.summary.total === 1 ? 'run' : 'runs'}
                {summary.running > 0 && <span className="ml-2 text-accent">· {summary.running} active</span>}
                {summary.needsRecovery > 0 && <span className="ml-2 text-warning">· {summary.needsRecovery} recoverable</span>}
                {summary.issues > 0 && <span className="ml-2 text-danger">· {summary.issues} with issues</span>}
              </>
            )
          )}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loadingList && <LoadingState label="Loading durable runs…" />}
        {listError && <ErrorState message={`Failed to load durable runs: ${listError}`} />}

        {!loadingList && !listError && selectedId && (
          <RunDetail detail={detail} log={detailLog} loading={loadingDetail} error={detailError} />
        )}

        {!loadingList && !listError && runs.length === 0 && (
          <EmptyState
            title="No durable runs yet."
            body={(
              <>
                Durable runs appear here after background work is started through the daemon. You can also start a scheduled task from the <Link to="/scheduled" className="text-accent hover:underline">Scheduled</Link> page.
              </>
            )}
          />
        )}

        {!loadingList && !listError && runs.length > 0 && (
          <div className="space-y-px">
            {runs.map((run) => (
              <RunRow key={run.runId} run={run} isSelected={run.runId === selectedId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
