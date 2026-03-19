import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import type { DaemonState, ExecutionTargetSummary, GatewayLogTail, SyncState, WebUiReleaseSummary } from '../types';
import { timeAgo } from '../utils';
import { EmptyState, ErrorState, LoadingState, PageHeader, PageHeading, SectionLabel, ToolbarButton } from '../components/ui';

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

function serializeTargetMappings(target: ExecutionTargetSummary | null): string {
  if (!target || target.cwdMappings.length === 0) {
    return '';
  }

  return target.cwdMappings.map((mapping) => `${mapping.localPrefix} => ${mapping.remotePrefix}`).join('\n');
}

function parseTargetMappings(input: string): Array<{ localPrefix: string; remotePrefix: string }> {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const [localPrefix, remotePrefix] = line.split(/=>|=/).map((part) => part.trim());
      return localPrefix && remotePrefix ? [{ localPrefix, remotePrefix }] : [];
    });
}

type ComponentAction = 'restart-web-ui' | 'restart-daemon' | 'restart-gateway' | 'run-sync';

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
  actions,
  children,
}: {
  id: string;
  label: string;
  description: string;
  to?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="space-y-4 border-t border-border-subtle pt-6 scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <SectionLabel label={label} />
          <p className="ui-card-meta max-w-3xl">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {to && <Link to={to} className="ui-toolbar-button">Open advanced page</Link>}
        </div>
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
  const executionTargets = useApi(api.executionTargets);
  const [showTargetEditor, setShowTargetEditor] = useState(false);
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [targetDraft, setTargetDraft] = useState({
    id: '',
    label: '',
    description: '',
    sshDestination: '',
    sshCommand: '',
    remotePaCommand: '',
    profile: '',
    defaultRemoteCwd: '',
    commandPrefix: '',
    mappingsText: '',
  });
  const [targetMutationBusy, setTargetMutationBusy] = useState(false);
  const [targetMessage, setTargetMessage] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [applicationAction, setApplicationAction] = useState<'restart' | 'update' | null>(null);
  const [applicationMessage, setApplicationMessage] = useState<string | null>(null);
  const [applicationError, setApplicationError] = useState<string | null>(null);
  const [componentAction, setComponentAction] = useState<ComponentAction | null>(null);
  const [componentMessage, setComponentMessage] = useState<string | null>(null);
  const [componentError, setComponentError] = useState<string | null>(null);
  const actionMonitorRef = useRef<number | null>(null);

  const refreshAll = useCallback(async (resetLoading = false) => {
    await Promise.all([
      daemon.refetch({ resetLoading }),
      sync.refetch({ resetLoading }),
      gateway.refetch({ resetLoading }),
      webUi.refetch({ resetLoading }),
      executionTargets.refetch({ resetLoading }),
    ]);
  }, [daemon.refetch, executionTargets.refetch, gateway.refetch, sync.refetch, webUi.refetch]);

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
      if (applicationAction || componentAction) {
        return;
      }
      void refreshAll(false);
    }, 20_000);

    return () => window.clearInterval(id);
  }, [applicationAction, componentAction, refreshAll]);

  const combinedWarnings = useMemo(() => {
    return [
      ...(webUi.data?.warnings ?? []).map((warning) => `Web UI: ${warning}`),
      ...(daemon.data?.warnings ?? []).map((warning) => `Daemon: ${warning}`),
      ...(gateway.data?.warnings ?? []).map((warning) => `Gateway: ${warning}`),
      ...(sync.data?.warnings ?? []).map((warning) => `Sync: ${warning}`),
    ];
  }, [daemon.data?.warnings, gateway.data?.warnings, sync.data?.warnings, webUi.data?.warnings]);

  function resetTargetDraft(target: ExecutionTargetSummary | null = null, options: { open?: boolean } = {}) {
    setEditingTargetId(target?.id ?? null);
    setShowTargetEditor(options.open ?? true);
    setTargetDraft({
      id: target?.id ?? '',
      label: target?.label ?? '',
      description: target?.description ?? '',
      sshDestination: target?.sshDestination ?? '',
      sshCommand: target?.sshCommand ?? '',
      remotePaCommand: target?.remotePaCommand ?? '',
      profile: target?.profile ?? '',
      defaultRemoteCwd: target?.defaultRemoteCwd ?? '',
      commandPrefix: target?.commandPrefix ?? '',
      mappingsText: serializeTargetMappings(target),
    });
    setTargetError(null);
    setTargetMessage(null);
  }

  function hideTargetEditor() {
    resetTargetDraft(null, { open: false });
  }

  async function saveTarget() {
    if (targetMutationBusy) {
      return;
    }

    setTargetMutationBusy(true);
    setTargetError(null);
    setTargetMessage(null);

    try {
      const payload = {
        id: targetDraft.id.trim(),
        label: targetDraft.label.trim(),
        sshDestination: targetDraft.sshDestination.trim(),
        ...(targetDraft.description.trim() ? { description: targetDraft.description.trim() } : {}),
        ...(targetDraft.sshCommand.trim() ? { sshCommand: targetDraft.sshCommand.trim() } : {}),
        ...(targetDraft.remotePaCommand.trim() ? { remotePaCommand: targetDraft.remotePaCommand.trim() } : {}),
        ...(targetDraft.profile.trim() ? { profile: targetDraft.profile.trim() } : {}),
        ...(targetDraft.defaultRemoteCwd.trim() ? { defaultRemoteCwd: targetDraft.defaultRemoteCwd.trim() } : {}),
        ...(targetDraft.commandPrefix.trim() ? { commandPrefix: targetDraft.commandPrefix.trim() } : {}),
        cwdMappings: parseTargetMappings(targetDraft.mappingsText),
      };

      const next = editingTargetId
        ? await api.updateExecutionTarget(editingTargetId, {
            label: payload.label,
            sshDestination: payload.sshDestination,
            description: payload.description,
            sshCommand: payload.sshCommand,
            remotePaCommand: payload.remotePaCommand,
            profile: payload.profile,
            defaultRemoteCwd: payload.defaultRemoteCwd,
            commandPrefix: payload.commandPrefix,
            cwdMappings: payload.cwdMappings,
          })
        : await api.createExecutionTarget(payload);

      executionTargets.replaceData(next);
      hideTargetEditor();
      setTargetMessage(editingTargetId ? 'Execution target updated.' : 'Execution target saved.');
    } catch (error) {
      setTargetError(error instanceof Error ? error.message : String(error));
    } finally {
      setTargetMutationBusy(false);
    }
  }

  async function removeTarget(targetId: string) {
    if (targetMutationBusy) {
      return;
    }

    const confirmed = window.confirm(`Delete execution target ${targetId}?`);
    if (!confirmed) {
      return;
    }

    setTargetMutationBusy(true);
    setTargetError(null);
    setTargetMessage(null);

    try {
      const next = await api.deleteExecutionTarget(targetId);
      executionTargets.replaceData(next);
      if (editingTargetId === targetId) {
        hideTargetEditor();
      }
      setTargetMessage('Execution target deleted.');
    } catch (error) {
      setTargetError(error instanceof Error ? error.message : String(error));
    } finally {
      setTargetMutationBusy(false);
    }
  }

  async function handleApplicationAction(action: 'restart' | 'update') {
    if (applicationAction || componentAction || !webUi.data?.service.installed) {
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
    setComponentError(null);
    setComponentMessage(null);

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

  async function handleComponentAction(action: ComponentAction) {
    if (applicationAction || componentAction) {
      return;
    }

    setComponentAction(action);
    setComponentError(null);
    setComponentMessage(null);
    setApplicationError(null);
    setApplicationMessage(null);

    try {
      if (action === 'restart-web-ui') {
        await api.restartWebUiService();
        setComponentMessage('Requested a managed web UI restart. Status refreshed below.');
      } else if (action === 'restart-daemon') {
        await api.restartDaemonService();
        setComponentMessage('Requested a daemon restart. Status refreshed below.');
      } else if (action === 'restart-gateway') {
        await api.restartGateway();
        setComponentMessage('Requested a gateway restart. Status refreshed below.');
      } else {
        await api.runSync();
        setComponentMessage('Requested an immediate sync run. Status refreshed below.');
      }

      await refreshAll(false);
    } catch (error) {
      setComponentError(error instanceof Error ? error.message : String(error));
    } finally {
      setComponentAction(null);
    }
  }

  const hasAnyData = Boolean(daemon.data || sync.data || gateway.data || webUi.data);
  const canManageApplication = webUi.data?.service.installed ?? false;
  const actionsBusy = applicationAction !== null || componentAction !== null;
  const loadingEverything = !hasAnyData && daemon.loading && sync.loading && gateway.loading && webUi.loading;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={(
          <>
            <ToolbarButton
              onClick={() => { void handleApplicationAction('update'); }}
              disabled={actionsBusy || !canManageApplication}
            >
              {applicationAction === 'update' ? 'Update requested…' : 'Update + restart'}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { void handleApplicationAction('restart'); }}
              disabled={actionsBusy || !canManageApplication}
            >
              {applicationAction === 'restart' ? 'Restart requested…' : 'Restart everything'}
            </ToolbarButton>
            <ToolbarButton onClick={() => { void refreshAll(false); }} disabled={actionsBusy}>↻ Refresh</ToolbarButton>
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
            {(combinedWarnings.length > 0 || applicationMessage || applicationError || componentMessage || componentError || targetMessage || targetError || !canManageApplication) && (
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
                {componentMessage && <p className="text-[12px] text-secondary">{componentMessage}</p>}
                {targetMessage && <p className="text-[12px] text-secondary">{targetMessage}</p>}
                {applicationError && <p className="text-[12px] text-danger">{applicationError}</p>}
                {componentError && <p className="text-[12px] text-danger">{componentError}</p>}
                {targetError && <p className="text-[12px] text-danger">{targetError}</p>}
              </div>
            )}

            <section className="space-y-4">
              <SectionLabel label="Overview" />
              <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-5">
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
                <StatBlock
                  label="Targets"
                  value={executionTargets.data ? String(executionTargets.data.summary.totalTargets) : 'loading…'}
                  meta={executionTargets.data
                    ? `${executionTargets.data.summary.activeRemoteRuns} active remote · ${executionTargets.data.summary.readyImports} ready imports`
                    : undefined}
                  valueClassName={executionTargets.data?.summary.totalTargets ? 'text-primary' : 'text-dim'}
                />
              </div>
            </section>

            <SystemSection
              id="execution-targets"
              label="Execution targets"
              description="Remote kernels stay execution-only. Configure SSH destinations here, see which targets have active remote work, and keep imports conversation-first."
              actions={(
                <ToolbarButton onClick={() => resetTargetDraft(null, { open: true })} disabled={targetMutationBusy}>
                  Add target
                </ToolbarButton>
              )}
            >
              {executionTargets.loading && !executionTargets.data && <LoadingState label="Loading execution targets…" />}
              {!executionTargets.loading && executionTargets.error && !executionTargets.data && <ErrorState message={`Failed to load execution targets: ${executionTargets.error}`} />}
              {executionTargets.data && (
                <div className="space-y-4">
                  <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
                    <StatBlock
                      label="SSH"
                      value={executionTargets.data.sshBinary.available ? 'available' : 'missing'}
                      meta={executionTargets.data.sshBinary.path ?? executionTargets.data.sshBinary.error}
                      valueClassName={executionTargets.data.sshBinary.available ? 'text-success' : 'text-warning'}
                    />
                    <StatBlock
                      label="Configured"
                      value={String(executionTargets.data.summary.totalTargets)}
                      meta={executionTargets.data.summary.totalTargets === 1 ? '1 target' : `${executionTargets.data.summary.totalTargets} targets`}
                    />
                    <StatBlock
                      label="Active remote runs"
                      value={String(executionTargets.data.summary.activeRemoteRuns)}
                      meta="Currently running or recovering"
                    />
                    <StatBlock
                      label="Ready imports"
                      value={String(executionTargets.data.summary.readyImports)}
                      meta="Completed remote runs waiting to be imported"
                    />
                  </div>

                  {executionTargets.data.targets.length === 0 && !showTargetEditor ? (
                    <EmptyState
                      title="No execution targets configured"
                      body={(
                        <div className="space-y-2">
                          <p>Prefer letting your local agent handle this? Ask it to run <span className="font-mono text-secondary">pa targets add …</span> or start with <span className="font-mono text-secondary">pa targets help</span>.</p>
                          <p>Use SSH host aliases when possible. Path mappings let a local repo path resolve to a remote checkout path.</p>
                        </div>
                      )}
                      action={<ToolbarButton onClick={() => resetTargetDraft(null, { open: true })} disabled={targetMutationBusy}>Add manually</ToolbarButton>}
                      className="py-8"
                    />
                  ) : (
                    <div className="space-y-4">
                      {executionTargets.data.targets.length > 0 && (
                        <div className="space-y-2.5">
                          {executionTargets.data.targets.map((target) => (
                            <div key={target.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-border-subtle pt-3 first:border-t-0 first:pt-0">
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-primary">{target.label}</p>
                                <p className="ui-card-meta mt-1 break-words">{target.sshDestination}{target.defaultRemoteCwd ? ` · ${target.defaultRemoteCwd}` : ''}</p>
                                {target.description && <p className="mt-1 text-[12px] text-secondary break-words">{target.description}</p>}
                                <p className="mt-1 text-[11px] text-dim">
                                  {target.activeRunCount} active · {target.readyImportCount} ready imports
                                  {target.latestRunAt ? ` · last activity ${timeAgo(target.latestRunAt)}` : ''}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <button type="button" className="ui-toolbar-button" onClick={() => resetTargetDraft(target, { open: true })} disabled={targetMutationBusy}>Edit</button>
                                <button type="button" className="ui-toolbar-button text-danger" onClick={() => { void removeTarget(target.id); }} disabled={targetMutationBusy}>Delete</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {showTargetEditor && (
                        <div className="border-t border-border-subtle pt-4 space-y-3">
                          <div>
                            <p className="ui-section-label">{editingTargetId ? `Edit ${editingTargetId}` : 'Add target'}</p>
                            <p className="ui-card-meta mt-1">Use SSH host aliases when possible. Path mappings let a local repo path resolve to a remote checkout path.</p>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <input value={targetDraft.id} onChange={(event) => setTargetDraft((current) => ({ ...current, id: event.target.value }))} disabled={Boolean(editingTargetId) || targetMutationBusy} placeholder="id" className="rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary outline-none focus:border-accent/60 disabled:opacity-50" />
                            <input value={targetDraft.label} onChange={(event) => setTargetDraft((current) => ({ ...current, label: event.target.value }))} disabled={targetMutationBusy} placeholder="Label" className="rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary outline-none focus:border-accent/60 disabled:opacity-50" />
                            <input value={targetDraft.sshDestination} onChange={(event) => setTargetDraft((current) => ({ ...current, sshDestination: event.target.value }))} disabled={targetMutationBusy} placeholder="SSH destination" className="rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary outline-none focus:border-accent/60 disabled:opacity-50" />
                            <input value={targetDraft.defaultRemoteCwd} onChange={(event) => setTargetDraft((current) => ({ ...current, defaultRemoteCwd: event.target.value }))} disabled={targetMutationBusy} placeholder="Default remote cwd (optional)" className="rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary outline-none focus:border-accent/60 disabled:opacity-50" />
                            <input value={targetDraft.profile} onChange={(event) => setTargetDraft((current) => ({ ...current, profile: event.target.value }))} disabled={targetMutationBusy} placeholder="Remote profile (optional)" className="rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary outline-none focus:border-accent/60 disabled:opacity-50" />
                            <input value={targetDraft.remotePaCommand} onChange={(event) => setTargetDraft((current) => ({ ...current, remotePaCommand: event.target.value }))} disabled={targetMutationBusy} placeholder="Remote pa command (optional)" className="rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary outline-none focus:border-accent/60 disabled:opacity-50" />
                          </div>
                          <input value={targetDraft.description} onChange={(event) => setTargetDraft((current) => ({ ...current, description: event.target.value }))} disabled={targetMutationBusy} placeholder="Description (optional)" className="w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary outline-none focus:border-accent/60 disabled:opacity-50" />
                          <input value={targetDraft.commandPrefix} onChange={(event) => setTargetDraft((current) => ({ ...current, commandPrefix: event.target.value }))} disabled={targetMutationBusy} placeholder="Command prefix (optional)" className="w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary outline-none focus:border-accent/60 disabled:opacity-50" />
                          <textarea value={targetDraft.mappingsText} onChange={(event) => setTargetDraft((current) => ({ ...current, mappingsText: event.target.value }))} disabled={targetMutationBusy} placeholder="/local/path => /remote/path" rows={4} className="w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary outline-none focus:border-accent/60 disabled:opacity-50" />
                          <div className="flex flex-wrap items-center gap-2">
                            <ToolbarButton onClick={() => { void saveTarget(); }} disabled={targetMutationBusy}>{targetMutationBusy ? 'Saving…' : 'Save target'}</ToolbarButton>
                            <ToolbarButton onClick={hideTargetEditor} disabled={targetMutationBusy}>Cancel</ToolbarButton>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </SystemSection>

            <SystemSection
              id="web-ui"
              label="Web UI"
              description="Managed service state, live release, and recent logs. Use the advanced page for install/start/stop, tailscale, rollback, and bad-release controls."
              to="/web-ui"
              actions={(
                <ToolbarButton
                  onClick={() => { void handleComponentAction('restart-web-ui'); }}
                  disabled={actionsBusy || !webUi.data?.service.installed || !webUi.data.service.running}
                >
                  {componentAction === 'restart-web-ui' ? 'Restarting…' : 'Restart web UI'}
                </ToolbarButton>
              )}
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
              actions={(
                <ToolbarButton
                  onClick={() => { void handleComponentAction('restart-daemon'); }}
                  disabled={actionsBusy || !daemon.data?.service.installed || !daemon.data.service.running}
                >
                  {componentAction === 'restart-daemon' ? 'Restarting…' : 'Restart daemon'}
                </ToolbarButton>
              )}
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
              actions={(
                <ToolbarButton
                  onClick={() => { void handleComponentAction('restart-gateway'); }}
                  disabled={actionsBusy || !gateway.data?.service.installed || !gateway.data.service.running}
                >
                  {componentAction === 'restart-gateway' ? 'Restarting…' : 'Restart gateway'}
                </ToolbarButton>
              )}
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
              actions={(
                <ToolbarButton
                  onClick={() => { void handleComponentAction('run-sync'); }}
                  disabled={actionsBusy || !sync.data?.daemon.connected || !sync.data.git.hasRepo}
                >
                  {componentAction === 'run-sync' ? 'Running sync…' : 'Run sync now'}
                </ToolbarButton>
              )}
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
