import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSseConnection, useSystemStatus } from '../contexts';
import type { SystemComponentId } from '../systemSelection';
import type { DaemonState, WebUiState } from '../types';
import { timeAgo } from '../utils';
import { buildWebUiCompanionAccessSummary } from '../webUiCompanion';
import { SystemServiceSection } from './SystemContextPanel';
import { SectionLabel, ToolbarButton } from './ui';

type SystemRowState = 'loading' | 'healthy' | 'issue' | 'offline' | 'disabled' | 'unavailable';

type SystemRowItem = {
  id: SystemComponentId;
  label: string;
  state: SystemRowState;
  summary: string;
  meta?: string;
  attention?: string | null;
};

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildWebUiItem(data: WebUiState | null): SystemRowItem {
  if (!data) {
    return {
      id: 'web-ui',
      label: 'Web UI',
      state: 'loading',
      summary: 'Loading service state…',
    };
  }

  const release = data.service.deployment?.activeRelease?.revision
    ?? data.service.deployment?.activeSlot
    ?? 'no active release';
  const companion = buildWebUiCompanionAccessSummary(data.service);
  const warningCount = data.warnings.length;
  const summary = data.service.running
    ? `Listening on ${data.service.url}`
    : data.service.installed
      ? 'Managed service stopped'
      : 'Managed service not installed';

  return {
    id: 'web-ui',
    label: 'Web UI',
    state: warningCount > 0 ? 'issue' : data.service.running ? 'healthy' : 'offline',
    summary,
    meta: [
      `release ${release}`,
      companion.statusLabel === 'https-ready'
        ? 'companion https-ready'
        : companion.statusLabel === 'resolving'
          ? 'companion resolving'
          : 'companion local-only',
      warningCount > 0 ? pluralize(warningCount, 'warning') : '',
    ].filter(Boolean).join(' · '),
    attention: data.warnings[0] ?? (data.service.running ? null : summary),
  };
}

function buildDaemonItem(data: DaemonState | null): SystemRowItem {
  if (!data) {
    return {
      id: 'daemon',
      label: 'Daemon',
      state: 'loading',
      summary: 'Loading runtime state…',
    };
  }

  const queueLabel = `${data.runtime.queueDepth ?? 0}/${data.runtime.maxQueueDepth ?? 0}`;
  const summary = data.runtime.running
    ? `${data.runtime.moduleCount} modules · queue ${queueLabel}`
    : data.service.installed
      ? 'Runtime offline'
      : 'Service not installed';

  return {
    id: 'daemon',
    label: 'Daemon',
    state: data.warnings.length > 0 ? 'issue' : data.runtime.running ? 'healthy' : 'offline',
    summary,
    meta: [
      data.runtime.startedAt ? `started ${timeAgo(data.runtime.startedAt)}` : '',
      data.runtime.pid ? `pid ${data.runtime.pid}` : '',
      data.warnings.length > 0 ? pluralize(data.warnings.length, 'warning') : '',
    ].filter(Boolean).join(' · '),
    attention: data.warnings[0] ?? (data.runtime.running ? null : summary),
  };
}

function buildSystemSectionHref(componentId: SystemComponentId): string {
  switch (componentId) {
    case 'web-ui':
      return '#settings-system-web-ui';
    case 'daemon':
      return '#settings-system-daemon';
  }
}

export function SystemSettingsContent({ componentId: _componentId }: { componentId?: SystemComponentId }) {
  const { status: sseStatus } = useSseConnection();
  const {
    daemon,
    webUi,
    setDaemon,
    setWebUi,
  } = useSystemStatus();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [applicationAction, setApplicationAction] = useState<'restart' | 'update' | null>(null);
  const [applicationMessage, setApplicationMessage] = useState<string | null>(null);
  const [applicationError, setApplicationError] = useState<string | null>(null);
  const actionTimeoutRef = useRef<number | null>(null);
  const restartReconnectRef = useRef<{ sawDisconnect: boolean; baselineRevision: string | null; baselineSlot: string | null } | null>(null);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);

    const errors: string[] = [];
    const recordError = (label: string, error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${label}: ${message}`);
    };

    try {
      await Promise.all([
        api.daemon()
          .then((next) => setDaemon(next))
          .catch((error) => recordError('Daemon', error)),
        api.webUiState()
          .then((next) => setWebUi(next))
          .catch((error) => recordError('Web UI', error)),
      ]);

      if (errors.length > 0) {
        setRefreshError(errors.join(' · '));
      }
    } finally {
      setRefreshing(false);
    }
  }, [setDaemon, setWebUi]);

  function clearActionMonitor() {
    if (actionTimeoutRef.current !== null) {
      window.clearTimeout(actionTimeoutRef.current);
      actionTimeoutRef.current = null;
    }

    restartReconnectRef.current = null;
  }

  function startApplicationMonitor() {
    clearActionMonitor();
    restartReconnectRef.current = {
      sawDisconnect: sseStatus !== 'open',
      baselineRevision: webUi?.service.deployment?.activeRelease?.revision ?? null,
      baselineSlot: webUi?.service.deployment?.activeSlot ?? null,
    };
    actionTimeoutRef.current = window.setTimeout(() => {
      actionTimeoutRef.current = null;
      restartReconnectRef.current = null;
      setApplicationAction(null);
      setApplicationMessage('The requested restart is taking longer than expected. Refresh in a moment to check the new release.');
    }, 300_000);
  }

  useEffect(() => {
    const monitor = restartReconnectRef.current;
    if (!monitor) {
      return;
    }

    if (sseStatus !== 'open') {
      monitor.sawDisconnect = true;
      return;
    }

    const currentRevision = webUi?.service.deployment?.activeRelease?.revision ?? null;
    const currentSlot = webUi?.service.deployment?.activeSlot ?? null;
    const revisionChanged = currentRevision !== null && currentRevision !== monitor.baselineRevision;
    const slotChanged = currentSlot !== null && currentSlot !== monitor.baselineSlot;

    if (!monitor.sawDisconnect && !revisionChanged && !slotChanged) {
      return;
    }

    clearActionMonitor();
    window.location.reload();
  }, [sseStatus, webUi]);

  useEffect(() => () => {
    clearActionMonitor();
  }, []);

  async function handleApplicationAction(action: 'restart' | 'update') {
    if (applicationAction || !webUi?.service.installed) {
      return;
    }

    const confirmed = window.confirm(
      action === 'update'
        ? 'Run `pa update`? This pulls the latest changes, rebuilds packages, restarts background services, and redeploys the managed web UI.'
        : 'Run `pa restart --rebuild`? This rebuilds packages, restarts background services, and redeploys the managed web UI.',
    );
    if (!confirmed) {
      return;
    }

    setApplicationAction(action);
    setApplicationError(null);
    setApplicationMessage(null);

    try {
      const result = action === 'update'
        ? await api.updateApplication()
        : await api.restartApplication();
      setApplicationMessage(`${result.message} This page will reload when the new release is live.`);
      startApplicationMonitor();
    } catch (error) {
      setApplicationAction(null);
      setApplicationError(error instanceof Error ? error.message : String(error));
    }
  }

  const items = useMemo<SystemRowItem[]>(() => [
    buildWebUiItem(webUi),
    buildDaemonItem(daemon),
  ], [daemon, webUi]);

  const canManageApplication = webUi?.service.installed ?? false;
  const attentionItems = items.filter((item) => ['issue', 'offline', 'unavailable'].includes(item.state) && item.attention);
  const attentionCount = attentionItems.length;
  const disabledCount = items.filter((item) => item.state === 'disabled').length;
  const allReady = items.every((item) => item.state !== 'loading');
  const overallStatusLabel = !allReady
    ? 'Loading latest state'
    : attentionCount > 0
      ? `${attentionCount} issue${attentionCount === 1 ? '' : 's'} need attention`
      : disabledCount > 0
        ? `${disabledCount} service${disabledCount === 1 ? '' : 's'} disabled`
        : 'All services healthy';
  const overallStatusDetail = attentionCount > 0
    ? 'Review the affected sections below for warnings, controls, and recent logs.'
    : disabledCount > 0
      ? 'Disabled services stay visible here so operational state is still easy to inspect.'
      : 'Web UI and daemon are both reporting healthy state.';
  const webUiRelease = webUi?.service.deployment?.activeRelease?.revision
    ?? webUi?.service.deployment?.activeSlot
    ?? 'No active release';
  const daemonOverview = daemon
    ? daemon.runtime.running
      ? `${daemon.runtime.moduleCount} modules · queue ${daemon.runtime.queueDepth ?? 0}/${daemon.runtime.maxQueueDepth ?? 0}`
      : daemon.service.installed
        ? 'Runtime offline'
        : 'Service not installed'
    : 'Loading runtime state…';

  const globalMessages = (applicationMessage || applicationError || refreshError || !canManageApplication) ? (
    <div className="space-y-1" aria-live="polite">
      {!canManageApplication && webUi && (
        <p className="text-[12px] text-warning">
          Global restart actions require the managed web UI service.
        </p>
      )}
      {applicationMessage && <p className="text-[12px] text-secondary">{applicationMessage}</p>}
      {refreshError && <p className="text-[12px] text-danger">{refreshError}</p>}
      {applicationError && <p className="text-[12px] text-danger">{applicationError}</p>}
    </div>
  ) : null;

  return (
    <div className="space-y-8">
      <section className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl space-y-2">
            <div className="space-y-1">
              <SectionLabel label="System" />
              <p className="ui-card-title text-[15px]">Operational overview</p>
              <p className="ui-card-meta max-w-3xl">
                Inspect service health, recent logs, remote companion access, and restart controls in one place.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link to="/runs" className="ui-toolbar-button">Open runs</Link>
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
            <ToolbarButton onClick={() => { void refreshAll(); }} disabled={applicationAction !== null || refreshing}>
              {refreshing ? 'Refreshing…' : '↻ Refresh'}
            </ToolbarButton>
          </div>
        </div>

        <div className="grid gap-4 border-t border-border-subtle pt-4 md:grid-cols-2 xl:grid-cols-4 xl:gap-0 xl:divide-x xl:divide-border-subtle xl:pt-5">
          <div className="space-y-1 xl:px-4 xl:first:pl-0 xl:last:pr-0">
            <p className="ui-section-label">Health</p>
            <p className="text-[13px] font-medium text-primary">{overallStatusLabel}</p>
            <p className="ui-card-meta">{overallStatusDetail}</p>
          </div>
          <div className="space-y-1 xl:px-4 xl:first:pl-0 xl:last:pr-0">
            <p className="ui-section-label">Live updates</p>
            <p className="text-[13px] font-medium text-primary">{sseStatus === 'open' ? 'Connected via SSE' : 'Offline'}</p>
            <p className="ui-card-meta">{sseStatus === 'open' ? 'Fresh service state streams into this page automatically.' : 'Use Refresh to fetch the latest service state.'}</p>
          </div>
          <div className="space-y-1 xl:px-4 xl:first:pl-0 xl:last:pr-0">
            <p className="ui-section-label">Web UI release</p>
            <p className="break-all text-[13px] font-medium text-primary">{webUiRelease}</p>
            <p className="ui-card-meta break-all">{webUi?.service.url ?? 'Desktop URL unavailable'}</p>
          </div>
          <div className="space-y-1 xl:px-4 xl:first:pl-0 xl:last:pr-0">
            <p className="ui-section-label">Daemon runtime</p>
            <p className="text-[13px] font-medium text-primary">{daemonOverview}</p>
            <p className="ui-card-meta">Queue depth and loaded module count.</p>
          </div>
        </div>

        <div className="space-y-2 border-t border-border-subtle pt-4">
          {attentionItems.length > 0 ? (
            <div className="space-y-1.5">
              <p className="ui-section-label">Attention</p>
              {attentionItems.map((item) => (
                <p key={item.id} className="ui-card-meta max-w-3xl">
                  <a href={buildSystemSectionHref(item.id)} className="text-accent hover:underline">
                    {item.label}
                  </a>
                  {' · '}
                  {item.attention}
                </p>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              <p className="ui-section-label">Status</p>
              <p className="ui-card-meta max-w-3xl">
                Everything looks healthy. Web UI and daemon controls live inline below.
              </p>
            </div>
          )}

          {globalMessages ? <div className="pt-1">{globalMessages}</div> : null}
        </div>
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <SectionLabel label="Services" />
          <p className="ui-card-meta">Web UI and daemon controls now stay on this page instead of splitting into separate settings subpages.</p>
        </div>

        <div className="space-y-6">
          <SystemServiceSection componentId="web-ui" id="settings-system-web-ui" />
          <SystemServiceSection componentId="daemon" id="settings-system-daemon" />
        </div>
      </section>
    </div>
  );
}
