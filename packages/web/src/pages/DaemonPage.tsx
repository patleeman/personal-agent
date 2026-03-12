import { useState } from 'react';
import { api } from '../api';
import { useApi } from '../hooks';
import type { GatewayLogTail } from '../types';
import { timeAgo } from '../utils';
import { ErrorState, LoadingState, PageHeader, PageHeading, SectionLabel, ToolbarButton } from '../components/ui';

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

function runtimeToneClass(running: boolean, serviceInstalled: boolean): string {
  if (running) return 'text-success';
  if (serviceInstalled) return 'text-warning';
  return 'text-dim';
}

function runtimeText(running: boolean): string {
  return running ? 'connected' : 'offline';
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
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

export function DaemonPage() {
  const { data, loading, error, refetch } = useApi(api.daemon);
  const [serviceAction, setServiceAction] = useState<'install' | 'start' | 'restart' | 'stop' | 'uninstall' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleServiceAction(action: 'install' | 'start' | 'restart' | 'stop' | 'uninstall') {
    if (serviceAction || !data) return;

    setServiceAction(action);
    setActionError(null);
    try {
      if (action === 'install') {
        await api.installDaemonService();
      } else if (action === 'start') {
        await api.startDaemonService();
      } else if (action === 'restart') {
        await api.restartDaemonService();
      } else if (action === 'stop') {
        await api.stopDaemonService();
      } else {
        await api.uninstallDaemonService();
      }
      await refetch({ resetLoading: false });
    } catch (serviceError) {
      setActionError(serviceError instanceof Error ? serviceError.message : String(serviceError));
    } finally {
      setServiceAction(null);
    }
  }

  const serviceText = data ? serviceStatusText(data.service) : '—';
  const serviceMeta = data
    ? [data.service.platform, data.service.identifier].filter(Boolean).join(' · ')
    : undefined;
  const serviceTone = data ? serviceStatusToneClass(data.service) : undefined;
  const daemonRuntimeText = data ? runtimeText(data.runtime.running) : '—';
  const daemonRuntimeTone = data ? runtimeToneClass(data.runtime.running, data.service.installed) : undefined;
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={(
          <>
            <ToolbarButton
              onClick={() => {
                void handleServiceAction(data?.service.installed ? 'uninstall' : 'install');
              }}
              disabled={!data || serviceAction !== null}
            >
              {serviceAction === 'uninstall' ? 'Uninstalling…' : installButtonLabel}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => {
                if (!data?.service.installed) return;
                void handleServiceAction(data.service.running ? 'stop' : 'start');
              }}
              disabled={!data?.service.installed || serviceAction !== null}
            >
              {serviceToggleLabel}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { void handleServiceAction('restart'); }}
              disabled={serviceAction !== null || !data?.service.installed || !data.service.running}
            >
              {serviceAction === 'restart' ? 'Restarting…' : 'Restart daemon'}
            </ToolbarButton>
            <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={serviceAction !== null}>↻ Refresh</ToolbarButton>
          </>
        )}
      >
        <PageHeading
          title="Daemon"
          meta={data && (
            <>
              Background automation · {serviceText} · {daemonRuntimeText} · {pluralize(data.runtime.moduleCount, 'module')}
            </>
          )}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && <LoadingState label="Loading daemon state…" />}
        {!loading && error && <ErrorState message={`Failed to load daemon state: ${error}`} />}

        {data && (
          <div className="space-y-8">
            {(data.warnings.length > 0 || actionError) && (
              <div className="space-y-1">
                {data.warnings.map((warning) => (
                  <p key={warning} className="text-[12px] text-warning">{warning}</p>
                ))}
                {actionError && <p className="text-[12px] text-danger">{actionError}</p>}
              </div>
            )}

            <section className="space-y-4">
              <SectionLabel label="Overview" />
              <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
                <StatBlock label="Managed service" value={serviceText} meta={serviceMeta} valueClassName={serviceTone} />
                <StatBlock label="Runtime" value={daemonRuntimeText} meta={shortPath(data.runtime.socketPath)} valueClassName={daemonRuntimeTone} />
                <StatBlock
                  label="PID"
                  value={data.runtime.pid !== undefined ? String(data.runtime.pid) : '—'}
                  meta={data.runtime.startedAt ? `started ${timeAgo(data.runtime.startedAt)}` : 'No live daemon process detected'}
                />
                <StatBlock
                  label="Modules"
                  value={String(data.runtime.moduleCount)}
                  meta={data.runtime.running
                    ? `queue ${(data.runtime.queueDepth ?? 0)}/${data.runtime.maxQueueDepth ?? 0}`
                    : 'Daemon is offline'}
                />
              </div>
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <SectionLabel label="Recent log" />
              <LogTailBlock label="Daemon log" log={data.log} />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
