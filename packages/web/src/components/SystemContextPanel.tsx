import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useSystemStatus } from '../contexts';
import { getSystemComponentLabel, type SystemComponentId } from '../systemSelection';
import type { DaemonState, SyncState, WebUiState } from '../types';
import { timeAgo } from '../utils';
import { buildWebUiCompanionAccessSummary } from '../webUiCompanion';
import { useApi } from '../hooks';
import { ErrorState, LoadingState, Pill, ToolbarButton, cx, type PillTone } from './ui';

type SystemPanelData =
  | { kind: 'web-ui'; data: WebUiState }
  | { kind: 'daemon'; data: DaemonState }
  | { kind: 'sync'; data: SyncState };

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function shortLogLabel(path: string | undefined): string {
  if (!path) {
    return 'No log file reported';
  }

  return path.split('/').slice(-2).join('/');
}

function systemTone(running: boolean, warningCount: number, error?: string): PillTone {
  if (error) {
    return 'danger';
  }

  if (warningCount > 0) {
    return 'warning';
  }

  return running ? 'success' : 'muted';
}

function systemLabel(running: boolean, warningCount: number, error?: string): string {
  if (error || warningCount > 0) {
    return 'issue';
  }

  return running ? 'healthy' : 'offline';
}

function syncTone(data: SyncState): PillTone {
  if (!data.config.enabled) {
    return 'muted';
  }

  if (data.warnings.length > 0 || !data.daemon.connected || !data.git.hasRepo) {
    return 'warning';
  }

  return 'success';
}

function syncLabel(data: SyncState): string {
  if (!data.config.enabled) {
    return 'disabled';
  }

  if (data.warnings.length > 0 || !data.daemon.connected || !data.git.hasRepo) {
    return 'issue';
  }

  return 'healthy';
}

function describeSyncChanges(data: SyncState): string {
  const changedFiles = data.git.dirtyEntries ?? 0;

  if (!data.git.hasRepo) {
    return 'Sync repo missing';
  }

  if (changedFiles === 0) {
    return 'Working tree clean';
  }

  return `${pluralize(changedFiles, 'file')} changed locally in the sync repo`;
}

function buildPanel(selected: SystemPanelData) {
  switch (selected.kind) {
    case 'web-ui': {
      const { data } = selected;
      const running = data.service.running;
      const release = data.service.deployment?.activeRelease?.revision
        ?? data.service.deployment?.activeSlot
        ?? 'No active release';
      const companion = buildWebUiCompanionAccessSummary(data.service);

      return {
        title: 'Web UI',
        description: 'Managed frontend service and current release slot.',
        tone: systemTone(running, data.warnings.length, data.service.error),
        status: systemLabel(running, data.warnings.length, data.service.error),
        warnings: data.warnings,
        log: data.log,
        actionLabel: 'Restart web UI',
        actionDisabled: !data.service.installed || !data.service.running,
        actionDisabledReason: !data.service.installed
          ? 'Install the managed web UI service before restarting it.'
          : !data.service.running
            ? 'Start the managed web UI service before restarting it.'
            : null,
        details: [
          { label: 'Service', value: running ? 'running' : data.service.installed ? 'stopped' : 'not installed' },
          { label: 'Desktop URL', value: data.service.url },
          { label: 'Companion service', value: `${companion.statusLabel} · ${companion.localUrl}` },
          { label: 'Companion port', value: String(data.service.companionPort) },
          { label: 'Tailnet desktop', value: data.service.tailscaleServe ? (data.service.tailscaleUrl ?? 'resolving…') : 'disabled' },
          { label: 'Tailnet companion', value: companion.tailnetUrl ?? 'Enable Tailscale Serve to expose /app over HTTPS.' },
          { label: 'Release', value: release },
        ],
        emptyLogLabel: 'No recent web UI log lines.',
      };
    }
    case 'daemon': {
      const { data } = selected;
      const running = data.runtime.running;

      return {
        title: 'Daemon',
        description: 'Background runtime for scheduled work, runs, and automation.',
        tone: systemTone(running, data.warnings.length, data.service.error),
        status: systemLabel(running, data.warnings.length, data.service.error),
        warnings: data.warnings,
        log: data.log,
        actionLabel: 'Restart daemon',
        actionDisabled: !data.service.installed || !data.service.running,
        actionDisabledReason: !data.service.installed
          ? 'Install the daemon service before restarting it.'
          : !data.service.running
            ? 'Start the daemon service before restarting it.'
            : null,
        details: [
          { label: 'Service', value: data.service.running ? 'running' : data.service.installed ? 'stopped' : 'not installed' },
          { label: 'Runtime', value: running ? 'connected' : 'offline' },
          { label: 'Queue', value: `${data.runtime.queueDepth ?? 0}/${data.runtime.maxQueueDepth ?? 0}` },
          { label: 'Modules', value: String(data.runtime.moduleCount) },
          { label: 'Started', value: data.runtime.startedAt ? timeAgo(data.runtime.startedAt) : '—' },
        ],
        emptyLogLabel: 'No recent daemon log lines.',
      };
    }
    case 'sync': {
      const { data } = selected;
      const lastSuccess = data.daemon.moduleDetail?.lastSuccessAt
        ? timeAgo(data.daemon.moduleDetail.lastSuccessAt)
        : 'never';

      return {
        title: 'Sync',
        description: 'Git-backed durable-state sync and repo health.',
        tone: syncTone(data),
        status: syncLabel(data),
        warnings: data.warnings,
        log: data.log,
        actionLabel: 'Run sync now',
        actionDisabled: !data.daemon.connected || !data.git.hasRepo,
        actionDisabledReason: !data.daemon.connected
          ? 'The daemon must be connected before sync can run.'
          : !data.git.hasRepo
            ? 'Configure the sync repo before running sync.'
            : null,
        details: [
          { label: 'Mode', value: data.config.enabled ? 'automatic sync enabled' : 'automatic sync disabled' },
          { label: 'Daemon', value: data.daemon.connected ? 'connected' : 'offline' },
          { label: 'Branch', value: `tracking ${data.config.remote}/${data.config.branch}` },
          { label: 'Changes', value: describeSyncChanges(data) },
          { label: 'Meaning', value: 'Local changes here mean files in the sync checkout changed locally. That is not automatically an error.' },
          { label: 'Success', value: `last successful sync ${lastSuccess}` },
        ],
        emptyLogLabel: 'No recent sync log lines.',
      };
    }
  }
}

function CompanionPairingSection({ data }: { data: WebUiState }) {
  const companion = buildWebUiCompanionAccessSummary(data.service);
  const { data: authState, loading, error, refetch } = useApi(api.companionAuthState, 'system-companion-auth');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [revokeBusyId, setRevokeBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const createPairingCode = useCallback(async () => {
    if (pairingBusy) {
      return;
    }

    setPairingBusy(true);
    setActionError(null);
    try {
      const created = await api.createCompanionPairingCode();
      setPairingCode(created.code);
      setPairingExpiresAt(created.expiresAt);
      await refetch({ resetLoading: false });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPairingBusy(false);
    }
  }, [pairingBusy, refetch]);

  const revokeSession = useCallback(async (sessionId: string) => {
    if (revokeBusyId) {
      return;
    }

    setRevokeBusyId(sessionId);
    setActionError(null);
    try {
      await api.revokeCompanionSession(sessionId);
      await refetch({ resetLoading: false });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevokeBusyId(null);
    }
  }, [refetch, revokeBusyId]);

  return (
    <div className="space-y-3 border-t border-border-subtle pt-4">
      <div className="space-y-1">
        <p className="ui-section-label">Remote pairing</p>
        <p className="text-[12px] leading-relaxed text-secondary">Generate a short-lived pairing code here, or run <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-primary">pa ui pairing-code</code>, then enter it on a remote desktop browser or the phone companion to mint a revocable session.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarButton onClick={() => { void createPairingCode(); }} disabled={pairingBusy}>
          {pairingBusy ? 'Generating…' : 'Generate pairing code'}
        </ToolbarButton>
        <a href={companion.localUrl} target="_blank" rel="noreferrer" className="ui-toolbar-button">
          Open local companion
        </a>
        {companion.tailnetUrl && (
          <a href={companion.tailnetUrl} target="_blank" rel="noreferrer" className="ui-toolbar-button">
            Open tailnet companion
          </a>
        )}
      </div>
      {pairingCode && pairingExpiresAt && (
        <div className="rounded-xl border border-border-subtle bg-surface/70 px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dim/70">Active pairing code</p>
          <p className="mt-2 font-mono text-[18px] tracking-[0.22em] text-primary">{pairingCode}</p>
          <p className="mt-2 text-[12px] text-secondary">Expires {new Date(pairingExpiresAt).toLocaleString()}</p>
        </div>
      )}
      <div className="space-y-2">
        <p className="ui-section-label">Paired devices</p>
        {loading ? (
          <LoadingState label="Loading paired devices…" className="justify-start px-0 py-2" />
        ) : authState && authState.sessions.length > 0 ? (
          <div className="space-y-2">
            {authState.sessions.map((session) => (
              <div key={session.id} className="flex items-start justify-between gap-3 rounded-xl border border-border-subtle bg-surface/70 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-primary">{session.deviceLabel}</p>
                  <p className="mt-1 text-[11px] text-secondary">{session.surface === 'desktop' ? 'Desktop' : 'Companion'} · Last used {timeAgo(session.lastUsedAt)} · expires {new Date(session.expiresAt).toLocaleString()}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { void revokeSession(session.id); }}
                  disabled={revokeBusyId === session.id}
                  className="shrink-0 text-[11px] text-danger transition hover:text-danger/70 disabled:opacity-40"
                >
                  {revokeBusyId === session.id ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-secondary">No devices are paired yet.</p>
        )}
        {authState && authState.pendingPairings.length > 0 ? (
          <p className="text-[11px] text-dim">{authState.pendingPairings.length} pairing code{authState.pendingPairings.length === 1 ? '' : 's'} waiting to be used.</p>
        ) : null}
      </div>
      {error ? <ErrorState message={error} /> : null}
      {actionError ? <ErrorState message={actionError} /> : null}
    </div>
  );
}

export function SystemServiceSection({
  componentId,
  variant = 'inline',
  highlighted = false,
  id,
}: {
  componentId: SystemComponentId;
  variant?: 'inline' | 'panel';
  highlighted?: boolean;
  id?: string;
}) {
  const {
    daemon,
    sync,
    webUi,
    setDaemon,
    setSync,
    setWebUi,
  } = useSystemStatus();
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMessage(null);
    setError(null);
  }, [componentId]);

  const selected = useMemo<SystemPanelData | null>(() => {
    switch (componentId) {
      case 'web-ui':
        return webUi ? { kind: 'web-ui', data: webUi } : null;
      case 'daemon':
        return daemon ? { kind: 'daemon', data: daemon } : null;
      case 'sync':
        return sync ? { kind: 'sync', data: sync } : null;
    }
  }, [componentId, daemon, sync, webUi]);

  const panel = useMemo(() => (selected ? buildPanel(selected) : null), [selected]);

  const refreshSelected = useCallback(async () => {
    if (refreshing) {
      return;
    }

    setRefreshing(true);
    setError(null);

    try {
      switch (componentId) {
        case 'web-ui':
          setWebUi(await api.webUiState());
          break;
        case 'daemon':
          setDaemon(await api.daemon());
          break;
        case 'sync':
          setSync(await api.sync());
          break;
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setRefreshing(false);
    }
  }, [componentId, refreshing, setDaemon, setSync, setWebUi]);

  const handleAction = useCallback(async () => {
    if (actionBusy || !selected) {
      return;
    }

    setActionBusy(true);
    setMessage(null);
    setError(null);

    try {
      switch (selected.kind) {
        case 'web-ui': {
          const result = await api.restartWebUiService();
          setMessage(`${result.message} Live updates will push the new state when the service comes back.`);
          break;
        }
        case 'daemon': {
          setDaemon(await api.restartDaemonService());
          setMessage('Requested a daemon restart.');
          break;
        }
        case 'sync': {
          setSync(await api.runSync());
          setMessage('Requested an immediate sync run.');
          break;
        }
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, selected, setDaemon, setSync]);

  const handleToggleWebUiTailscale = useCallback(async () => {
    if (actionBusy || !selected || selected.kind !== 'web-ui') {
      return;
    }

    setActionBusy(true);
    setMessage(null);
    setError(null);

    try {
      const nextState = await api.setWebUiConfig({ useTailscaleServe: !selected.data.service.tailscaleServe });
      setWebUi(nextState);
      setMessage(nextState.service.tailscaleServe
        ? 'Enabled Tailscale Serve for the web UI. Use the Tailnet desktop URL for the full remote UI and the Tailnet companion URL for /app.'
        : 'Disabled Tailscale Serve for the web UI. Desktop and companion access are back to local-only mode.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, selected, setWebUi]);

  const loadingLabel = `Loading ${getSystemComponentLabel(componentId).toLowerCase()}…`;
  if (!selected || !panel) {
    if (variant === 'panel') {
      return <LoadingState label={loadingLabel} className="px-4 py-4" />;
    }

    return (
      <section id={id} className="scroll-mt-6 rounded-[24px] border border-border-subtle bg-surface/35 px-5 py-5">
        <LoadingState label={loadingLabel} className="justify-start px-0 py-0" />
      </section>
    );
  }

  const lines = panel.log.lines;
  const companion = selected.kind === 'web-ui' ? buildWebUiCompanionAccessSummary(selected.data.service) : null;

  if (variant === 'panel') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 space-y-4 px-4 py-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="ui-card-title">{panel.title}</p>
                  <Pill tone={panel.tone}>{panel.status}</Pill>
                </div>
                <p className="ui-card-meta max-w-sm">{panel.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ToolbarButton onClick={() => { void refreshSelected(); }} disabled={refreshing || actionBusy}>
                  {refreshing ? 'Refreshing…' : '↻ Refresh'}
                </ToolbarButton>
                <ToolbarButton onClick={() => { void handleAction(); }} disabled={actionBusy || panel.actionDisabled}>
                  {actionBusy ? 'Working…' : panel.actionLabel}
                </ToolbarButton>
              </div>
            </div>

            {panel.actionDisabledReason && (
              <p className="ui-card-meta">{panel.actionDisabledReason}</p>
            )}
            <div aria-live="polite" className="space-y-1">
              {message && <p className="text-[12px] text-secondary">{message}</p>}
              {error && <ErrorState message={error} />}
            </div>
          </div>

          {panel.warnings.length > 0 && (
            <div className="space-y-2 border-t border-border-subtle pt-4">
              <p className="ui-section-label">Warnings</p>
              <div className="space-y-1.5">
                {panel.warnings.map((warning) => (
                  <p key={warning} className="text-[12px] leading-relaxed text-warning">{warning}</p>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Details</p>
            <div className="ui-detail-list">
              {panel.details.map((detailRow) => (
                <div key={detailRow.label} className="ui-detail-row">
                  <span className="ui-detail-label">{detailRow.label}</span>
                  <span className="ui-detail-value break-all">{detailRow.value}</span>
                </div>
              ))}
            </div>
          </div>

          {selected.kind === 'web-ui' && companion && (
            <>
              <div className="space-y-3 border-t border-border-subtle pt-4">
                <div className="space-y-1">
                  <p className="ui-section-label">Companion transport</p>
                  <p className="text-[12px] leading-relaxed text-secondary">{companion.detail}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ToolbarButton onClick={() => { void handleToggleWebUiTailscale(); }} disabled={actionBusy}>
                    {selected.data.service.tailscaleServe ? 'Disable Tailnet HTTPS' : 'Enable Tailnet HTTPS'}
                  </ToolbarButton>
                  {selected.data.service.tailscaleUrl && (
                    <a href={selected.data.service.tailscaleUrl} target="_blank" rel="noreferrer" className="ui-toolbar-button">
                      Open tailnet desktop
                    </a>
                  )}
                </div>
              </div>
              <CompanionPairingSection data={selected.data} />
            </>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 border-t border-border-subtle px-4 pb-4 pt-4">
          <div className="shrink-0 space-y-1">
            <p className="ui-section-label">Log</p>
            <p className="break-all text-[10px] font-mono text-dim">{shortLogLabel(panel.log.path)}</p>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto rounded-lg bg-surface/70 px-3 py-3 text-[11px] leading-relaxed whitespace-pre text-secondary">
            {lines.length > 0 ? lines.join('\n') : panel.emptyLogLabel}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <section
      id={id}
      className={cx(
        'scroll-mt-6 rounded-[24px] border border-border-subtle bg-surface/35',
        highlighted && 'border-accent/35 ring-1 ring-accent/20',
      )}
    >
      <div className="space-y-4 px-5 py-5">
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="ui-card-title">{panel.title}</p>
                <Pill tone={panel.tone}>{panel.status}</Pill>
              </div>
              <p className="ui-card-meta max-w-3xl">{panel.description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToolbarButton onClick={() => { void refreshSelected(); }} disabled={refreshing || actionBusy}>
                {refreshing ? 'Refreshing…' : '↻ Refresh'}
              </ToolbarButton>
              <ToolbarButton onClick={() => { void handleAction(); }} disabled={actionBusy || panel.actionDisabled}>
                {actionBusy ? 'Working…' : panel.actionLabel}
              </ToolbarButton>
            </div>
          </div>

          {panel.actionDisabledReason && <p className="ui-card-meta">{panel.actionDisabledReason}</p>}
          <div aria-live="polite" className="space-y-1">
            {message && <p className="text-[12px] text-secondary">{message}</p>}
            {error && <ErrorState message={error} />}
          </div>
        </div>

        {panel.warnings.length > 0 && (
          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Warnings</p>
            <div className="space-y-1.5">
              {panel.warnings.map((warning) => (
                <p key={warning} className="text-[12px] leading-relaxed text-warning">{warning}</p>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Details</p>
          <div className="ui-detail-list">
            {panel.details.map((detailRow) => (
              <div key={detailRow.label} className="ui-detail-row">
                <span className="ui-detail-label">{detailRow.label}</span>
                <span className="ui-detail-value break-all">{detailRow.value}</span>
              </div>
            ))}
          </div>
        </div>

        {selected.kind === 'web-ui' && companion && (
          <>
            <div className="space-y-3 border-t border-border-subtle pt-4">
              <div className="space-y-1">
                <p className="ui-section-label">Companion transport</p>
                <p className="text-[12px] leading-relaxed text-secondary">{companion.detail}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ToolbarButton onClick={() => { void handleToggleWebUiTailscale(); }} disabled={actionBusy}>
                  {selected.data.service.tailscaleServe ? 'Disable Tailnet HTTPS' : 'Enable Tailnet HTTPS'}
                </ToolbarButton>
                {selected.data.service.tailscaleUrl && (
                  <a href={selected.data.service.tailscaleUrl} target="_blank" rel="noreferrer" className="ui-toolbar-button">
                    Open tailnet desktop
                  </a>
                )}
              </div>
            </div>
            <CompanionPairingSection data={selected.data} />
          </>
        )}

        <div className="space-y-2 border-t border-border-subtle pt-4">
          <div className="space-y-1">
            <p className="ui-section-label">Log</p>
            <p className="break-all text-[10px] font-mono text-dim">{shortLogLabel(panel.log.path)}</p>
          </div>
          <pre className="max-h-[24rem] overflow-auto rounded-lg bg-base/80 px-3 py-3 text-[11px] leading-relaxed whitespace-pre text-secondary">
            {lines.length > 0 ? lines.join('\n') : panel.emptyLogLabel}
          </pre>
        </div>
      </div>
    </section>
  );
}

export function SystemContextPanel({ componentId }: { componentId: SystemComponentId }) {
  return <SystemServiceSection componentId={componentId} variant="panel" />;
}
