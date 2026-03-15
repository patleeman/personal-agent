import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApi } from '../hooks';
import { timeAgo } from '../utils';
import { ErrorState, LoadingState, PageHeader, PageHeading, SectionLabel, ToolbarButton } from '../components/ui';

function shortPath(path: string | undefined, maxLen = 90): string {
  if (!path || path.trim().length === 0) {
    return '—';
  }

  return path.length > maxLen ? `…${path.slice(-(maxLen - 1))}` : path;
}

function toStatusTone(value: boolean): string {
  return value ? 'text-success' : 'text-warning';
}

function toStatusText(value: boolean, positive: string, negative: string): string {
  return value ? positive : negative;
}

function StatBlock({
  label,
  value,
  meta,
  valueClassName,
}: {
  label: string;
  value: string;
  meta?: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="ui-section-label">{label}</p>
      <p className={['mt-1 text-[13px] font-medium text-primary', valueClassName].filter(Boolean).join(' ')}>{value}</p>
      {meta && <p className="ui-card-meta mt-1 break-words">{meta}</p>}
    </div>
  );
}

export function SyncPage() {
  const { data, loading, error, refetch } = useApi(api.sync);
  const [runningSync, setRunningSync] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refetch({ resetLoading: false });
    }, 20_000);

    return () => window.clearInterval(id);
  }, [refetch]);

  async function handleRunNow() {
    if (runningSync) return;

    setRunningSync(true);
    setActionError(null);
    try {
      await api.runSync();
      await refetch({ resetLoading: false });
    } catch (runError) {
      setActionError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setRunningSync(false);
    }
  }

  const enabled = data?.config.enabled ?? false;
  const daemonConnected = data?.daemon.connected ?? false;
  const syncModuleEnabled = data?.daemon.moduleEnabled ?? false;
  const hasRepo = data?.git.hasRepo ?? false;
  const dirtyEntries = data?.git.dirtyEntries;
  const lastSuccessAt = data?.daemon.moduleDetail?.lastSuccessAt;
  const lastRunAt = data?.daemon.moduleDetail?.lastRunAt;
  const lastCommitAt = data?.daemon.moduleDetail?.lastCommitAt;
  const lastResolverStartedAt = data?.daemon.moduleDetail?.lastResolverStartedAt;
  const lastResolverResult = data?.daemon.moduleDetail?.lastResolverResult;
  const lastErrorResolverStartedAt = data?.daemon.moduleDetail?.lastErrorResolverStartedAt;
  const lastErrorResolverResult = data?.daemon.moduleDetail?.lastErrorResolverResult;
  const lastError = data?.daemon.moduleDetail?.lastError;
  const conflicts = data?.daemon.moduleDetail?.lastConflictFiles ?? [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={(
          <>
            <ToolbarButton onClick={() => { void handleRunNow(); }} disabled={runningSync || !data?.daemon.connected}>
              {runningSync ? 'Running sync…' : 'Run sync now'}
            </ToolbarButton>
            <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={runningSync}>↻ Refresh</ToolbarButton>
          </>
        )}
      >
        <PageHeading
          title="Sync"
          meta={data && (
            <>
              Git sync · {enabled ? 'enabled' : 'disabled'} · {daemonConnected ? 'daemon connected' : 'daemon offline'}
              {typeof dirtyEntries === 'number' ? ` · ${dirtyEntries} dirty` : ''}
            </>
          )}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && <LoadingState label="Loading sync state…" />}
        {!loading && error && <ErrorState message={`Failed to load sync state: ${error}`} />}

        {data && (
          <div className="space-y-8">
            {(data.warnings.length > 0 || actionError) && (
              <div className="space-y-1">
                {data.warnings.map((warning) => (
                  <p key={warning} className="text-[12px] text-warning">{warning}</p>
                ))}
                {actionError && <p className="text-[12px] text-danger">{actionError}</p>}
                {lastError && <p className="text-[12px] text-danger">Last sync error: {lastError}</p>}
              </div>
            )}

            <section className="space-y-4">
              <SectionLabel label="Overview" />
              <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
                <StatBlock
                  label="Sync module"
                  value={toStatusText(enabled, 'enabled', 'disabled')}
                  valueClassName={toStatusTone(enabled)}
                  meta={`every ${data.config.intervalSeconds}s`}
                />
                <StatBlock
                  label="Daemon"
                  value={toStatusText(daemonConnected, 'connected', 'offline')}
                  valueClassName={toStatusTone(daemonConnected)}
                  meta={syncModuleEnabled ? 'sync module loaded' : 'sync module missing'}
                />
                <StatBlock
                  label="Git repo"
                  value={toStatusText(hasRepo, 'ready', 'missing')}
                  valueClassName={toStatusTone(hasRepo)}
                  meta={shortPath(data.config.repoDir)}
                />
                <StatBlock
                  label="Dirty entries"
                  value={typeof dirtyEntries === 'number' ? String(dirtyEntries) : '—'}
                  meta={data.git.currentBranch ? `branch ${data.git.currentBranch}` : undefined}
                />
                <StatBlock
                  label="Last success"
                  value={lastSuccessAt ? timeAgo(lastSuccessAt) : 'never'}
                  meta={lastSuccessAt ?? undefined}
                />
                <StatBlock
                  label="Last run"
                  value={lastRunAt ? timeAgo(lastRunAt) : 'never'}
                  meta={lastRunAt ?? undefined}
                />
                <StatBlock
                  label="Last commit"
                  value={lastCommitAt ? timeAgo(lastCommitAt) : 'none'}
                  meta={data.git.lastCommit}
                />
                <StatBlock
                  label="Conflict resolver"
                  value={toStatusText(data.config.autoResolveWithAgent, 'enabled', 'disabled')}
                  meta={`task ${data.config.conflictResolverTaskSlug}`}
                />
                <StatBlock
                  label="Conflict resolver activity"
                  value={lastResolverStartedAt ? timeAgo(lastResolverStartedAt) : 'none'}
                  meta={lastResolverResult ?? undefined}
                />
                <StatBlock
                  label="Error resolver"
                  value={toStatusText(data.config.autoResolveErrorsWithAgent, 'enabled', 'disabled')}
                  meta={`task ${data.config.errorResolverTaskSlug}`}
                />
                <StatBlock
                  label="Error resolver activity"
                  value={lastErrorResolverStartedAt ? timeAgo(lastErrorResolverStartedAt) : 'none'}
                  meta={lastErrorResolverResult ?? undefined}
                />
              </div>
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <SectionLabel label="Configuration" />
              <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
                <StatBlock label="Remote" value={data.config.remote} meta={data.git.remoteUrl} />
                <StatBlock label="Branch" value={data.config.branch} />
                <StatBlock label="Repo" value={shortPath(data.config.repoDir)} />
                <StatBlock label="Conflict cooldown" value={`${data.config.resolverCooldownMinutes}m`} />
                <StatBlock label="Error cooldown" value={`${data.config.errorResolverCooldownMinutes}m`} />
              </div>
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <SectionLabel label="Conflicts" />
              {conflicts.length === 0 ? (
                <p className="ui-card-meta">No unresolved conflicts reported.</p>
              ) : (
                <ul className="space-y-1 text-[12px] text-warning">
                  {conflicts.map((file) => (
                    <li key={file}>• {file}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <SectionLabel label="Recent sync log" />
              <p className="ui-card-meta break-all">{shortPath(data.log.path)}</p>
              <pre className="overflow-x-auto rounded-lg bg-surface/70 px-3 py-2 text-[11px] leading-relaxed text-secondary">
                {data.log.lines.length > 0 ? data.log.lines.join('\n') : 'No recent sync log lines.'}
              </pre>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
