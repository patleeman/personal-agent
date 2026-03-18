import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import type { DaemonState, GatewayLogTail, SyncState, WebUiReleaseSummary } from '../types';
import { timeAgo } from '../utils';
import { ErrorState, LoadingState, PageHeader, PageHeading, SectionLabel, ToolbarButton } from '../components/ui';

function shortPath(path: string | undefined, maxLen = 84): string {
  if (!path || path.trim().length === 0) {
    return '—';
  }

  return path.length > maxLen ? `…${path.slice(-(maxLen - 1))}` : path;
}

function serviceStatusText(input: {
  installed: boolean;
  running: boolean;
  error?: string;
}): string {
  if (input.error) return 'inspection error';
  if (input.running) return 'running';
  if (input.installed) return 'stopped';
  return 'not installed';
}

function serviceToneClass(input: {
  installed: boolean;
  running: boolean;
  error?: string;
}): string {
  if (input.error) return 'text-danger';
  if (input.running) return 'text-success';
  if (input.installed) return 'text-warning';
  return 'text-dim';
}

function daemonRuntimeText(data: DaemonState): string {
  return data.runtime.running ? 'connected' : 'offline';
}

function daemonRuntimeToneClass(data: DaemonState): string {
  if (data.runtime.running) return 'text-success';
  if (data.service.installed) return 'text-warning';
  return 'text-dim';
}

function syncSummaryText(data: SyncState): string {
  if (!data.config.enabled) return 'disabled';
  if (!data.daemon.connected) return 'waiting for daemon';
  return 'enabled';
}

function syncSummaryToneClass(data: SyncState): string {
  if (!data.config.enabled) return 'text-warning';
  if (!data.daemon.connected) return 'text-warning';
  if (!data.git.hasRepo) return 'text-warning';
  return 'text-success';
}

function releaseKey(release: WebUiReleaseSummary | undefined): string {
  if (!release) {
    return 'none';
  }

  return [release.slot, release.revision ?? '', release.builtAt].join(':');
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

function LogTailBlock({
  label,
  log,
  emptyLabel,
}: {
  label: string;
  log: GatewayLogTail | undefined;
  emptyLabel: string;
}) {
  const lines = (log?.lines ?? []).slice(-8);

  return (
    <div className="min-w-0 space-y-2">
      <div className="space-y-1">
        <p className="ui-section-label">{label}</p>
        <p className="ui-card-meta break-all">{shortPath(log?.path)}</p>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-surface/70 px-3 py-2 text-[11px] leading-relaxed text-secondary">
        {lines.length > 0 ? lines.join('\n') : emptyLabel}
      </pre>
    </div>
  );
}

function SystemSection({
  id,
  label,
  description,
  to,
  children,
}: {
  id: string;
  label: string;
  description: string;
  to: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="space-y-4 border-t border-border-subtle pt-6 scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <SectionLabel label={label} />
          <p className="ui-card-meta max-w-3xl">{description}</p>
        </div>
        <Link to={to} className="ui-toolbar-button">Open advanced page</Link>
      </div>
      {children}
    </section>
  );
}

export function SystemPage() {
  const daemon = useApi(api.daemon);
  const sync = useApi(api.sync);
  const gateway = useApi(api.gateway);
  const webUi = useApi(api.webUiState);
  const [applicationAction, setApplicationAction] = useState<'restart' | 'update' | null>(null);
  const [applicationMessage, setApplicationMessage] = useState<string | null>(null);
  const [applicationError, setApplicationError] = useState<string | null>(null);
  const actionMonitorRef = useRef<number | null>(null);

  const refreshAll = useCallback(async (resetLoading = false) => {
    await Promise.all([
      daemon.refetch({ resetLoading }),
      sync.refetch({ resetLoading }),
      gateway.refetch({ resetLoading }),
      webUi.refetch({ resetLoading }),
    ]);
  }, [daemon.refetch, gateway.refetch, sync.refetch, webUi.refetch]);

  function clearActionMonitor() {
    if (actionMonitorRef.current !== null) {
      window.clearTimeout(actionMonitorRef.current);
      actionMonitorRef.current = null;
    }
  }

  function startApplicationMonitor(previousReleaseKey: string) {
    clearActionMonitor();

    let sawFailure = false;
    let attempts = 0;

    const poll = async () => {
      attempts += 1;

      try {
        const next = await api.webUiState();
        const nextReleaseKey = releaseKey(next.service.deployment?.activeRelease);

        if (sawFailure || nextReleaseKey !== previousReleaseKey) {
          clearActionMonitor();
          window.location.reload();
          return;
        }
      } catch {
        sawFailure = true;
      }

      if (attempts >= 120) {
        clearActionMonitor();
        setApplicationAction(null);
        setApplicationMessage('The requested application action is taking longer than expected. Refresh in a moment to check the new release.');
        return;
      }

      actionMonitorRef.current = window.setTimeout(() => {
        void poll();
      }, 2500);
    };

    actionMonitorRef.current = window.setTimeout(() => {
      void poll();
    }, 2500);
  }

  useEffect(() => () => {
    clearActionMonitor();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (applicationAction) {
        return;
      }
      void refreshAll(false);
    }, 20_000);

    return () => window.clearInterval(id);
  }, [applicationAction, refreshAll]);

  const combinedWarnings = useMemo(() => {
    return [
      ...(webUi.data?.warnings ?? []).map((warning) => `Web UI: ${warning}`),
      ...(daemon.data?.warnings ?? []).map((warning) => `Daemon: ${warning}`),
      ...(gateway.data?.warnings ?? []).map((warning) => `Gateway: ${warning}`),
      ...(sync.data?.warnings ?? []).map((warning) => `Sync: ${warning}`),
    ];
  }, [daemon.data?.warnings, gateway.data?.warnings, sync.data?.warnings, webUi.data?.warnings]);

  async function handleApplicationAction(action: 'restart' | 'update') {
    if (applicationAction || !webUi.data?.service.installed) {
      return;
    }

    const confirmed = window.confirm(
      action === 'update'
        ? 'Run `pa update`? This pulls the latest git changes, refreshes repo dependencies, rebuilds packages, restarts background services, and blue/green redeploys the managed web UI.'
        : 'Run `pa restart --rebuild`? This rebuilds repo packages, restarts background services, and blue/green redeploys the managed web UI.'
    );
    if (!confirmed) {
      return;
    }

    setApplicationAction(action);
    setApplicationError(null);
    setApplicationMessage(null);

    try {
      const previousReleaseKey = releaseKey(webUi.data.service.deployment?.activeRelease);
      const result = action === 'update'
        ? await api.updateApplication()
        : await api.restartApplication();
      setApplicationMessage(`${result.message} This page will reload when the new release is live, and Inbox will get an unread completion item after blue/green cutover.`);
      startApplicationMonitor(previousReleaseKey);
    } catch (error) {
      setApplicationAction(null);
      setApplicationError(error instanceof Error ? error.message : String(error));
    }
  }

  const hasAnyData = Boolean(daemon.data || sync.data || gateway.data || webUi.data);
  const canManageApplication = webUi.data?.service.installed ?? false;
  const loadingEverything = !hasAnyData && daemon.loading && sync.loading && gateway.loading && webUi.loading;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={(
          <>
            <ToolbarButton
              onClick={() => { void handleApplicationAction('update'); }}
              disabled={applicationAction !== null || !canManageApplication}
            >
              {applicationAction === 'update' ? 'Update requested…' : 'Update + restart'}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { void handleApplicationAction('restart'); }}
              disabled={applicationAction !== null || !canManageApplication}
            >
              {applicationAction === 'restart' ? 'Restart requested…' : 'Restart everything'}
            </ToolbarButton>
            <ToolbarButton onClick={() => { void refreshAll(false); }} disabled={applicationAction !== null}>↻ Refresh</ToolbarButton>
          </>
        )}
      >
        <PageHeading
          title="System"
          meta="Consolidated status for the daemon, sync module, gateway, and managed web UI."
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loadingEverything && <LoadingState label="Loading system status…" />}

        {!loadingEverything && (
          <div className="space-y-8">
            {(combinedWarnings.length > 0 || applicationMessage || applicationError || !canManageApplication) && (
              <div className="space-y-1">
                {combinedWarnings.map((warning) => (
                  <p key={warning} className="text-[12px] text-warning">{warning}</p>
                ))}
                {!canManageApplication && webUi.data && (
                  <p className="text-[12px] text-warning">
                    Global application actions require the managed web UI service. Install it from the advanced Web UI page first.
                  </p>
                )}
                {applicationMessage && <p className="text-[12px] text-secondary">{applicationMessage}</p>}
                {applicationError && <p className="text-[12px] text-danger">{applicationError}</p>}
              </div>
            )}

            <section className="space-y-4">
              <SectionLabel label="Overview" />
              <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
                <StatBlock
                  label="Web UI"
                  value={webUi.data ? serviceStatusText(webUi.data.service) : 'loading…'}
                  meta={webUi.data
                    ? [
                      webUi.data.service.deployment?.activeSlot ? `active ${webUi.data.service.deployment.activeSlot}` : '',
                      webUi.data.service.url,
                    ].filter(Boolean).join(' · ')
                    : undefined}
                  valueClassName={webUi.data ? serviceToneClass(webUi.data.service) : undefined}
                />
                <StatBlock
                  label="Daemon"
                  value={daemon.data ? daemonRuntimeText(daemon.data) : 'loading…'}
                  meta={daemon.data
                    ? `modules ${daemon.data.runtime.moduleCount} · queue ${daemon.data.runtime.queueDepth ?? 0}/${daemon.data.runtime.maxQueueDepth ?? 0}`
                    : undefined}
                  valueClassName={daemon.data ? daemonRuntimeToneClass(daemon.data) : undefined}
                />
                <StatBlock
                  label="Gateway"
                  value={gateway.data ? serviceStatusText(gateway.data.service) : 'loading…'}
                  meta={gateway.data
                    ? `${gateway.data.pendingMessages.length} pending · ${gateway.data.conversations.length} conversations`
                    : undefined}
                  valueClassName={gateway.data ? serviceToneClass(gateway.data.service) : undefined}
                />
                <StatBlock
                  label="Sync"
                  value={sync.data ? syncSummaryText(sync.data) : 'loading…'}
                  meta={sync.data
                    ? `${sync.data.git.dirtyEntries ?? 0} dirty · ${sync.data.git.hasRepo ? 'repo ready' : 'repo missing'}`
                    : undefined}
                  valueClassName={sync.data ? syncSummaryToneClass(sync.data) : undefined}
                />
              </div>
            </section>

            <SystemSection
              id="web-ui"
              label="Web UI"
              description="Managed service state, live release, and recent logs. Use the advanced page for install/start/stop, tailscale, rollback, and bad-release controls."
              to="/web-ui"
            >
              {webUi.loading && !webUi.data && <LoadingState label="Loading web UI state…" />}
              {!webUi.loading && webUi.error && !webUi.data && <ErrorState message={`Failed to load web UI state: ${webUi.error}`} />}
              {webUi.data && (
                <div className="space-y-4">
                  <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
                    <StatBlock
                      label="Managed service"
                      value={serviceStatusText(webUi.data.service)}
                      meta={[webUi.data.service.platform, webUi.data.service.identifier].filter(Boolean).join(' · ')}
                      valueClassName={serviceToneClass(webUi.data.service)}
                    />
                    <StatBlock
                      label="Current release"
                      value={webUi.data.service.deployment?.activeRelease?.revision ?? (webUi.data.service.deployment?.activeRelease ? webUi.data.service.deployment.activeRelease.slot : '—')}
                      meta={webUi.data.service.deployment?.activeRelease
                        ? `built ${timeAgo(webUi.data.service.deployment.activeRelease.builtAt)}`
                        : 'No staged release'}
                    />
                    <StatBlock
                      label="URL"
                      value={webUi.data.service.url}
                      meta={[
                        `port ${webUi.data.service.port}`,
                        webUi.data.service.tailscaleUrl ? `tailnet ${webUi.data.service.tailscaleUrl}` : '',
                      ].filter(Boolean).join(' · ')}
                    />
                    <StatBlock
                      label="Tailscale Serve"
                      value={webUi.data.service.tailscaleServe ? 'enabled' : 'disabled'}
                      meta={webUi.data.service.tailscaleServe ? 'Tailnet-only by default' : 'Disabled'}
                    />
                  </div>
                  <LogTailBlock label="Recent log" log={webUi.data.log} emptyLabel="No recent web UI log lines." />
                </div>
              )}
            </SystemSection>

            <SystemSection
              id="daemon"
              label="Daemon"
              description="Background automation runtime, queue depth, and recent daemon log output. Use the advanced page for service management."
              to="/daemon"
            >
              {daemon.loading && !daemon.data && <LoadingState label="Loading daemon state…" />}
              {!daemon.loading && daemon.error && !daemon.data && <ErrorState message={`Failed to load daemon state: ${daemon.error}`} />}
              {daemon.data && (
                <div className="space-y-4">
                  <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
                    <StatBlock
                      label="Managed service"
                      value={serviceStatusText(daemon.data.service)}
                      meta={[daemon.data.service.platform, daemon.data.service.identifier].filter(Boolean).join(' · ')}
                      valueClassName={serviceToneClass(daemon.data.service)}
                    />
                    <StatBlock
                      label="Runtime"
                      value={daemonRuntimeText(daemon.data)}
                      meta={shortPath(daemon.data.runtime.socketPath)}
                      valueClassName={daemonRuntimeToneClass(daemon.data)}
                    />
                    <StatBlock
                      label="PID"
                      value={daemon.data.runtime.pid !== undefined ? String(daemon.data.runtime.pid) : '—'}
                      meta={daemon.data.runtime.startedAt ? `started ${timeAgo(daemon.data.runtime.startedAt)}` : 'No live daemon process detected'}
                    />
                    <StatBlock
                      label="Modules"
                      value={String(daemon.data.runtime.moduleCount)}
                      meta={daemon.data.runtime.running
                        ? `queue ${daemon.data.runtime.queueDepth ?? 0}/${daemon.data.runtime.maxQueueDepth ?? 0}`
                        : 'Daemon is offline'}
                    />
                  </div>
                  <LogTailBlock label="Recent log" log={daemon.data.log} emptyLabel="No recent daemon log lines." />
                </div>
              )}
            </SystemSection>

            <SystemSection
              id="gateway"
              label="Gateway"
              description="Telegram gateway service health, queue depth, tracked conversations, and recent logs. Use the advanced page for configuration and conversation details."
              to="/gateway"
            >
              {gateway.loading && !gateway.data && <LoadingState label="Loading gateway state…" />}
              {!gateway.loading && gateway.error && !gateway.data && <ErrorState message={`Failed to load gateway state: ${gateway.error}`} />}
              {gateway.data && (
                <div className="space-y-4">
                  <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
                    <StatBlock
                      label="Service"
                      value={serviceStatusText(gateway.data.service)}
                      meta={[gateway.data.service.platform, gateway.data.service.identifier].filter(Boolean).join(' · ')}
                      valueClassName={serviceToneClass(gateway.data.service)}
                    />
                    <StatBlock
                      label="Profile"
                      value={gateway.data.currentProfile}
                      meta={`Saved gateway profile ${gateway.data.configuredProfile}`}
                    />
                    <StatBlock
                      label="Pending queue"
                      value={String(gateway.data.pendingMessages.length)}
                      meta={gateway.data.pendingMessages.length === 1 ? '1 durable message' : `${gateway.data.pendingMessages.length} durable messages`}
                    />
                    <StatBlock
                      label="Tracked conversations"
                      value={String(gateway.data.conversations.length)}
                      meta={`${gateway.data.access.allowlistChatIds.length} allowlisted chats`}
                    />
                  </div>
                  <LogTailBlock label="Recent log" log={gateway.data.gatewayLog} emptyLabel="No recent gateway log lines." />
                </div>
              )}
            </SystemSection>

            <SystemSection
              id="sync"
              label="Sync"
              description="Git-backed durable-state sync health, repo status, and recent sync-related daemon log output. Use the advanced page for setup and conflict details."
              to="/sync"
            >
              {sync.loading && !sync.data && <LoadingState label="Loading sync state…" />}
              {!sync.loading && sync.error && !sync.data && <ErrorState message={`Failed to load sync state: ${sync.error}`} />}
              {sync.data && (
                <div className="space-y-4">
                  <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
                    <StatBlock
                      label="Sync module"
                      value={sync.data.config.enabled ? 'enabled' : 'disabled'}
                      meta={`every ${sync.data.config.intervalSeconds}s`}
                      valueClassName={sync.data.config.enabled ? 'text-success' : 'text-warning'}
                    />
                    <StatBlock
                      label="Daemon"
                      value={sync.data.daemon.connected ? 'connected' : 'offline'}
                      meta={sync.data.daemon.moduleLoaded ? 'sync module loaded' : 'sync module missing'}
                      valueClassName={sync.data.daemon.connected ? 'text-success' : 'text-warning'}
                    />
                    <StatBlock
                      label="Git repo"
                      value={sync.data.git.hasRepo ? 'ready' : 'missing'}
                      meta={shortPath(sync.data.config.repoDir)}
                      valueClassName={sync.data.git.hasRepo ? 'text-success' : 'text-warning'}
                    />
                    <StatBlock
                      label="Last success"
                      value={sync.data.daemon.moduleDetail?.lastSuccessAt ? timeAgo(sync.data.daemon.moduleDetail.lastSuccessAt) : 'never'}
                      meta={sync.data.git.lastCommit ?? undefined}
                    />
                  </div>
                  <LogTailBlock label="Recent sync log" log={sync.data.log} emptyLabel="No recent sync log lines." />
                </div>
              )}
            </SystemSection>
          </div>
        )}
      </div>
    </div>
  );
}
