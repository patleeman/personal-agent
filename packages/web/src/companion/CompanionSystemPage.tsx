import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useCompanionTopBarAction } from './CompanionLayout';
import { api } from '../api';
import { useAppData, useSseConnection, useSystemStatus } from '../contexts';
import { buildWebUiCompanionAccessSummary } from '../webUiCompanion';
import type { DaemonState, LogTail, SyncState, WebUiState } from '../types';
import { timeAgo } from '../utils';

function takeLogLines(log: LogTail | undefined, limit = 30): string[] {
  if (!log?.lines || log.lines.length === 0) {
    return [];
  }

  return log.lines.slice(Math.max(0, log.lines.length - limit));
}

function issueSummary(warnings: string[]): string | null {
  const visible = warnings.filter((warning) => warning.trim().length > 0);
  return visible.length > 0 ? visible[0] ?? null : null;
}

function statusPill(tone: 'success' | 'warning' | 'danger' | 'muted', label: string) {
  const className = tone === 'success'
    ? 'bg-success/10 text-success'
    : tone === 'warning'
      ? 'bg-warning/10 text-warning'
      : tone === 'danger'
        ? 'bg-danger/10 text-danger'
        : 'bg-surface text-dim';

  return <span className={`rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${className}`}>{label}</span>;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-border-subtle px-4 py-4 first:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">{title}</h2>
        {action}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function DaemonSection({
  daemon,
  busy,
  onRestart,
}: {
  daemon: DaemonState | null;
  busy: boolean;
  onRestart: () => void;
}) {
  if (!daemon) {
    return (
      <Section title="Daemon">
        <p className="text-[13px] text-dim">Loading daemon state…</p>
      </Section>
    );
  }

  const online = daemon.runtime.running;
  const tone = daemon.warnings.length > 0 ? 'warning' : online ? 'success' : 'danger';
  const logLines = takeLogLines(daemon.log, 24);

  return (
    <Section
      title="Daemon"
      action={(
        <button
          type="button"
          onClick={onRestart}
          disabled={busy}
          className="rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {busy ? 'Restarting…' : 'Restart'}
        </button>
      )}
    >
      <div className="rounded-xl bg-base/65 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {statusPill(tone, online ? 'running' : 'offline')}
          <span className="text-[12px] text-secondary">{daemon.runtime.moduleCount} modules</span>
          {typeof daemon.runtime.queueDepth === 'number' && typeof daemon.runtime.maxQueueDepth === 'number' ? (
            <span className="text-[12px] text-dim">queue {daemon.runtime.queueDepth}/{daemon.runtime.maxQueueDepth}</span>
          ) : null}
        </div>
        <p className="mt-2 break-words text-[12px] text-dim">
          {daemon.runtime.startedAt ? `started ${timeAgo(daemon.runtime.startedAt)}` : 'not started'}
          {daemon.runtime.pid ? ` · pid ${daemon.runtime.pid}` : ''}
        </p>
        {issueSummary(daemon.warnings) ? <p className="mt-2 text-[12px] leading-relaxed text-warning">{issueSummary(daemon.warnings)}</p> : null}
      </div>
      {logLines.length > 0 ? <pre className="overflow-auto whitespace-pre-wrap break-words rounded-xl bg-base/65 px-3 py-3 font-mono text-[11px] leading-relaxed text-secondary">{logLines.join('\n')}</pre> : null}
      {daemon.log.path ? <p className="break-words text-[11px] text-dim">{daemon.log.path}</p> : null}
    </Section>
  );
}

function SyncSection({
  sync,
  busy,
  onRun,
}: {
  sync: SyncState | null;
  busy: boolean;
  onRun: () => void;
}) {
  if (!sync) {
    return (
      <Section title="Sync">
        <p className="text-[13px] text-dim">Loading sync state…</p>
      </Section>
    );
  }

  const enabled = sync.config.enabled;
  const healthy = enabled && sync.daemon.connected && sync.git.hasRepo && sync.warnings.length === 0;
  const tone = !enabled ? 'muted' : healthy ? 'success' : 'warning';
  const logLines = takeLogLines(sync.log, 24);
  const dirtyEntries = sync.git.dirtyEntries ?? 0;

  return (
    <Section
      title="Sync"
      action={enabled ? (
        <button
          type="button"
          onClick={onRun}
          disabled={busy}
          className="rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {busy ? 'Running…' : 'Run now'}
        </button>
      ) : null}
    >
      <div className="rounded-xl bg-base/65 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {statusPill(tone, !enabled ? 'disabled' : healthy ? 'healthy' : 'attention')}
          <span className="text-[12px] text-secondary">{sync.git.hasRepo ? `${dirtyEntries} local change${dirtyEntries === 1 ? '' : 's'}` : 'repo missing'}</span>
        </div>
        <p className="mt-2 break-words text-[12px] text-dim">
          {enabled ? `tracking ${sync.config.remote}/${sync.config.branch}` : 'automatic sync disabled'}
          {sync.daemon.moduleDetail?.lastSuccessAt ? ` · last success ${timeAgo(sync.daemon.moduleDetail.lastSuccessAt)}` : ''}
        </p>
        {issueSummary(sync.warnings) ? <p className="mt-2 text-[12px] leading-relaxed text-warning">{issueSummary(sync.warnings)}</p> : null}
      </div>
      {logLines.length > 0 ? <pre className="overflow-auto whitespace-pre-wrap break-words rounded-xl bg-base/65 px-3 py-3 font-mono text-[11px] leading-relaxed text-secondary">{logLines.join('\n')}</pre> : null}
      {sync.log.path ? <p className="break-words text-[11px] text-dim">{sync.log.path}</p> : null}
    </Section>
  );
}

function WebUiSection({
  webUi,
  busy,
  onRestart,
}: {
  webUi: WebUiState | null;
  busy: boolean;
  onRestart: () => void;
}) {
  if (!webUi) {
    return (
      <Section title="Web UI">
        <p className="text-[13px] text-dim">Loading web UI state…</p>
      </Section>
    );
  }

  const running = webUi.service.running;
  const tone = webUi.warnings.length > 0 ? 'warning' : running ? 'success' : 'danger';
  const companion = buildWebUiCompanionAccessSummary(webUi.service);
  const logLines = takeLogLines(webUi.log, 24);

  return (
    <Section
      title="Web UI"
      action={(
        <button
          type="button"
          onClick={onRestart}
          disabled={busy}
          className="rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {busy ? 'Restarting…' : 'Restart'}
        </button>
      )}
    >
      <div className="rounded-xl bg-base/65 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {statusPill(tone, running ? 'running' : 'offline')}
          <span className="break-words text-[12px] text-secondary">{webUi.service.url}</span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-dim">{companion.detail}</p>
        <p className="mt-2 break-words text-[12px] text-dim">Companion {companion.statusLabel} · {companion.localUrl}</p>
        {issueSummary(webUi.warnings) ? <p className="mt-2 text-[12px] leading-relaxed text-warning">{issueSummary(webUi.warnings)}</p> : null}
      </div>
      {logLines.length > 0 ? <pre className="overflow-auto whitespace-pre-wrap break-words rounded-xl bg-base/65 px-3 py-3 font-mono text-[11px] leading-relaxed text-secondary">{logLines.join('\n')}</pre> : null}
      {webUi.log.path ? <p className="break-words text-[11px] text-dim">{webUi.log.path}</p> : null}
    </Section>
  );
}

export function CompanionSystemPage() {
  const { status: sseStatus } = useSseConnection();
  const { runs, setRuns } = useAppData();
  const { daemon, sync, webUi, setDaemon, setSync, setWebUi } = useSystemStatus();
  const { setTopBarAction } = useCompanionTopBarAction();
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<'daemon' | 'sync' | 'web-ui' | 'restart-app' | 'update-app' | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const systemIssues = useMemo(
    () => [
      ...(daemon?.warnings ?? []),
      ...(sync?.warnings ?? []),
      ...(webUi?.warnings ?? []),
    ].filter((warning) => warning.trim().length > 0),
    [daemon?.warnings, sync?.warnings, webUi?.warnings],
  );
  const runSummary = runs?.summary ?? null;
  const attentionRuns = (runSummary?.recoveryActions.resume ?? 0)
    + (runSummary?.recoveryActions.rerun ?? 0)
    + (runSummary?.recoveryActions.attention ?? 0)
    + (runSummary?.recoveryActions.invalid ?? 0);

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
        // Keep the companion runs summary in loading state until refresh or SSE catches up.
      });

    return () => {
      cancelled = true;
    };
  }, [runs, setRuns]);

  useEffect(() => {
    setTopBarAction(
      <button
        key="refresh"
        type="button"
        onClick={() => { void refreshAll(); }}
        disabled={refreshing}
        className="rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
      >
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>,
    );
    return () => setTopBarAction(undefined);
  }, [refreshAll, refreshing, setTopBarAction]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    setActionError(null);
    try {
      const [nextDaemon, nextSync, nextWebUi, nextRuns] = await Promise.all([
        api.daemon(),
        api.sync(),
        api.webUiState(),
        api.runs(),
      ]);
      setDaemon(nextDaemon);
      setSync(nextSync);
      setWebUi(nextWebUi);
      setRuns(nextRuns);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }, [setDaemon, setRuns, setSync, setWebUi]);

  const runAction = useCallback(async (action: typeof busyAction, request: () => Promise<unknown>, message?: string) => {
    if (!action || busyAction) {
      return;
    }

    setBusyAction(action);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await request();
      if (action === 'restart-app' || action === 'update-app') {
        const detail = result as { message?: string };
        setActionMessage(detail.message ?? message ?? 'Request accepted.');
        return;
      }

      await refreshAll();
      setActionMessage(message ?? 'Done.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, refreshAll]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-6">
          {actionError ? <p className="px-4 pb-4 text-[13px] text-danger">{actionError}</p> : null}
          {actionMessage ? <p className="px-4 pb-4 text-[13px] text-success">{actionMessage}</p> : null}

          <div className="overflow-hidden border-y border-border-subtle bg-surface/70">
            <Section title="Application controls">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { void runAction('restart-app', api.restartApplication, 'Restart requested. The companion may disconnect briefly.'); }}
                  disabled={busyAction !== null}
                  className="rounded-full border border-border-default px-3 py-1.5 text-[11px] font-medium text-secondary transition-colors hover:text-primary disabled:cursor-default disabled:opacity-45"
                >
                  {busyAction === 'restart-app' ? 'Requesting…' : 'Restart app'}
                </button>
                <button
                  type="button"
                  onClick={() => { void runAction('update-app', api.updateApplication, 'Update requested. The companion may disconnect briefly.'); }}
                  disabled={busyAction !== null}
                  className="rounded-full border border-border-default px-3 py-1.5 text-[11px] font-medium text-secondary transition-colors hover:text-primary disabled:cursor-default disabled:opacity-45"
                >
                  {busyAction === 'update-app' ? 'Requesting…' : 'Update app'}
                </button>
              </div>
            </Section>

            <DaemonSection
              daemon={daemon}
              busy={busyAction === 'daemon'}
              onRestart={() => { void runAction('daemon', api.restartDaemonService, 'Daemon restarted.'); }}
            />
            <SyncSection
              sync={sync}
              busy={busyAction === 'sync'}
              onRun={() => { void runAction('sync', api.runSync, 'Sync run requested.'); }}
            />
            <WebUiSection
              webUi={webUi}
              busy={busyAction === 'web-ui'}
              onRestart={() => { void runAction('web-ui', api.restartWebUiService, 'Web UI restarted.'); }}
            />

            <Section title="Background runs">
              {runSummary ? (
                <div className="rounded-xl bg-base/65 px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {statusPill(attentionRuns > 0 ? 'warning' : (runSummary.statuses.running ?? 0) > 0 ? 'success' : 'muted', attentionRuns > 0 ? 'attention' : (runSummary.statuses.running ?? 0) > 0 ? 'active' : 'idle')}
                    <span className="text-[12px] text-secondary">{runSummary.total} total</span>
                    {(runSummary.statuses.running ?? 0) > 0 ? <span className="text-[12px] text-dim">{runSummary.statuses.running} running</span> : null}
                    {attentionRuns > 0 ? <span className="text-[12px] text-warning">{attentionRuns} need review</span> : null}
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-dim">
                    {runs?.runs.slice(0, 3).map((run) => run.runId).join(' · ') || 'No durable runs yet.'}
                  </p>
                </div>
              ) : (
                <p className="text-[13px] text-dim">Loading durable runs…</p>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
