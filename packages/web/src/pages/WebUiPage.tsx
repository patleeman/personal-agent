import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApi } from '../hooks';
import type { GatewayLogTail, WebUiBadReleaseSummary, WebUiReleaseSummary } from '../types';
import { timeAgo } from '../utils';
import { ErrorState, LoadingState, PageHeader, PageHeading, SectionLabel, ToolbarButton } from '../components/ui';

const DEFAULT_RESUME_FALLBACK_PROMPT = 'Continue from where you left off.';

function shortPath(path: string | undefined, maxLen = 84): string {
  if (!path || path.trim().length === 0) {
    return '—';
  }

  return path.length > maxLen ? `…${path.slice(-(maxLen - 1))}` : path;
}

function serviceStatusToneClass(input: {
  installed: boolean;
  running: boolean;
  error?: string;
}): string {
  if (input.error) return 'text-danger';
  if (input.running) return 'text-success';
  if (input.installed) return 'text-warning';
  return 'text-dim';
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

function ReleaseBlock({
  label,
  release,
  badRelease,
  emptyLabel,
}: {
  label: string;
  release?: WebUiReleaseSummary;
  badRelease?: WebUiBadReleaseSummary;
  emptyLabel: string;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="space-y-1">
        <p className="ui-section-label">{label}</p>
        {!release ? (
          <p className="ui-card-meta">{emptyLabel}</p>
        ) : (
          <>
            <p className="text-[13px] font-medium text-primary">
              {release.slot} slot{release.revision ? ` · ${release.revision}` : ''}
            </p>
            <p className="ui-card-meta">
              built {timeAgo(release.builtAt)} · source {shortPath(release.sourceRepoRoot, 72)}
            </p>
            {badRelease && (
              <p className="text-[12px] text-danger">
                Marked bad {timeAgo(badRelease.markedBadAt)}{badRelease.reason ? ` · ${badRelease.reason}` : ''}
              </p>
            )}
          </>
        )}
      </div>

      {release && (
        <div className="space-y-1.5 text-[12px] text-secondary">
          <p className="break-all"><span className="text-dim">slot:</span> {shortPath(release.slotDir)}</p>
          <p className="break-all"><span className="text-dim">dist:</span> {shortPath(release.distDir)}</p>
          <p className="break-all"><span className="text-dim">server:</span> {shortPath(release.serverEntryFile)}</p>
        </div>
      )}
    </div>
  );
}

function BadReleaseHistory({ releases }: { releases: WebUiBadReleaseSummary[] }) {
  if (releases.length === 0) {
    return <p className="ui-card-meta">No web UI releases are marked bad.</p>;
  }

  return (
    <div className="space-y-2 text-[12px] text-secondary">
      {releases.map((release) => (
        <div key={[release.sourceRepoRoot, release.revision, release.markedBadAt].join(':')} className="min-w-0">
          <p className="text-[13px] font-medium text-primary">
            {release.revision}{release.slot ? ` · ${release.slot}` : ''}
          </p>
          <p className="ui-card-meta break-words">
            marked {timeAgo(release.markedBadAt)} · source {shortPath(release.sourceRepoRoot, 72)}
          </p>
          {release.reason && <p className="text-danger break-words">{release.reason}</p>}
        </div>
      ))}
    </div>
  );
}

function LogTailBlock({ label, log }: { label: string; log: GatewayLogTail | undefined }) {
  const lines = log?.lines ?? [];

  return (
    <div className="min-w-0 space-y-2">
      <div className="space-y-1">
        <p className="ui-section-label">{label}</p>
        <p className="ui-card-meta break-all">{shortPath(log?.path)}</p>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-surface/70 px-3 py-2 text-[11px] leading-relaxed text-secondary">
        {lines.length > 0 ? lines.join('\n') : 'No recent log lines.'}
      </pre>
    </div>
  );
}

export function WebUiPage() {
  const { data, loading, error, refetch } = useApi(api.webUiState);
  const [serviceAction, setServiceAction] = useState<'install' | 'start' | 'stop' | 'uninstall' | null>(null);
  const [deploymentAction, setDeploymentAction] = useState<'rollback' | 'mark-bad' | null>(null);
  const [configAction, setConfigAction] = useState(false);
  const [resumeFallbackPromptDraft, setResumeFallbackPromptDraft] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [deploymentMessage, setDeploymentMessage] = useState<string | null>(null);
  const [applicationRestarting, setApplicationRestarting] = useState(false);
  const [applicationRestartMessage, setApplicationRestartMessage] = useState<string | null>(null);
  const [applicationRestartError, setApplicationRestartError] = useState<string | null>(null);
  const restartMonitorRef = useRef<number | null>(null);

  function clearApplicationRestartMonitor() {
    if (restartMonitorRef.current !== null) {
      window.clearTimeout(restartMonitorRef.current);
      restartMonitorRef.current = null;
    }
  }

  function startApplicationRestartMonitor(previousReleaseKey: string) {
    clearApplicationRestartMonitor();

    let sawFailure = false;
    let attempts = 0;

    const poll = async () => {
      attempts += 1;

      try {
        const next = await api.webUiState();
        const nextReleaseKey = releaseKey(next.service.deployment?.activeRelease);

        if (sawFailure || nextReleaseKey !== previousReleaseKey) {
          clearApplicationRestartMonitor();
          window.location.reload();
          return;
        }
      } catch {
        sawFailure = true;
      }

      if (attempts >= 120) {
        clearApplicationRestartMonitor();
        setApplicationRestarting(false);
        setApplicationRestartMessage('Restart is taking longer than expected. Refresh in a moment to check the new build.');
        return;
      }

      restartMonitorRef.current = window.setTimeout(() => {
        void poll();
      }, 2500);
    };

    restartMonitorRef.current = window.setTimeout(() => {
      void poll();
    }, 2500);
  }

  useEffect(() => () => {
    clearApplicationRestartMonitor();
  }, []);

  useEffect(() => {
    if (!data) {
      return;
    }

    setResumeFallbackPromptDraft(data.service.resumeFallbackPrompt);
  }, [data?.service.resumeFallbackPrompt]);

  const busy = serviceAction !== null || deploymentAction !== null || applicationRestarting || configAction;

  async function handleServiceAction(action: 'install' | 'start' | 'stop' | 'uninstall') {
    if (busy || !data) return;

    setServiceAction(action);
    setActionError(null);
    setDeploymentMessage(null);
    try {
      if (action === 'install') {
        await api.installWebUiService();
      } else if (action === 'start') {
        await api.startWebUiService();
      } else if (action === 'stop') {
        await api.stopWebUiService();
      } else {
        await api.uninstallWebUiService();
      }
      await refetch({ resetLoading: false });
    } catch (serviceError) {
      setActionError(serviceError instanceof Error ? serviceError.message : String(serviceError));
    } finally {
      setServiceAction(null);
    }
  }

  async function handleSetTailscaleServe() {
    if (busy || !data) return;

    const next = !data.service.tailscaleServe;
    setConfigAction(true);
    setActionError(null);
    setDeploymentMessage(null);
    try {
      await api.setWebUiConfig({ useTailscaleServe: next });
      await refetch({ resetLoading: false });
      setDeploymentMessage(`Tailscale Serve ${next ? 'enabled' : 'disabled'} for localhost:${data.service.port}.`);
    } catch (configErr) {
      setActionError(configErr instanceof Error ? configErr.message : String(configErr));
    } finally {
      setConfigAction(false);
    }
  }

  async function handleSaveResumeFallbackPrompt() {
    if (busy || !data) {
      return;
    }

    setConfigAction(true);
    setActionError(null);
    setDeploymentMessage(null);
    try {
      await api.setWebUiConfig({ resumeFallbackPrompt: resumeFallbackPromptDraft });
      await refetch({ resetLoading: false });
      setDeploymentMessage('Saved conversation resume fallback prompt.');
    } catch (configErr) {
      setActionError(configErr instanceof Error ? configErr.message : String(configErr));
    } finally {
      setConfigAction(false);
    }
  }

  async function handleApplicationRestart() {
    if (busy || !data?.service.installed) {
      return;
    }

    const confirmed = window.confirm(
      'Rebuild repo packages, restart daemon and installed gateway services, and blue/green redeploy the managed web UI? This matches the restart phase of `pa update` without pulling git changes, and an inbox item will appear when cutover is complete.'
    );
    if (!confirmed) {
      return;
    }

    setApplicationRestartError(null);
    setApplicationRestartMessage(null);
    setApplicationRestarting(true);

    try {
      const previousReleaseKey = releaseKey(data.service.deployment?.activeRelease);
      const result = await api.restartApplication();
      setApplicationRestartMessage(`${result.message} This page will reload when the new release is live, and Inbox will get an unread completion item after blue/green cutover.`);
      startApplicationRestartMonitor(previousReleaseKey);
    } catch (restartError) {
      setApplicationRestarting(false);
      setApplicationRestartError(restartError instanceof Error ? restartError.message : String(restartError));
    }
  }

  async function handleRollback() {
    if (busy || !data?.service.installed || !data.service.deployment?.inactiveRelease) {
      return;
    }

    const target = data.service.deployment.inactiveRelease;
    const confirmed = window.confirm(
      `Roll back the managed web UI to ${target.slot}${target.revision ? ` (${target.revision})` : ''}? The current active release will be marked bad.`
    );
    if (!confirmed) {
      return;
    }

    setDeploymentAction('rollback');
    setActionError(null);
    setDeploymentMessage(null);
    try {
      await api.rollbackWebUiService();
      await refetch({ resetLoading: false });
      setDeploymentMessage(`Rolled back to ${target.slot}${target.revision ? ` (${target.revision})` : ''}.`);
    } catch (deploymentError) {
      setActionError(deploymentError instanceof Error ? deploymentError.message : String(deploymentError));
    } finally {
      setDeploymentAction(null);
    }
  }

  async function handleMarkBad() {
    if (busy || !data?.service.deployment?.activeRelease) {
      return;
    }

    const target = data.service.deployment.activeRelease;
    const confirmed = window.confirm(
      `Mark the active web UI release ${target.revision ?? target.slot} as bad? Future blue/green deploys of this exact revision will be blocked until a different revision is built.`
    );
    if (!confirmed) {
      return;
    }

    setDeploymentAction('mark-bad');
    setActionError(null);
    setDeploymentMessage(null);
    try {
      await api.markBadWebUiRelease();
      await refetch({ resetLoading: false });
      setDeploymentMessage(`Marked ${target.revision ?? target.slot} as bad.`);
    } catch (deploymentError) {
      setActionError(deploymentError instanceof Error ? deploymentError.message : String(deploymentError));
    } finally {
      setDeploymentAction(null);
    }
  }

  const serviceText = data ? serviceStatusText(data.service) : '—';
  const serviceMeta = data
    ? [data.service.platform, data.service.identifier].filter(Boolean).join(' · ')
    : undefined;
  const serviceTone = data ? serviceStatusToneClass(data.service) : undefined;
  const publicUrlMeta = data
    ? [
      `port ${data.service.port}`,
      data.service.tailscaleUrl ? `tailnet ${data.service.tailscaleUrl}` : '',
    ].filter(Boolean).join(' · ')
    : undefined;
  const deployment = data?.service.deployment;
  const activeRelease = deployment?.activeRelease;
  const inactiveRelease = deployment?.inactiveRelease;
  const activeReleaseBad = deployment?.activeReleaseBad;
  const inactiveReleaseBad = deployment?.inactiveReleaseBad;
  const badReleases = deployment?.badReleases ?? [];
  const installButtonLabel = serviceAction === 'install'
    ? 'Installing…'
    : data?.service.installed
      ? 'Uninstall service'
      : 'Install service';
  const serviceToggleLabel = serviceAction === 'start'
    ? 'Starting…'
    : serviceAction === 'stop'
      ? 'Stopping…'
      : data?.service.running
        ? 'Stop service'
        : 'Start service';
  const normalizedResumeFallbackPromptDraft = resumeFallbackPromptDraft.trim();
  const resumeFallbackPromptDirty = Boolean(data) && (
    normalizedResumeFallbackPromptDraft.length === 0
      ? data.service.resumeFallbackPrompt !== DEFAULT_RESUME_FALLBACK_PROMPT
      : normalizedResumeFallbackPromptDraft !== data.service.resumeFallbackPrompt
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={(
          <>
            <ToolbarButton
              onClick={() => {
                void handleServiceAction(data?.service.installed ? 'uninstall' : 'install');
              }}
              disabled={!data || busy}
            >
              {serviceAction === 'uninstall' ? 'Uninstalling…' : installButtonLabel}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => {
                if (!data?.service.installed) return;
                void handleServiceAction(data.service.running ? 'stop' : 'start');
              }}
              disabled={!data?.service.installed || busy}
            >
              {serviceToggleLabel}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { void handleApplicationRestart(); }}
              disabled={busy || !data?.service.installed}
            >
              {applicationRestarting ? 'Restart requested…' : 'Restart everything'}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => {
                void handleSetTailscaleServe();
              }}
              disabled={!data || busy}
            >
              {configAction
                ? 'Saving…'
                : data?.service.tailscaleServe
                  ? 'Disable Tailscale Serve'
                  : 'Enable Tailscale Serve'}
            </ToolbarButton>
            <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={busy}>↻ Refresh</ToolbarButton>
          </>
        )}
      >
        <PageHeading
          title="Web UI"
          meta={data && (
            <>
              Main interface · {serviceText}
              {deployment?.activeSlot ? ` · active ${deployment.activeSlot}` : ''}
              {data.service.url ? ` · ${data.service.url}` : ''}
            </>
          )}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && <LoadingState label="Loading web UI state…" />}
        {!loading && error && <ErrorState message={`Failed to load web UI state: ${error}`} />}

        {data && (
          <div className="space-y-8">
            {(data.warnings.length > 0 || actionError || deploymentMessage) && (
              <div className="space-y-1">
                {data.warnings.map((warning) => (
                  <p key={warning} className="text-[12px] text-warning">{warning}</p>
                ))}
                {deploymentMessage && <p className="text-[12px] text-secondary">{deploymentMessage}</p>}
                {actionError && <p className="text-[12px] text-danger">{actionError}</p>}
              </div>
            )}

            <section className="space-y-4">
              <SectionLabel label="Overview" />
              <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-5">
                <StatBlock label="Managed service" value={serviceText} meta={serviceMeta} valueClassName={serviceTone} />
                <StatBlock label="Public URL" value={data.service.url} meta={publicUrlMeta} />
                <StatBlock
                  label="Deployment mode"
                  value="blue / green"
                  meta={deployment?.activeSlot ? `active slot ${deployment.activeSlot}` : 'No active slot yet'}
                />
                <StatBlock
                  label="Current release"
                  value={activeRelease?.revision ?? (activeRelease ? activeRelease.slot : '—')}
                  meta={activeRelease ? `built ${timeAgo(activeRelease.builtAt)}` : 'No staged release'}
                />
                <StatBlock
                  label="Tailscale Serve"
                  value={data.service.tailscaleServe ? 'enabled' : 'disabled'}
                  meta={data.service.tailscaleServe
                    ? data.service.tailscaleUrl
                      ? `Tailnet URL ${data.service.tailscaleUrl} (no internet by default)`
                      : 'Enabled, but Tailnet URL is currently unavailable'
                    : 'Run via --tailscale-serve to enable'}
                />
              </div>
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <SectionLabel label="Conversation recovery" />
              <div className="space-y-3 max-w-3xl">
                <p className="ui-card-meta">
                  When Resume cannot replay an interrupted turn exactly, it sends this fallback prompt automatically.
                </p>
                <textarea
                  value={resumeFallbackPromptDraft}
                  onChange={(event) => setResumeFallbackPromptDraft(event.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary outline-none transition-colors focus:border-accent/60"
                  spellCheck={false}
                  placeholder={DEFAULT_RESUME_FALLBACK_PROMPT}
                  disabled={busy}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <ToolbarButton
                    onClick={() => { void handleSaveResumeFallbackPrompt(); }}
                    disabled={busy || !resumeFallbackPromptDirty}
                  >
                    {configAction ? 'Saving…' : 'Save fallback prompt'}
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => { setResumeFallbackPromptDraft(DEFAULT_RESUME_FALLBACK_PROMPT); }}
                    disabled={busy || resumeFallbackPromptDraft === DEFAULT_RESUME_FALLBACK_PROMPT}
                  >
                    Use default
                  </ToolbarButton>
                </div>
              </div>
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <SectionLabel label="Restart everything" />
              <div className="space-y-2 max-w-3xl">
                <p className="ui-card-meta">
                  The restart-everything action above rebuilds repo packages, restarts the daemon and installed gateway services,
                  and blue/green redeploys the managed web UI. This matches the restart phase of <code>pa update</code>
                  without pulling git changes. When the new slot is live, the active profile gets an unread Inbox item.
                </p>
                {!data.service.installed && (
                  <p className="text-[12px] text-warning">Requires the managed web UI service.</p>
                )}
                {applicationRestartMessage && (
                  <p className="text-[12px] text-secondary">{applicationRestartMessage}</p>
                )}
                {applicationRestartError && (
                  <p className="text-[12px] text-danger">{applicationRestartError}</p>
                )}
              </div>
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <SectionLabel label="Recovery" />
              <div className="space-y-3 max-w-3xl">
                <p className="ui-card-meta">
                  If the latest deployment is unhealthy, roll back traffic to the inactive staged slot. You can also
                  mark the current revision as bad so the next blue/green deploy refuses to restage the same git revision.
                </p>
                <div className="flex flex-wrap gap-3">
                  <ToolbarButton
                    onClick={() => { void handleRollback(); }}
                    disabled={busy || !data.service.installed || !inactiveRelease}
                  >
                    {deploymentAction === 'rollback' ? 'Rolling back…' : 'Rollback to inactive slot'}
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => { void handleMarkBad(); }}
                    disabled={busy || !activeRelease}
                  >
                    {deploymentAction === 'mark-bad' ? 'Marking bad…' : 'Mark active release bad'}
                  </ToolbarButton>
                </div>
                {!inactiveRelease && (
                  <p className="text-[12px] text-warning">Rollback requires an inactive staged release.</p>
                )}
              </div>
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <SectionLabel label="Blue / green releases" />
              <div className="grid gap-x-10 gap-y-6 xl:grid-cols-2">
                <ReleaseBlock
                  label="Active release"
                  release={activeRelease}
                  badRelease={activeReleaseBad}
                  emptyLabel="No active release staged yet."
                />
                <ReleaseBlock
                  label="Inactive release"
                  release={inactiveRelease}
                  badRelease={inactiveReleaseBad}
                  emptyLabel="The inactive slot is empty. The next update will stage it."
                />
              </div>
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <SectionLabel label="Bad release history" />
              <BadReleaseHistory releases={badReleases} />
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <SectionLabel label="Recent log" />
              <LogTailBlock label="Web UI log" log={data.log} />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
