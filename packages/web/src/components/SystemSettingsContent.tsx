import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSseConnection, useSystemStatus } from '../contexts';
import type { SystemComponentId } from '../systemSelection';
import type { DaemonState, SyncState, WebUiState } from '../types';
import { timeAgo } from '../utils';
import { buildWebUiCompanionAccessSummary } from '../webUiCompanion';
import { buildSettingsHref } from './SettingsLayout';
import { SystemServiceSection } from './SystemContextPanel';
import { Pill, SectionLabel, ToolbarButton, cx, type PillTone } from './ui';

type SystemRowState = 'loading' | 'healthy' | 'issue' | 'offline' | 'disabled' | 'unavailable';

type SystemRowItem = {
  id: SystemComponentId;
  label: string;
  state: SystemRowState;
  tone: PillTone;
  summary: string;
  meta?: string;
  attention?: string | null;
};

function toneDotClass(tone: PillTone): string {
  switch (tone) {
    case 'success':
      return 'bg-success';
    case 'warning':
      return 'bg-warning';
    case 'danger':
      return 'bg-danger';
    default:
      return 'bg-border-default';
  }
}

function serviceCardClass(tone: PillTone): string {
  switch (tone) {
    case 'success':
      return 'border-success/15 hover:border-success/35';
    case 'warning':
      return 'border-warning/20 hover:border-warning/40';
    case 'danger':
      return 'border-danger/20 hover:border-danger/40';
    default:
      return 'border-border-subtle hover:border-border-default';
  }
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function describeSyncChanges(sync: SyncState): string {
  const changedFiles = sync.git.dirtyEntries ?? 0;

  if (!sync.git.hasRepo) {
    return 'Sync repo missing';
  }

  if (changedFiles === 0) {
    return 'No local repo changes';
  }

  return `${pluralize(changedFiles, 'local file')} changed in the sync repo`;
}

function buildWebUiItem(data: WebUiState | null): SystemRowItem {
  if (!data) {
    return {
      id: 'web-ui',
      label: 'Web UI',
      state: 'loading',
      tone: 'muted',
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
    tone: warningCount > 0 ? 'warning' : data.service.running ? 'success' : 'muted',
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
      tone: 'muted',
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
    tone: data.warnings.length > 0 ? 'warning' : data.runtime.running ? 'success' : 'muted',
    summary,
    meta: [
      data.runtime.startedAt ? `started ${timeAgo(data.runtime.startedAt)}` : '',
      data.runtime.pid ? `pid ${data.runtime.pid}` : '',
      data.warnings.length > 0 ? pluralize(data.warnings.length, 'warning') : '',
    ].filter(Boolean).join(' · '),
    attention: data.warnings[0] ?? (data.runtime.running ? null : summary),
  };
}

function buildSyncItem(data: SyncState | null): SystemRowItem {
  if (!data) {
    return {
      id: 'sync',
      label: 'Sync',
      state: 'loading',
      tone: 'muted',
      summary: 'Loading sync repo status…',
    };
  }

  const lastSuccess = data.daemon.moduleDetail?.lastSuccessAt ? timeAgo(data.daemon.moduleDetail.lastSuccessAt) : 'never';
  const summary = !data.config.enabled
    ? 'Automatic sync disabled'
    : `${describeSyncChanges(data)} · last success ${lastSuccess}`;
  const syncState: SystemRowState = !data.config.enabled
    ? 'disabled'
    : data.warnings.length > 0 || !data.daemon.connected || !data.git.hasRepo
      ? 'issue'
      : 'healthy';

  return {
    id: 'sync',
    label: 'Sync',
    state: syncState,
    tone: syncState === 'healthy' ? 'success' : syncState === 'disabled' ? 'muted' : 'warning',
    summary,
    meta: [
      data.config.enabled ? `tracking ${data.config.remote}/${data.config.branch}` : '',
      data.warnings.length > 0 ? pluralize(data.warnings.length, 'warning') : '',
    ].filter(Boolean).join(' · '),
    attention: data.warnings[0] ?? (syncState === 'healthy' || syncState === 'disabled' ? null : summary),
  };
}

function buildSystemServiceSettingsHref(componentId: SystemComponentId): string {
  switch (componentId) {
    case 'web-ui':
      return buildSettingsHref('system-web-ui');
    case 'daemon':
      return buildSettingsHref('system-daemon');
    case 'sync':
      return buildSettingsHref('system-sync');
  }
}

function SystemServiceSummaryCard({ item }: { item: SystemRowItem }) {
  return (
    <Link
      to={buildSystemServiceSettingsHref(item.id)}
      className={cx(
        'block rounded-[20px] border bg-base px-4 py-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-base hover:bg-elevated/60',
        serviceCardClass(item.tone),
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${toneDotClass(item.tone)}`} />
          <p className="truncate text-[13px] font-medium text-primary">{item.label}</p>
        </div>
        <Pill tone={item.tone}>{item.state}</Pill>
      </div>
      <p className="mt-3 text-[13px] text-primary">{item.summary}</p>
      {item.meta ? <p className="mt-2 text-[11px] leading-relaxed text-secondary">{item.meta}</p> : null}
    </Link>
  );
}

export function SystemSettingsContent({ componentId }: { componentId?: SystemComponentId }) {
  const { status: sseStatus } = useSseConnection();
  const {
    daemon,
    sync,
    webUi,
    setDaemon,
    setSync,
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
        api.sync()
          .then((next) => setSync(next))
          .catch((error) => recordError('Sync', error)),
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
  }, [setDaemon, setSync, setWebUi]);

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
    buildSyncItem(sync),
  ], [daemon, sync, webUi]);

  const activeItem = componentId ? items.find((item) => item.id === componentId) ?? null : null;
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
    ? 'Open the affected service page from the sidebar to review warnings, controls, and recent logs.'
    : disabledCount > 0
      ? 'Disabled services stay visible here so operational state is still easy to inspect.'
      : 'Web UI, daemon, and sync are all reporting healthy state.';
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
  const syncOverview = sync
    ? !sync.config.enabled
      ? 'Automatic sync disabled'
      : sync.git.hasRepo
        ? `Tracking ${sync.config.remote}/${sync.config.branch}`
        : 'Sync repo missing'
    : 'Loading sync status…';

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

  const relatedViews = (
    <section className="ui-panel-muted px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="ui-section-label">Related Views</p>
          <p className="ui-card-meta max-w-3xl">
            Use Runs for durable background work, Scheduled tasks for unattended automation, Tools for runtime capabilities, and Instructions for loaded policy sources.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/runs" className="ui-toolbar-button">Runs</Link>
          <Link to="/scheduled" className="ui-toolbar-button">Scheduled tasks</Link>
          <Link to="/tools" className="ui-toolbar-button">Tools</Link>
          <Link to="/instructions" className="ui-toolbar-button">Instructions</Link>
        </div>
      </div>
    </section>
  );

  if (componentId && activeItem) {
    return (
      <div className="space-y-5">
        <section className="ui-panel-muted px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-3xl space-y-2">
              <div className="space-y-1">
                <SectionLabel label="System" />
                <div className="flex flex-wrap items-center gap-2">
                  <p className="ui-card-title text-[15px]">{activeItem.label}</p>
                  <Pill tone={activeItem.tone}>{activeItem.state}</Pill>
                </div>
                <p className="ui-card-meta max-w-3xl">{activeItem.summary}</p>
                {activeItem.meta ? <p className="ui-card-meta max-w-3xl">{activeItem.meta}</p> : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link to={buildSettingsHref('system')} className="ui-toolbar-button">System overview</Link>
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
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4 text-[12px] text-secondary">
            <span className={sseStatus === 'open' ? 'text-secondary' : 'text-warning'}>
              live updates {sseStatus === 'open' ? 'via SSE' : 'offline'}
            </span>
            {componentId === 'web-ui' ? (
              <>
                <span>·</span>
                <span className="break-all">release {webUiRelease}</span>
              </>
            ) : null}
          </div>

          {globalMessages ? <div className="mt-4 border-t border-border-subtle pt-4">{globalMessages}</div> : null}
        </section>

        <SystemServiceSection componentId={componentId} highlighted />

        {relatedViews}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="ui-panel-muted px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl space-y-2">
            <div className="space-y-1">
              <SectionLabel label="Overview" />
              <p className="ui-card-title text-[15px]">Operational Overview</p>
              <p className="ui-card-meta max-w-3xl">
                Inspect service health, recent logs, sync state, remote companion access, and restart controls in one place.
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

        <div className="mt-5 grid gap-4 border-t border-border-subtle pt-4 md:grid-cols-2 xl:grid-cols-4 xl:gap-0 xl:divide-x xl:divide-border-subtle xl:pt-5">
          <div className="space-y-1 xl:px-4 xl:first:pl-0 xl:last:pr-0">
            <p className="ui-section-label">Health</p>
            <p className="text-[13px] font-medium text-primary">{overallStatusLabel}</p>
            <p className="ui-card-meta">{overallStatusDetail}</p>
          </div>
          <div className="space-y-1 xl:px-4 xl:first:pl-0 xl:last:pr-0">
            <p className="ui-section-label">Live Updates</p>
            <p className="text-[13px] font-medium text-primary">{sseStatus === 'open' ? 'Connected via SSE' : 'Offline'}</p>
            <p className="ui-card-meta">{sseStatus === 'open' ? 'Fresh service state streams into this page automatically.' : 'Use Refresh to fetch the latest service state.'}</p>
          </div>
          <div className="space-y-1 xl:px-4 xl:first:pl-0 xl:last:pr-0">
            <p className="ui-section-label">Web UI Release</p>
            <p className="break-all text-[13px] font-medium text-primary">{webUiRelease}</p>
            <p className="ui-card-meta break-all">{webUi?.service.url ?? 'Desktop URL unavailable'}</p>
          </div>
          <div className="space-y-1 xl:px-4 xl:first:pl-0 xl:last:pr-0">
            <p className="ui-section-label">Runtime &amp; Sync</p>
            <p className="text-[13px] font-medium text-primary">{daemonOverview}</p>
            <p className="ui-card-meta">{syncOverview}</p>
          </div>
        </div>

        <div className="mt-5 space-y-2 border-t border-border-subtle pt-4">
          {attentionItems.length > 0 ? (
            <div className="space-y-1.5">
              <p className="ui-section-label">Attention</p>
              {attentionItems.map((item) => (
                <p key={item.id} className="ui-card-meta max-w-3xl">
                  <Link to={buildSystemServiceSettingsHref(item.id)} className="text-accent hover:underline">
                    {item.label}
                  </Link>
                  {' · '}
                  {item.attention}
                </p>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              <p className="ui-section-label">Status</p>
              <p className="ui-card-meta max-w-3xl">
                Everything looks healthy. Open a service page from the sidebar for controls, operational details, and recent logs.
              </p>
            </div>
          )}

          {globalMessages ? <div className="pt-1">{globalMessages}</div> : null}
        </div>
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <p className="ui-section-label">Services</p>
          <p className="ui-card-meta">Each service has its own page in the settings rail. Use these cards for a quick status scan.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <SystemServiceSummaryCard key={item.id} item={item} />
          ))}
        </div>
      </section>

      {relatedViews}
    </div>
  );
}
