import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useSystemStatus } from '../contexts';
import { getSystemComponentLabel, type SystemComponentId } from '../systemSelection';
import type { DaemonState, GatewayState, SyncState, WebUiState } from '../types';
import { timeAgo } from '../utils';
import { ErrorState, LoadingState, Pill, ToolbarButton, type PillTone } from './ui';

type SystemPanelData =
  | { kind: 'web-ui'; data: WebUiState }
  | { kind: 'daemon'; data: DaemonState }
  | { kind: 'gateway'; data: GatewayState }
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
    return 'attention';
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
    return 'attention';
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
          { label: 'URL', value: data.service.url },
          { label: 'Release', value: release },
          { label: 'Tailscale', value: data.service.tailscaleServe ? (data.service.tailscaleUrl ?? 'enabled') : 'disabled' },
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
    case 'gateway': {
      const { data } = selected;
      const running = data.service.running;

      return {
        title: 'Gateway',
        description: 'Telegram bridge, tracked conversations, and queued message delivery.',
        tone: systemTone(running, data.warnings.length, data.service.error),
        status: systemLabel(running, data.warnings.length, data.service.error),
        warnings: data.warnings,
        log: data.gatewayLog,
        actionLabel: 'Restart gateway',
        actionDisabled: !data.service.installed || !data.service.running,
        actionDisabledReason: !data.service.installed
          ? 'Install the gateway service before restarting it.'
          : !data.service.running
            ? 'Start the gateway service before restarting it.'
            : null,
        details: [
          { label: 'Service', value: data.service.running ? 'running' : data.service.installed ? 'stopped' : 'not installed' },
          { label: 'Profile', value: data.currentProfile },
          { label: 'Queue', value: `${data.pendingMessages.length} pending` },
          { label: 'Chats', value: `${data.conversations.length} tracked` },
          { label: 'Allowlist', value: `${data.access.allowlistChatIds.length} chat${data.access.allowlistChatIds.length === 1 ? '' : 's'}` },
        ],
        emptyLogLabel: 'No recent gateway log lines.',
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

export function SystemContextPanel({ componentId }: { componentId: SystemComponentId }) {
  const {
    daemon,
    gateway,
    sync,
    webUi,
    setDaemon,
    setGateway,
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
      case 'gateway':
        return gateway ? { kind: 'gateway', data: gateway } : null;
      case 'sync':
        return sync ? { kind: 'sync', data: sync } : null;
    }
  }, [componentId, daemon, gateway, sync, webUi]);

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
        case 'gateway':
          setGateway(await api.gateway());
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
  }, [componentId, refreshing, setDaemon, setGateway, setSync, setWebUi]);

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
        case 'gateway': {
          setGateway(await api.restartGateway());
          setMessage('Requested a gateway restart.');
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
  }, [actionBusy, selected, setDaemon, setGateway, setSync]);

  if (!selected || !panel) {
    return <LoadingState label={`Loading ${getSystemComponentLabel(componentId).toLowerCase()}…`} className="px-4 py-4" />;
  }

  const lines = panel.log.lines;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 py-4 space-y-4">
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
          {message && <p className="text-[12px] text-secondary">{message}</p>}
          {error && <ErrorState message={error} />}
        </div>

        {panel.warnings.length > 0 && (
          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Attention</p>
            <div className="space-y-1.5">
              {panel.warnings.map((warning) => (
                <p key={warning} className="text-[12px] text-warning leading-relaxed">{warning}</p>
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
      </div>

      <div className="min-h-0 flex-1 border-t border-border-subtle px-4 pt-4 pb-4 flex flex-col gap-2">
        <div className="shrink-0 space-y-1">
          <p className="ui-section-label">Recent log</p>
          <p className="text-[10px] font-mono text-dim break-all">{shortLogLabel(panel.log.path)}</p>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto rounded-lg bg-surface/70 px-3 py-3 text-[11px] leading-relaxed text-secondary whitespace-pre">
          {lines.length > 0 ? lines.join('\n') : panel.emptyLogLabel}
        </pre>
      </div>
    </div>
  );
}
