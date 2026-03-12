import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import type { GatewayConversationSummary, GatewayLogTail, GatewayPendingMessageSummary } from '../types';
import { timeAgo } from '../utils';
import { ErrorState, LoadingState, PageHeader, PageHeading, SectionLabel, ToolbarButton } from '../components/ui';

function basenameLabel(path: string, fallback = '—'): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? fallback;
}

function shortPath(path: string | undefined, maxLen = 84): string {
  if (!path || path.trim().length === 0) {
    return '—';
  }

  return path.length > maxLen ? `…${path.slice(-(maxLen - 1))}` : path;
}

function statusToneClass(input: {
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

function AccessList({ label, values, emptyLabel = 'None' }: { label: string; values: string[]; emptyLabel?: string }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="ui-section-label">{label}</p>
      {values.length === 0 ? (
        <p className="ui-card-meta">{emptyLabel}</p>
      ) : (
        <div className="space-y-1">
          {values.map((value) => (
            <p key={value} className="text-[12px] font-mono text-secondary break-all">{value}</p>
          ))}
        </div>
      )}
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

function ConversationRow({
  conversation,
  pendingCount,
  opening,
  onOpen,
}: {
  conversation: GatewayConversationSummary;
  pendingCount: number;
  opening: boolean;
  onOpen: () => void;
}) {
  const dotClass = conversation.sessionMissing
    ? 'bg-danger'
    : pendingCount > 0
      ? 'bg-warning'
      : conversation.workTopic
        ? 'bg-teal'
        : 'bg-border-default/50';

  const title = conversation.workTopic?.topicName ?? conversation.title;
  const summary = conversation.workTopic
    ? `${conversation.title} · forked from ${conversation.workTopic.sourceConversationId}`
    : conversation.sourceWorkTopic
      ? `Forked to ${conversation.sourceWorkTopic.topicName}`
      : conversation.label;

  return (
    <div className="ui-list-row -mx-0 px-0">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="ui-card-title truncate">{title}</p>
            <p className="ui-row-summary">{summary}</p>
            <p className="ui-row-meta flex flex-wrap items-center gap-1.5">
              <span>{conversation.conversationId}</span>
              <span className="opacity-40">·</span>
              <span>{pluralize(conversation.messageCount, 'message')}</span>
              <span className="opacity-40">·</span>
              <span>{timeAgo(conversation.lastActivityAt)}</span>
              {conversation.cwd && (
                <>
                  <span className="opacity-40">·</span>
                  <span>{basenameLabel(conversation.cwd)}</span>
                </>
              )}
              {pendingCount > 0 && (
                <>
                  <span className="opacity-40">·</span>
                  <span className="text-warning">{pluralize(pendingCount, 'pending message')}</span>
                </>
              )}
              {conversation.sessionOverride && (
                <>
                  <span className="opacity-40">·</span>
                  <span>custom binding</span>
                </>
              )}
              {conversation.sessionMissing && (
                <>
                  <span className="opacity-40">·</span>
                  <span className="text-danger">session missing</span>
                </>
              )}
            </p>
            <p className="ui-card-meta mt-1 break-all">{shortPath(conversation.sessionFile)}</p>
          </div>
          <div className="shrink-0">
            <ToolbarButton onClick={onOpen} disabled={conversation.sessionMissing || opening}>
              {opening ? 'Opening…' : 'Open'}
            </ToolbarButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function PendingRow({ pending }: { pending: GatewayPendingMessageSummary }) {
  return (
    <div className="ui-list-row -mx-0 px-0">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${pending.hasMedia ? 'bg-accent' : 'bg-warning'}`} />
      <div className="min-w-0 flex-1">
        <p className="ui-card-title truncate">{pending.preview}</p>
        <p className="ui-row-meta flex flex-wrap items-center gap-1.5">
          <span>{pending.conversationId}</span>
          <span className="opacity-40">·</span>
          <span>{timeAgo(pending.storedAt)}</span>
          {pending.senderLabel && (
            <>
              <span className="opacity-40">·</span>
              <span>{pending.senderLabel}</span>
            </>
          )}
          {pending.hasMedia && (
            <>
              <span className="opacity-40">·</span>
              <span>media</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export function GatewayPage() {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApi(api.gateway);
  const [restarting, setRestarting] = useState(false);
  const [serviceAction, setServiceAction] = useState<'install' | 'start' | 'stop' | 'uninstall' | null>(null);
  const [openingSessionFile, setOpeningSessionFile] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const pendingCountByConversation = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pending of data?.pendingMessages ?? []) {
      counts.set(pending.conversationId, (counts.get(pending.conversationId) ?? 0) + 1);
    }
    return counts;
  }, [data?.pendingMessages]);

  async function handleGatewayServiceAction(action: 'install' | 'start' | 'stop' | 'uninstall') {
    if (serviceAction || restarting || !data) return;

    setServiceAction(action);
    setActionError(null);
    try {
      if (action === 'install') {
        await api.installGatewayService();
      } else if (action === 'start') {
        await api.startGatewayService();
      } else if (action === 'stop') {
        await api.stopGatewayService();
      } else {
        await api.uninstallGatewayService();
      }
      await refetch({ resetLoading: false });
    } catch (serviceError) {
      setActionError(serviceError instanceof Error ? serviceError.message : String(serviceError));
    } finally {
      setServiceAction(null);
    }
  }

  async function handleRestartGateway() {
    if (restarting || serviceAction || !data?.service.installed || !data.service.running) return;

    setRestarting(true);
    setActionError(null);
    try {
      await api.restartGateway();
      await refetch({ resetLoading: false });
    } catch (restartError) {
      setActionError(restartError instanceof Error ? restartError.message : String(restartError));
    } finally {
      setRestarting(false);
    }
  }

  async function handleOpenConversation(sessionFile: string) {
    if (openingSessionFile) return;

    setOpeningSessionFile(sessionFile);
    setActionError(null);
    try {
      const { id } = await api.resumeSession(sessionFile);
      navigate(`/conversations/${id}`);
    } catch (openError) {
      setActionError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setOpeningSessionFile(null);
    }
  }

  const serviceText = data ? serviceStatusText(data.service) : '—';
  const serviceMeta = data
    ? [data.service.platform, data.service.identifier].filter(Boolean).join(' · ')
    : undefined;
  const runningTone = data ? statusToneClass(data.service) : undefined;
  const workTopicCount = data?.conversations.filter((conversation) => Boolean(conversation.workTopic)).length ?? 0;
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
                void handleGatewayServiceAction(data?.service.installed ? 'uninstall' : 'install');
              }}
              disabled={!data || restarting || serviceAction !== null}
            >
              {serviceAction === 'uninstall' ? 'Uninstalling…' : installButtonLabel}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => {
                if (!data?.service.installed) return;
                void handleGatewayServiceAction(data.service.running ? 'stop' : 'start');
              }}
              disabled={!data?.service.installed || restarting || serviceAction !== null}
            >
              {serviceToggleLabel}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { void handleRestartGateway(); }}
              disabled={restarting || serviceAction !== null || !data?.service.installed || !data.service.running}
            >
              {restarting ? 'Restarting…' : 'Restart gateway'}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { void refetch({ resetLoading: false }); }}
              disabled={restarting || serviceAction !== null}
            >
              ↻ Refresh
            </ToolbarButton>
          </>
        )}
      >
        <PageHeading
          title="Gateway"
          meta={data && (
            <>
              Telegram · {serviceText} · {pluralize(data.conversations.length, 'conversation')} · {pluralize(data.pendingMessages.length, 'pending message')}
            </>
          )}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && <LoadingState label="Loading gateway state…" />}
        {!loading && error && <ErrorState message={`Failed to load gateway state: ${error}`} />}

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
                <StatBlock label="Service" value={serviceText} meta={serviceMeta} valueClassName={runningTone} />
                <StatBlock label="Web profile" value={data.currentProfile} meta={`Gateway profile ${data.configuredProfile}`} />
                <StatBlock label="Pending queue" value={String(data.pendingMessages.length)} meta={pluralize(data.pendingMessages.length, 'durable message')} />
                <StatBlock label="Work topics" value={String(workTopicCount)} meta={pluralize(data.conversations.length, 'tracked conversation')} />
                <StatBlock label="Allowlisted chats" value={String(data.access.allowlistChatIds.length)} meta={pluralize(data.access.allowedUserIds.length, 'allowed user')} />
                <StatBlock label="Blocked users" value={String(data.access.blockedUserIds.length)} meta={data.access.tokenConfigured ? 'Token configured' : 'Token missing'} valueClassName={data.access.tokenConfigured ? undefined : 'text-danger'} />
                <StatBlock label="Working directory" value={basenameLabel(data.access.workingDirectory ?? '')} meta={shortPath(data.access.workingDirectory)} />
                <StatBlock
                  label="Pending limit"
                  value={data.access.maxPendingPerChat !== undefined ? String(data.access.maxPendingPerChat) : 'default'}
                  meta={[
                    data.access.toolActivityStream ? 'tool activity on' : 'tool activity off',
                    data.access.clearRecentMessagesOnNew ? 'clear-on-new on' : 'clear-on-new off',
                  ].join(' · ')}
                />
              </div>
            </section>

            <section className="space-y-3 border-t border-border-subtle pt-6">
              <SectionLabel label="Gateway conversations" count={data.conversations.length} />
              {data.conversations.length === 0 ? (
                <p className="ui-card-meta">No Telegram conversation sessions yet.</p>
              ) : (
                <div className="space-y-px">
                  {data.conversations.map((conversation) => (
                    <ConversationRow
                      key={conversation.conversationId}
                      conversation={conversation}
                      pendingCount={pendingCountByConversation.get(conversation.conversationId) ?? 0}
                      opening={openingSessionFile === conversation.sessionFile}
                      onOpen={() => { void handleOpenConversation(conversation.sessionFile); }}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3 border-t border-border-subtle pt-6">
              <SectionLabel label="Pending queue" count={data.pendingMessages.length} />
              {data.pendingMessages.length === 0 ? (
                <p className="ui-card-meta">No durable pending Telegram messages.</p>
              ) : (
                <div className="space-y-px">
                  {data.pendingMessages.map((pending) => (
                    <PendingRow key={pending.id} pending={pending} />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <SectionLabel label="Access" />
              <div className="grid gap-8 lg:grid-cols-3">
                <AccessList label="Allowlisted chats" values={data.access.allowlistChatIds} />
                <AccessList label="Allowed users" values={data.access.allowedUserIds} />
                <AccessList label="Blocked users" values={data.access.blockedUserIds} />
              </div>
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <SectionLabel label="Recent log" />
              <LogTailBlock label="Gateway log" log={data.gatewayLog} />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
