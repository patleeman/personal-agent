import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useSseConnection, useSystemStatus } from '../contexts';
import { buildSystemSearch, getSystemComponentFromSearch, type SystemComponentId } from '../systemSelection';
import type { DaemonState, SyncState, WebUiState } from '../types';
import { timeAgo } from '../utils';
import { buildWebUiCompanionAccessSummary } from '../webUiCompanion';
import { ListLinkRow, LoadingState, PageHeader, PageHeading, Pill, ToolbarButton, type PillTone } from '../components/ui';

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

export function SystemPage() {
  const location = useLocation();
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
        : 'Run `pa restart --rebuild`? This rebuilds packages, restarts background services, and redeploys the managed web UI.'
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

  const selectedComponent = getSystemComponentFromSearch(location.search);
  const canManageApplication = webUi?.service.installed ?? false;
  const attentionItems = items.filter((item) => ['issue', 'offline', 'unavailable'].includes(item.state) && item.attention);
  const attentionCount = attentionItems.length;
  const disabledCount = items.filter((item) => item.state === 'disabled').length;
  const allReady = items.every((item) => item.state !== 'loading');

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        className="flex-wrap items-start gap-y-3"
        actions={(
          <>
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
          </>
        )}
      >
        <PageHeading
          title="System"
          meta={(
            <>
              3 services
              {!allReady
                ? <span className="ml-2 text-secondary">· loading latest state</span>
                : attentionCount > 0
                  ? <span className="ml-2 text-warning">· {attentionCount} issue{attentionCount === 1 ? '' : 's'}</span>
                  : disabledCount > 0
                    ? <span className="ml-2 text-secondary">· {disabledCount} disabled</span>
                    : <span className="ml-2 text-success">· all healthy</span>}
              <span className={`ml-2 ${sseStatus === 'open' ? 'text-secondary' : 'text-warning'}`}>
                · live updates {sseStatus === 'open' ? 'via SSE' : 'offline'}
              </span>
            </>
          )}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {!allReady && sseStatus !== 'open' && <LoadingState label="Loading system status…" />}

        <div className="space-y-6 pb-5">
            {(applicationMessage || applicationError || refreshError || !canManageApplication) && (
              <div className="space-y-1">
                {!canManageApplication && webUi && (
                  <p className="text-[12px] text-warning">
                    Global restart actions require the managed web UI service.
                  </p>
                )}
                {applicationMessage && <p className="text-[12px] text-secondary">{applicationMessage}</p>}
                {refreshError && <p className="text-[12px] text-danger">{refreshError}</p>}
                {applicationError && <p className="text-[12px] text-danger">{applicationError}</p>}
              </div>
            )}

            <section className="space-y-2">
              <p className="ui-section-label">Summary</p>
              {attentionItems.length > 0 ? (
                <div className="space-y-1.5">
                  {attentionItems.map((item) => (
                    <p key={item.id} className="ui-card-meta max-w-3xl">
                      <Link to={`/system${buildSystemSearch(location.search, item.id)}`} className="text-accent hover:underline">
                        {item.label}
                      </Link>
                      {' · '}
                      {item.attention}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="ui-card-meta max-w-3xl">
                  Everything looks healthy. Use the right pane for service logs and controls.
                </p>
              )}
            </section>

            <section className="space-y-2 border-t border-border-subtle pt-5">
              <div className="space-y-1">
                <p className="ui-section-label">Services</p>
                <p className="ui-card-meta">One row per service. Use the right pane for logs and controls.</p>
              </div>

              <div className="space-y-px">
                {items.map((item) => (
                  <ListLinkRow
                    key={item.id}
                    to={`/system${buildSystemSearch(location.search, item.id)}`}
                    selected={selectedComponent === item.id}
                    leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${toneDotClass(item.tone)}`} />}
                    trailing={(
                      <span className={`mt-0.5 text-[11px] font-mono ${selectedComponent === item.id ? 'text-accent' : 'text-dim group-hover:text-secondary'}`}>
                        details
                      </span>
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <p className="ui-row-title">{item.label}</p>
                      <Pill tone={item.tone}>{item.state}</Pill>
                    </div>
                    <p className="ui-row-summary">{item.summary}</p>
                    {item.meta && <p className="ui-row-meta break-words">{item.meta}</p>}
                  </ListLinkRow>
                ))}
              </div>
            </section>

            <section className="space-y-2 border-t border-border-subtle pt-5">
              <div className="space-y-1">
                <p className="ui-section-label">Runs</p>
                <p className="ui-card-meta max-w-3xl">
                  Durable background work and recovery review moved to <Link to="/runs" className="text-accent hover:underline">Runs</Link>.
                </p>
              </div>
            </section>
          </div>
      </div>
    </div>
  );
}
