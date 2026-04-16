import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../client/api';
import { useSystemStatus } from '../contexts';
import { getSystemComponentLabel, type SystemComponentId } from '../navigation/systemSelection';
import type { DaemonState, WebUiState } from '../types';
import { timeAgo } from '../utils';
import { buildWebUiRemoteAccessSummary } from '../webUiRemoteAccess';
import { useApi } from '../hooks';
import { ErrorState, LoadingState, Pill, ToolbarButton, cx, type PillTone } from './ui';

type SystemPanelData =
  | { kind: 'web-ui'; data: WebUiState }
  | { kind: 'daemon'; data: DaemonState };

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

function buildPanel(selected: SystemPanelData) {
  switch (selected.kind) {
    case 'web-ui': {
      const { data } = selected;
      const desktopOwned = data.service.platform === 'desktop';
      const running = data.service.running;
      const release = data.service.deployment?.activeRelease?.revision
        ?? 'Current build unavailable';
      const remoteAccess = buildWebUiRemoteAccessSummary(data.service);

      return {
        title: 'Web UI',
        description: desktopOwned
          ? 'Packaged desktop shell surface and current build metadata.'
          : 'Managed frontend service and current build metadata.',
        tone: systemTone(running, data.warnings.length, data.service.error),
        status: systemLabel(running, data.warnings.length, data.service.error),
        warnings: data.warnings,
        log: data.log,
        details: desktopOwned
          ? [
              { label: 'Surface', value: 'desktop shell' },
              { label: 'Desktop URL', value: data.service.url },
              { label: 'Remote access', value: remoteAccess.detail },
              { label: 'Release', value: release },
            ]
          : [
              { label: 'Service', value: running ? 'running' : data.service.installed ? 'stopped' : 'not installed' },
              { label: 'Local URL', value: `${remoteAccess.statusLabel} · ${remoteAccess.localUrl}` },
              { label: 'Tailnet URL', value: remoteAccess.tailnetUrl ?? 'Enable Tailscale Serve to expose the web UI over HTTPS.' },
              { label: 'Release', value: release },
            ],
        emptyLogLabel: desktopOwned ? 'No recent desktop shell log lines.' : 'No recent web UI log lines.',
      };
    }
    case 'daemon': {
      const { data } = selected;
      const desktopOwned = data.service.platform === 'desktop';
      const running = data.runtime.running;

      return {
        title: 'Daemon',
        description: desktopOwned
          ? 'Desktop-owned background runtime for scheduled work, runs, and automation.'
          : 'Background runtime for scheduled work, runs, and automation.',
        tone: systemTone(running, data.warnings.length, data.service.error),
        status: systemLabel(running, data.warnings.length, data.service.error),
        warnings: data.warnings,
        log: data.log,
        details: [
          { label: 'Service', value: desktopOwned ? 'desktop-owned' : data.service.running ? 'running' : data.service.installed ? 'stopped' : 'not installed' },
          { label: 'Runtime', value: running ? 'connected' : 'offline' },
          { label: 'Queue', value: `${data.runtime.queueDepth ?? 0}/${data.runtime.maxQueueDepth ?? 0}` },
          { label: 'Modules', value: String(data.runtime.moduleCount) },
          { label: 'Started', value: data.runtime.startedAt ? timeAgo(data.runtime.startedAt) : '—' },
        ],
        emptyLogLabel: 'No recent daemon log lines.',
      };
    }
  }
}

function RemotePairingSection({ data }: { data: WebUiState }) {
  const remoteAccess = buildWebUiRemoteAccessSummary(data.service);
  const { data: authState, loading, error, refetch } = useApi(api.remoteAccessState, 'system-remote-auth');
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
      const created = await api.createRemoteAccessPairingCode();
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
      await api.revokeRemoteAccessSession(sessionId);
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
        <p className="text-[12px] leading-relaxed text-secondary">Generate a short-lived pairing code here, or run <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-primary">pa ui pairing-code</code>, then enter it in a remote browser session to mint a revocable login.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarButton onClick={() => { void createPairingCode(); }} disabled={pairingBusy}>
          {pairingBusy ? 'Generating…' : 'Generate pairing code'}
        </ToolbarButton>
        <a href={remoteAccess.localUrl} target="_blank" rel="noreferrer" className="ui-toolbar-button">
          Open local web UI
        </a>
        {remoteAccess.tailnetUrl && (
          <a href={remoteAccess.tailnetUrl} target="_blank" rel="noreferrer" className="ui-toolbar-button">
            Open tailnet web UI
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
                  <p className="mt-1 text-[11px] text-secondary">Remote browser · Last used {timeAgo(session.lastUsedAt)} · expires {new Date(session.expiresAt).toLocaleString()}</p>
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
    webUi,
    setDaemon,
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
    }
  }, [componentId, daemon, webUi]);

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
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setRefreshing(false);
    }
  }, [componentId, refreshing, setDaemon, setWebUi]);

  const handleToggleWebUiTailscale = useCallback(async () => {
    if (actionBusy || !selected || selected.kind !== 'web-ui' || selected.data.service.platform === 'desktop') {
      return;
    }

    setActionBusy(true);
    setMessage(null);
    setError(null);

    try {
      const nextState = await api.setWebUiConfig({ useTailscaleServe: !selected.data.service.tailscaleServe });
      setWebUi(nextState);
      setMessage(nextState.service.tailscaleServe
        ? 'Enabled Tailscale Serve for the web UI. Use the Tailnet URL for remote browser access.'
        : 'Disabled Tailscale Serve for the web UI. Remote browser access is back to local-only mode.');
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
      <section id={id} className="scroll-mt-6 border-t border-border-subtle pt-6">
        <LoadingState label={loadingLabel} className="justify-start px-0 py-0" />
      </section>
    );
  }

  const lines = panel.log.lines;
  const remoteAccess = selected.kind === 'web-ui' ? buildWebUiRemoteAccessSummary(selected.data.service) : null;

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
              </div>
            </div>
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

          {selected.kind === 'web-ui' && remoteAccess && selected.data.service.platform !== 'desktop' && (
            <>
              <div className="space-y-3 border-t border-border-subtle pt-4">
                <div className="space-y-1">
                  <p className="ui-section-label">Remote browser access</p>
                  <p className="text-[12px] leading-relaxed text-secondary">{remoteAccess.detail}</p>
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
              <RemotePairingSection data={selected.data} />
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
        'scroll-mt-6 border-t border-border-subtle pt-6',
        highlighted && 'border-accent/35',
      )}
    >
      <div className="space-y-4">
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
            </div>
          </div>
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

        {selected.kind === 'web-ui' && remoteAccess && selected.data.service.platform !== 'desktop' && (
          <>
            <div className="space-y-3 border-t border-border-subtle pt-4">
              <div className="space-y-1">
                <p className="ui-section-label">Remote browser access</p>
                <p className="text-[12px] leading-relaxed text-secondary">{remoteAccess.detail}</p>
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
            <RemotePairingSection data={selected.data} />
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
