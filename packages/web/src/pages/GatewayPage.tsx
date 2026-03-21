import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { useInvalidateOnTopics } from '../hooks/useInvalidateOnTopics';
import type {
  GatewayAccessSummary,
  GatewayConfigUpdateInput,
  GatewayConversationSummary,
  GatewayLogTail,
  GatewayPendingMessageSummary,
  GatewayState,
} from '../types';
import { timeAgo } from '../utils';
import { ErrorState, LoadingState, PageHeader, PageHeading, SectionLabel, ToolbarButton } from '../components/ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[120px] resize-y font-mono text-[12px] leading-[1.6]`;
const CHECKBOX_CLASS = 'h-4 w-4 rounded border-border-default bg-base text-accent focus:ring-0 focus:outline-none';

interface GatewayConfigDraft {
  profile: string;
  defaultModel: string;
  token: string;
  clearToken: boolean;
  allowlistText: string;
  allowedUsersText: string;
  blockedUsersText: string;
  workingDirectory: string;
  maxPendingPerChat: string;
  toolActivityStream: boolean;
  clearRecentMessagesOnNew: boolean;
}

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

function formatListInput(values: string[]): string {
  return values.join('\n');
}

function parseListInput(value: string): string[] {
  const normalized: string[] = [];

  for (const part of value.split(/[\n,]/)) {
    const trimmed = part.trim();
    if (!trimmed || normalized.includes(trimmed)) {
      continue;
    }

    normalized.push(trimmed);
  }

  return normalized;
}

function buildConfigDraft(data: GatewayState): GatewayConfigDraft {
  return {
    profile: data.configuredProfile,
    defaultModel: data.access.defaultModel ?? '',
    token: data.access.tokenSource === 'one-password' ? data.access.tokenPreview ?? '' : '',
    clearToken: false,
    allowlistText: formatListInput(data.access.allowlistChatIds),
    allowedUsersText: formatListInput(data.access.allowedUserIds),
    blockedUsersText: formatListInput(data.access.blockedUserIds),
    workingDirectory: data.access.workingDirectory ?? '',
    maxPendingPerChat: data.access.maxPendingPerChat !== undefined ? String(data.access.maxPendingPerChat) : '',
    toolActivityStream: data.access.toolActivityStream ?? false,
    clearRecentMessagesOnNew: data.access.clearRecentMessagesOnNew ?? true,
  };
}

function draftsEqual(left: GatewayConfigDraft | null, right: GatewayConfigDraft | null): boolean {
  if (!left || !right) {
    return left === right;
  }

  return left.profile === right.profile
    && left.defaultModel === right.defaultModel
    && left.token === right.token
    && left.clearToken === right.clearToken
    && left.allowlistText === right.allowlistText
    && left.allowedUsersText === right.allowedUsersText
    && left.blockedUsersText === right.blockedUsersText
    && left.workingDirectory === right.workingDirectory
    && left.maxPendingPerChat === right.maxPendingPerChat
    && left.toolActivityStream === right.toolActivityStream
    && left.clearRecentMessagesOnNew === right.clearRecentMessagesOnNew;
}

function tokenStatusLabel(access: GatewayAccessSummary, clearToken: boolean): string {
  if (clearToken) {
    return 'Saved token will be removed when you save.';
  }

  if (access.tokenSource === 'one-password') {
    return access.tokenPreview
      ? `Saved as a 1Password reference: ${access.tokenPreview}`
      : 'Saved as a 1Password reference.';
  }

  if (access.tokenSource === 'plain') {
    return access.tokenPreview
      ? `A plain token is saved (${access.tokenPreview}). Leave the field blank to keep it, or enter a new token or op:// reference.`
      : 'A plain token is saved. Leave the field blank to keep it, or enter a new token or op:// reference.';
  }

  return 'No token is saved in gateway.json yet.';
}

function tokenPlaceholder(access: GatewayAccessSummary): string {
  if (access.tokenSource === 'plain') {
    return 'Leave blank to keep the saved token, or paste a new token / op:// reference';
  }

  return 'Telegram bot token or op://Vault/Item/field';
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
            <p key={value} className="break-all font-mono text-[12px] text-secondary">{value}</p>
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
  const { data, loading, error, refetch, replaceData } = useApi(api.gateway);
  const { data: profileState } = useApi(api.profiles);
  const [restarting, setRestarting] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [serviceAction, setServiceAction] = useState<'install' | 'start' | 'stop' | 'uninstall' | null>(null);
  const [openingSessionFile, setOpeningSessionFile] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState<GatewayConfigDraft | null>(null);

  useInvalidateOnTopics(['gateway'], refetch);

  const pendingCountByConversation = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pending of data?.pendingMessages ?? []) {
      counts.set(pending.conversationId, (counts.get(pending.conversationId) ?? 0) + 1);
    }
    return counts;
  }, [data?.pendingMessages]);

  const baseConfigDraft = useMemo(() => (data ? buildConfigDraft(data) : null), [data]);
  const configDirty = useMemo(
    () => !draftsEqual(configDraft, baseConfigDraft),
    [baseConfigDraft, configDraft],
  );

  useEffect(() => {
    if (!baseConfigDraft) {
      return;
    }

    if (configDraft === null || !configDirty) {
      setConfigDraft(baseConfigDraft);
    }
  }, [baseConfigDraft, configDirty, configDraft]);

  const profileOptions = useMemo(() => {
    const values = new Set<string>(profileState?.profiles ?? []);
    if (data?.configuredProfile) values.add(data.configuredProfile);
    if (data?.currentProfile) values.add(data.currentProfile);
    if (configDraft?.profile) values.add(configDraft.profile);
    return [...values].sort((left, right) => left.localeCompare(right));
  }, [configDraft?.profile, data?.configuredProfile, data?.currentProfile, profileState?.profiles]);

  async function handleGatewayServiceAction(action: 'install' | 'start' | 'stop' | 'uninstall') {
    if (serviceAction || restarting || savingConfig || !data) return;

    setServiceAction(action);
    setActionError(null);
    setActionNotice(null);
    try {
      if (action === 'install') {
        replaceData(await api.installGatewayService());
      } else if (action === 'start') {
        replaceData(await api.startGatewayService());
      } else if (action === 'stop') {
        replaceData(await api.stopGatewayService());
      } else {
        replaceData(await api.uninstallGatewayService());
      }
    } catch (serviceError) {
      setActionError(serviceError instanceof Error ? serviceError.message : String(serviceError));
    } finally {
      setServiceAction(null);
    }
  }

  async function handleRestartGateway() {
    if (restarting || serviceAction || savingConfig || !data?.service.installed || !data.service.running) return;

    setRestarting(true);
    setActionError(null);
    setActionNotice(null);
    try {
      replaceData(await api.restartGateway());
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
    setActionNotice(null);
    try {
      const { id } = await api.resumeSession(sessionFile);
      navigate(`/conversations/${id}`);
    } catch (openError) {
      setActionError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setOpeningSessionFile(null);
    }
  }

  function updateConfigDraft(patch: Partial<GatewayConfigDraft>) {
    setConfigDraft((current) => current ? { ...current, ...patch } : current);
    setActionError(null);
    setActionNotice(null);
  }

  function handleResetConfigDraft() {
    if (!baseConfigDraft) {
      return;
    }

    setConfigDraft(baseConfigDraft);
    setActionError(null);
    setActionNotice(null);
  }

  async function handleSaveConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !configDraft || savingConfig || serviceAction || restarting) {
      return;
    }

    const defaultModelRaw = configDraft.defaultModel.trim();
    if (defaultModelRaw.length > 0 && !defaultModelRaw.includes('/')) {
      setActionError('Default model must use format provider/model.');
      return;
    }

    const pendingLimitRaw = configDraft.maxPendingPerChat.trim();
    let maxPendingPerChat: number | null = null;
    if (pendingLimitRaw.length > 0) {
      const parsed = Number.parseInt(pendingLimitRaw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setActionError('Pending limit must be a positive integer.');
        return;
      }
      maxPendingPerChat = parsed;
    }

    const payload: GatewayConfigUpdateInput = {
      profile: configDraft.profile,
      defaultModel: configDraft.defaultModel.trim() || undefined,
      token: configDraft.clearToken ? undefined : (configDraft.token.trim() || undefined),
      clearToken: configDraft.clearToken,
      allowlistChatIds: parseListInput(configDraft.allowlistText),
      allowedUserIds: parseListInput(configDraft.allowedUsersText),
      blockedUserIds: parseListInput(configDraft.blockedUsersText),
      workingDirectory: configDraft.workingDirectory.trim() || null,
      maxPendingPerChat,
      toolActivityStream: configDraft.toolActivityStream,
      clearRecentMessagesOnNew: configDraft.clearRecentMessagesOnNew,
    };

    setSavingConfig(true);
    setActionError(null);
    setActionNotice(null);

    try {
      const savedState = await api.saveGatewayConfig(payload);
      replaceData(savedState);
      setConfigDraft(buildConfigDraft(savedState));
      setActionNotice(
        savedState.service.running
          ? 'Saved gateway settings. Restart the running service to apply them.'
          : 'Saved gateway settings.',
      );
    } catch (saveError) {
      setActionError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingConfig(false);
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
  const tokenMeta = data
    ? data.access.tokenSource === 'one-password'
      ? '1Password reference saved'
      : data.access.tokenConfigured
        ? 'Saved token configured'
        : 'No saved token'
    : undefined;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={(
          <>
            <ToolbarButton
              onClick={() => {
                void handleGatewayServiceAction(data?.service.installed ? 'uninstall' : 'install');
              }}
              disabled={!data || restarting || savingConfig || serviceAction !== null}
            >
              {serviceAction === 'uninstall' ? 'Uninstalling…' : installButtonLabel}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => {
                if (!data?.service.installed) return;
                void handleGatewayServiceAction(data.service.running ? 'stop' : 'start');
              }}
              disabled={!data?.service.installed || restarting || savingConfig || serviceAction !== null}
            >
              {serviceToggleLabel}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { void handleRestartGateway(); }}
              disabled={restarting || savingConfig || serviceAction !== null || !data?.service.installed || !data.service.running}
            >
              {restarting ? 'Restarting…' : 'Restart gateway'}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { void refetch({ resetLoading: false }); }}
              disabled={restarting || savingConfig || serviceAction !== null}
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

        {data && configDraft && (
          <div className="space-y-8">
            {(data.warnings.length > 0 || actionError || actionNotice) && (
              <div className="space-y-1">
                {data.warnings.map((warning) => (
                  <p key={warning} className="text-[12px] text-warning">{warning}</p>
                ))}
                {actionNotice && <p className="text-[12px] text-success">{actionNotice}</p>}
                {actionError && <p className="text-[12px] text-danger">{actionError}</p>}
              </div>
            )}

            <section className="space-y-4">
              <SectionLabel label="Overview" />
              <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
                <StatBlock label="Service" value={serviceText} meta={serviceMeta} valueClassName={runningTone} />
                <StatBlock label="Web profile" value={data.currentProfile} meta={`Saved gateway profile ${data.configuredProfile}`} />
                <StatBlock label="Pending queue" value={String(data.pendingMessages.length)} meta={pluralize(data.pendingMessages.length, 'durable message')} />
                <StatBlock label="Work topics" value={String(workTopicCount)} meta={pluralize(data.conversations.length, 'tracked conversation')} />
                <StatBlock label="Allowlisted chats" value={String(data.access.allowlistChatIds.length)} meta={pluralize(data.access.allowedUserIds.length, 'allowed user')} />
                <StatBlock label="Blocked users" value={String(data.access.blockedUserIds.length)} meta={tokenMeta} valueClassName={data.access.tokenConfigured ? undefined : 'text-danger'} />
                <StatBlock
                  label="Default model"
                  value={data.access.defaultModel ?? 'profile default'}
                  meta="Gateway runs in coordinator mode and delegates substantive work."
                />
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

            <section className="space-y-5 border-t border-border-subtle pt-6">
              <SectionLabel label="Configuration" />

              <div className="space-y-1">
                <p className="text-[15px] font-medium text-primary">Edit saved Telegram gateway settings</p>
                <p className="ui-card-meta max-w-3xl">
                  These fields write to {shortPath(data.configFilePath)}. Token and list fields accept saved values directly, including op:// 1Password references where supported by the gateway. 1Password resolution still depends on the local `op` CLI and its auth context. If the managed gateway service is already running, restart it after saving.
                </p>
              </div>

              <form onSubmit={handleSaveConfig} className="max-w-5xl space-y-5">
                <div className="grid gap-6 lg:grid-cols-3">
                  <div className="space-y-1.5 min-w-0">
                    <label className="ui-card-meta" htmlFor="gateway-profile">Profile</label>
                    <select
                      id="gateway-profile"
                      value={configDraft.profile}
                      onChange={(event) => updateConfigDraft({ profile: event.target.value })}
                      disabled={savingConfig}
                      className={INPUT_CLASS}
                    >
                      {profileOptions.map((profile) => (
                        <option key={profile} value={profile}>{profile}</option>
                      ))}
                    </select>
                    <p className="ui-card-meta">This is the profile the gateway uses.</p>
                  </div>

                  <div className="space-y-1.5 min-w-0">
                    <label className="ui-card-meta" htmlFor="gateway-default-model">Default gateway model</label>
                    <input
                      id="gateway-default-model"
                      value={configDraft.defaultModel}
                      onChange={(event) => updateConfigDraft({ defaultModel: event.target.value })}
                      disabled={savingConfig}
                      className={INPUT_CLASS}
                      placeholder="provider/model (for example openai/gpt-5.4)"
                      spellCheck={false}
                    />
                    <p className="ui-card-meta">Leave blank to fall back to the profile default model.</p>
                  </div>

                  <div className="space-y-1.5 min-w-0">
                    <label className="ui-card-meta" htmlFor="gateway-working-directory">Working directory</label>
                    <input
                      id="gateway-working-directory"
                      value={configDraft.workingDirectory}
                      onChange={(event) => updateConfigDraft({ workingDirectory: event.target.value })}
                      disabled={savingConfig}
                      className={INPUT_CLASS}
                      placeholder="Defaults to the current process cwd if left blank"
                    />
                    <p className="ui-card-meta break-all">Used for delegated runs, /run commands, and attachment exports.</p>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <label className="ui-card-meta" htmlFor="gateway-token">Bot token or 1Password reference</label>
                      {data.access.tokenConfigured && (
                        <button
                          type="button"
                          onClick={() => updateConfigDraft({ token: '', clearToken: true })}
                          className="text-[12px] text-secondary transition-colors hover:text-primary"
                          disabled={savingConfig}
                        >
                          Clear saved token
                        </button>
                      )}
                    </div>
                    <input
                      id="gateway-token"
                      value={configDraft.token}
                      onChange={(event) => updateConfigDraft({ token: event.target.value, clearToken: false })}
                      disabled={savingConfig}
                      className={INPUT_CLASS}
                      placeholder={tokenPlaceholder(data.access)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="ui-card-meta break-all">{tokenStatusLabel(data.access, configDraft.clearToken)}</p>
                  </div>

                  <div className="space-y-1.5 min-w-0">
                    <label className="ui-card-meta" htmlFor="gateway-pending-limit">Max pending per conversation</label>
                    <input
                      id="gateway-pending-limit"
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={configDraft.maxPendingPerChat}
                      onChange={(event) => updateConfigDraft({ maxPendingPerChat: event.target.value })}
                      disabled={savingConfig}
                      className={INPUT_CLASS}
                      placeholder="Use built-in default"
                    />
                    <p className="ui-card-meta">Leave blank to use the gateway default queue limit.</p>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-3">
                  <div className="space-y-1.5 min-w-0">
                    <label className="ui-card-meta" htmlFor="gateway-allowlist">Allowlisted chat IDs</label>
                    <textarea
                      id="gateway-allowlist"
                      value={configDraft.allowlistText}
                      onChange={(event) => updateConfigDraft({ allowlistText: event.target.value })}
                      disabled={savingConfig}
                      className={TEXTAREA_CLASS}
                      placeholder="One chat ID per line or comma-separated"
                      spellCheck={false}
                    />
                    <p className="ui-card-meta">Optional if you already allow individual Telegram user IDs.</p>
                  </div>

                  <div className="space-y-1.5 min-w-0">
                    <label className="ui-card-meta" htmlFor="gateway-allowed-users">Allowed Telegram user IDs</label>
                    <textarea
                      id="gateway-allowed-users"
                      value={configDraft.allowedUsersText}
                      onChange={(event) => updateConfigDraft({ allowedUsersText: event.target.value })}
                      disabled={savingConfig}
                      className={TEXTAREA_CLASS}
                      placeholder="One user ID per line or comma-separated"
                      spellCheck={false}
                    />
                    <p className="ui-card-meta">Recommended for owner-level access control.</p>
                  </div>

                  <div className="space-y-1.5 min-w-0">
                    <label className="ui-card-meta" htmlFor="gateway-blocked-users">Blocked Telegram user IDs</label>
                    <textarea
                      id="gateway-blocked-users"
                      value={configDraft.blockedUsersText}
                      onChange={(event) => updateConfigDraft({ blockedUsersText: event.target.value })}
                      disabled={savingConfig}
                      className={TEXTAREA_CLASS}
                      placeholder="One user ID per line or comma-separated"
                      spellCheck={false}
                    />
                    <p className="ui-card-meta">These users are ignored even if they appear elsewhere.</p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="flex items-start gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={configDraft.toolActivityStream}
                      onChange={(event) => updateConfigDraft({ toolActivityStream: event.target.checked })}
                      disabled={savingConfig}
                      className={CHECKBOX_CLASS}
                    />
                    <span className="min-w-0 space-y-1">
                      <span className="text-[13px] font-medium text-primary">Show tool activity while a reply is running</span>
                      <span className="block ui-card-meta">Sends lightweight working-status acknowledgements during longer tool-heavy turns.</span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={configDraft.clearRecentMessagesOnNew}
                      onChange={(event) => updateConfigDraft({ clearRecentMessagesOnNew: event.target.checked })}
                      disabled={savingConfig}
                      className={CHECKBOX_CLASS}
                    />
                    <span className="min-w-0 space-y-1">
                      <span className="text-[13px] font-medium text-primary">Clear tracked messages when /new is used</span>
                      <span className="block ui-card-meta">Best-effort cleanup for recent Telegram messages tied to the active conversation.</span>
                    </span>
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <ToolbarButton type="submit" disabled={savingConfig || serviceAction !== null || restarting}>
                    {savingConfig ? 'Saving…' : 'Save settings'}
                  </ToolbarButton>
                  <button
                    type="button"
                    onClick={handleResetConfigDraft}
                    disabled={!configDirty || savingConfig}
                    className="text-[13px] text-secondary transition-colors hover:text-primary disabled:opacity-40"
                  >
                    Reset draft
                  </button>
                </div>
              </form>
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
