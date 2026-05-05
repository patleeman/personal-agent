import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../client/api';
import { AppPageIntro, AppPageLayout, ToolbarButton } from '../components/ui';
import type { GatewayConnection, GatewayEvent, GatewayState, GatewayThreadBinding } from '../shared/types';
import { timeAgoCompact } from '../shared/utils';

const EMPTY_GATEWAY_STATE: GatewayState = { providers: [], connections: [], bindings: [], events: [], chatTargets: [] };

export function GatewaysPage() {
  const [state, setState] = useState<GatewayState>(EMPTY_GATEWAY_STATE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const telegramConnection = state.connections.find((c) => c.provider === 'telegram') ?? null;
  const telegramBinding = telegramConnection
    ? (state.bindings.find((b) => b.connectionId === telegramConnection.id && b.provider === 'telegram') ?? null)
    : null;
  const slackConnection = state.connections.find((c) => c.provider === 'slack_mcp') ?? null;
  const slackBinding = slackConnection
    ? (state.bindings.find((b) => b.connectionId === slackConnection.id && b.provider === 'slack_mcp') ?? null)
    : null;
  const [slackQuery, setSlackQuery] = useState('');
  const [slackChannels, setSlackChannels] = useState<Array<{ id: string; name: string; isPrivate?: boolean }>>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .gateways()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((err) => {
        if (!cancelled) setError(formatGatewayError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function ensureTelegram() {
    setBusy('connect');
    setError(null);
    try {
      setState(await api.ensureGatewayConnection('telegram'));
    } catch (err) {
      setError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function updateTelegram(enabled: boolean) {
    setBusy(enabled ? 'resume' : 'pause');
    setError(null);
    try {
      setState(await api.updateGatewayConnection('telegram', { status: enabled ? 'active' : 'paused', enabled }));
    } catch (err) {
      setError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function detachTelegram() {
    if (!telegramBinding) return;
    setBusy('detach');
    setError(null);
    try {
      setState(await api.detachGatewayConversation(telegramBinding.conversationId, 'telegram'));
    } catch (err) {
      setError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function searchSlackChannels() {
    if (!slackQuery.trim()) return;
    setBusy('slack-search');
    setError(null);
    try {
      setSlackChannels((await api.searchSlackMcpChannels(slackQuery.trim())).channels);
    } catch (err) {
      setError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function attachSlackChannel(channel: { id: string; name: string }) {
    setBusy('slack-attach');
    setError(null);
    try {
      setState(await api.attachSlackMcpChannel({ channelId: channel.id, channelLabel: channel.name }));
      setSlackChannels([]);
      setSlackQuery('');
    } catch (err) {
      setError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function detachSlack() {
    if (!slackBinding) return;
    setBusy('slack-detach');
    setError(null);
    try {
      setState(await api.detachGatewayConversation(slackBinding.conversationId, 'slack_mcp'));
    } catch (err) {
      setError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  const hasVisibleSlackConnection = slackConnection && slackBinding;
  const hasAnyConnection = telegramConnection || hasVisibleSlackConnection;

  return (
    <div className="h-full overflow-y-auto">
      <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="space-y-10">
        <AppPageIntro
          title="Gateways"
          summary={
            <>
              Route external apps into conversation threads.{' '}
              <Link to="/settings#settings-gateways" className="text-accent hover:underline">
                Provider credentials in Settings.
              </Link>
            </>
          }
          actions={
            <ToolbarButton
              className="rounded-lg px-3 py-1.5 text-[12px] text-primary shadow-none"
              onClick={ensureTelegram}
              disabled={busy !== null}
            >
              {telegramConnection ? 'Refresh' : '+ Connect Telegram'}
            </ToolbarButton>
          }
        />

        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        {loading ? <p className="text-[13px] text-dim">Loading…</p> : null}

        {/* Connected gateways */}
        <section className="max-w-4xl">
          <h2 className="text-[18px] font-semibold tracking-tight text-primary">Connected</h2>
          <div className="mt-3 border-t border-border-subtle">
            {telegramConnection ? (
              <GatewayRow
                connection={telegramConnection}
                binding={telegramBinding}
                busy={busy}
                icon="TG"
                iconBg="bg-sky-500"
                title="Telegram"
                targetLabel="Telegram chat"
                onPause={() => updateTelegram(false)}
                onResume={() => updateTelegram(true)}
                onDetach={detachTelegram}
                showPauseResume
              />
            ) : null}
            {hasVisibleSlackConnection ? (
              <GatewayRow
                connection={slackConnection}
                binding={slackBinding}
                busy={busy}
                icon="SL"
                iconBg="bg-purple-600"
                title="Slack MCP"
                targetLabel="Slack channel"
                onDetach={detachSlack}
              />
            ) : null}
            {!hasAnyConnection ? (
              <div className="py-6 text-[14px] text-secondary">
                <p>No gateways connected.</p>
                <p className="mt-1 text-[13px] text-dim">Save provider credentials in Settings, then connect gateways here.</p>
                <ToolbarButton
                  className="mt-4 rounded-lg px-3 py-1.5 text-[12px] text-primary shadow-none"
                  onClick={ensureTelegram}
                  disabled={busy !== null}
                >
                  Connect Telegram
                </ToolbarButton>
              </div>
            ) : null}
          </div>
        </section>

        {/* Slack channel attach — show until Slack MCP is attached to a channel */}
        {!slackBinding ? (
          <section className="max-w-4xl">
            <h2 className="text-[18px] font-semibold tracking-tight text-primary">Slack MCP</h2>
            <div className="mt-3 border-t border-border-subtle pt-5 space-y-3">
              <p className="text-[13px] text-secondary">Search Slack through MCP and attach an active channel as a gateway.</p>
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface/70 px-3 py-1.5 text-[13px] text-primary placeholder:text-dim outline-none transition-colors focus:border-accent/50 disabled:opacity-50"
                  value={slackQuery}
                  onChange={(e) => setSlackQuery(e.target.value)}
                  placeholder="Search channels…"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void searchSlackChannels();
                  }}
                />
                <ToolbarButton
                  className="rounded-lg px-3 py-1.5 text-[12px] text-primary shadow-none"
                  onClick={searchSlackChannels}
                  disabled={busy !== null || !slackQuery.trim()}
                >
                  Search
                </ToolbarButton>
              </div>
              {slackChannels.length > 0 ? (
                <div className="border-t border-border-subtle">
                  {slackChannels.map((channel) => (
                    <button
                      key={channel.id}
                      type="button"
                      className="flex w-full items-center justify-between border-b border-border-subtle py-2.5 text-left text-[13px] hover:text-accent last:border-b-0"
                      onClick={() => void attachSlackChannel(channel)}
                      disabled={busy !== null}
                    >
                      <span>{channel.name}</span>
                      <span className="text-[12px] text-dim">{channel.id}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Activity */}
        <GatewayActivity events={state.events} />
      </AppPageLayout>
    </div>
  );
}

function GatewayRow({
  connection,
  binding,
  busy,
  icon,
  iconBg,
  title,
  targetLabel,
  onPause,
  onResume,
  onDetach,
  showPauseResume = false,
}: {
  connection: GatewayConnection;
  binding: GatewayThreadBinding | null;
  busy: string | null;
  icon: string;
  iconBg: string;
  title: string;
  targetLabel: string;
  onPause?: () => void;
  onResume?: () => void;
  onDetach: () => void;
  showPauseResume?: boolean;
}) {
  const active = connection.enabled && (connection.status === 'active' || connection.status === 'connected');
  const statusDot =
    connection.status === 'needs_attention'
      ? 'bg-danger'
      : connection.status === 'paused'
        ? 'bg-warning'
        : active
          ? 'bg-success'
          : 'bg-dim';
  const statusLabel =
    connection.status === 'needs_attention'
      ? 'Needs attention'
      : connection.status === 'paused'
        ? 'Paused'
        : active
          ? 'Active'
          : formatStatus(connection.status);

  return (
    <div className="grid gap-3 border-t border-border-subtle py-5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white ${iconBg}`}>{icon}</div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-[14px] font-medium">{title}</span>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} />
          <span className="text-[13px] text-secondary">{statusLabel}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {binding ? (
          <Link
            className="ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] shadow-none"
            to={`/conversations/${encodeURIComponent(binding.conversationId)}`}
          >
            Open thread
          </Link>
        ) : null}
        {binding ? (
          <ToolbarButton className="rounded-lg px-3 py-1.5 text-[12px] shadow-none" onClick={onDetach} disabled={busy !== null}>
            Detach
          </ToolbarButton>
        ) : null}
        {showPauseResume && onPause && onResume ? (
          <ToolbarButton
            className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
            onClick={active ? onPause : onResume}
            disabled={busy !== null}
          >
            {active ? 'Pause' : 'Resume'}
          </ToolbarButton>
        ) : null}
      </div>
      <dl className="grid grid-cols-3 gap-6 text-[13px] sm:col-span-2 max-sm:grid-cols-1">
        <GatewayMeta label="Thread" value={binding?.conversationTitle || binding?.conversationId || '—'} muted={!binding} />
        <GatewayMeta
          label={targetLabel}
          value={binding?.externalChatLabel || binding?.externalChatId || '—'}
          muted={!binding?.externalChatId}
        />
        <GatewayMeta label="Updated" value={timeAgoCompact(connection.updatedAt)} />
      </dl>
    </div>
  );
}

function GatewayMeta({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">{label}</dt>
      <dd className={`mt-1 truncate ${muted ? 'text-secondary' : 'text-primary'}`}>{value}</dd>
    </div>
  );
}

function GatewayActivity({ events }: { events: GatewayEvent[] }) {
  const rows = useMemo(() => events.slice(0, 10), [events]);
  return (
    <section className="max-w-4xl">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[18px] font-semibold tracking-tight text-primary">Recent activity</h2>
        <p className="text-[12px] text-dim">Last 100 retained</p>
      </div>
      <div className="mt-3 border-t border-border-subtle">
        {rows.length === 0 ? (
          <p className="py-6 text-[14px] text-secondary">No activity yet.</p>
        ) : (
          rows.map((event) => (
            <div key={event.id} className="flex items-baseline gap-6 border-t border-border-subtle py-3 text-[13px] first:border-t-0">
              <span className="w-20 shrink-0 text-[12px] text-dim">{timeAgoCompact(event.createdAt)}</span>
              <span className="min-w-0 flex-1">{event.message}</span>
              <span className="shrink-0 text-[12px] text-secondary">{formatActivityKind(event.kind)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

function formatActivityKind(kind: string): string {
  const normalized = kind.replace(/_/g, ' ');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatGatewayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /Unexpected token.*doctype|not valid JSON/i.test(message) ? 'Gateway API is unavailable in this preview.' : message;
}
