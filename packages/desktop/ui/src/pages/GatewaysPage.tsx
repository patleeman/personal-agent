import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../client/api';
import type { GatewayConnection, GatewayEvent, GatewayState, GatewayThreadBinding } from '../shared/types';
import { timeAgoCompact } from '../shared/utils';

const EMPTY_GATEWAY_STATE: GatewayState = { providers: [], connections: [], bindings: [], events: [] };

export function GatewaysPage() {
  const [state, setState] = useState<GatewayState>(EMPTY_GATEWAY_STATE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const telegramConnection = state.connections.find((connection) => connection.provider === 'telegram') ?? null;
  const telegramBinding = telegramConnection
    ? (state.bindings.find((binding) => binding.connectionId === telegramConnection.id && binding.provider === 'telegram') ?? null)
    : null;

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

  return (
    <div className="h-full overflow-auto bg-base px-8 py-8 text-primary">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-7">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Gateways</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-secondary">
              Route external apps into conversation threads. Provider credentials live in Settings; routing and health live here.
            </p>
          </div>
          <button className="ui-toolbar-button bg-accent text-white hover:bg-accent/90" onClick={ensureTelegram} disabled={busy !== null}>
            {telegramConnection ? 'Refresh Telegram' : '+ Connect Telegram'}
          </button>
        </header>

        {error ? <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}
        {loading ? <p className="text-sm text-dim">Loading gateways…</p> : null}

        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <p className="ui-section-label">Connected</p>
            <Link className="text-xs text-secondary hover:text-primary" to="/settings">
              Provider config in Settings →
            </Link>
          </div>

          {telegramConnection ? (
            <GatewayCard
              connection={telegramConnection}
              binding={telegramBinding}
              busy={busy}
              onPause={() => updateTelegram(false)}
              onResume={() => updateTelegram(true)}
              onDetach={detachTelegram}
            />
          ) : (
            <div className="rounded-2xl border border-border-subtle bg-surface p-6">
              <p className="font-medium">No gateways connected</p>
              <p className="mt-1 max-w-xl text-sm leading-6 text-secondary">
                Connect Telegram to let messages create and drive conversation threads through a managed gateway.
              </p>
              <button className="ui-toolbar-button mt-4" onClick={ensureTelegram} disabled={busy !== null}>
                Connect Telegram
              </button>
            </div>
          )}
        </section>

        <GatewayActivity events={state.events} />
      </div>
    </div>
  );
}

function GatewayCard({
  connection,
  binding,
  busy,
  onPause,
  onResume,
  onDetach,
}: {
  connection: GatewayConnection;
  binding: GatewayThreadBinding | null;
  busy: string | null;
  onPause: () => void;
  onResume: () => void;
  onDetach: () => void;
}) {
  const active = connection.enabled && (connection.status === 'active' || connection.status === 'connected');
  const statusTone =
    connection.status === 'needs_attention' ? 'text-danger' : connection.status === 'paused' ? 'text-warning' : 'text-accent';

  return (
    <article className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-sm">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500 text-xs font-bold text-white">TG</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Telegram</h2>
            <span className={`rounded-full bg-elevated px-2 py-0.5 text-[11px] font-semibold ${statusTone}`}>
              {formatStatus(connection.status)}
            </span>
            {active ? <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">Active</span> : null}
          </div>
          <p className="mt-1 truncate text-sm text-secondary">
            {binding ? (
              <>
                Routing to <span className="font-medium text-primary">{binding.conversationTitle || binding.conversationId}</span>
              </>
            ) : (
              'No thread attached'
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {binding ? (
            <Link className="ui-toolbar-button" to={`/conversations/${encodeURIComponent(binding.conversationId)}`}>
              Open thread
            </Link>
          ) : null}
          {binding ? (
            <button className="ui-toolbar-button" onClick={onDetach} disabled={busy !== null}>
              Detach
            </button>
          ) : null}
          <button className="ui-toolbar-button" onClick={active ? onPause : onResume} disabled={busy !== null}>
            {active ? 'Pause' : 'Resume'}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-3 border-t border-border-subtle text-sm max-md:grid-cols-1">
        <GatewayStat label="Attached thread" value={binding?.conversationTitle || binding?.conversationId || 'None'} muted={!binding} />
        <GatewayStat
          label="Telegram target"
          value={binding?.externalChatLabel || binding?.externalChatId || 'None'}
          muted={!binding?.externalChatId}
        />
        <GatewayStat label="Updated" value={timeAgoCompact(new Date(connection.updatedAt).getTime())} />
      </div>
    </article>
  );
}

function GatewayStat({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="border-r border-border-subtle px-5 py-3 last:border-r-0 max-md:border-r-0 max-md:border-t">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-dim">{label}</p>
      <p className={muted ? 'mt-1 text-secondary' : 'mt-1 text-primary'}>{value}</p>
    </div>
  );
}

function GatewayActivity({ events }: { events: GatewayEvent[] }) {
  const rows = useMemo(() => events.slice(0, 8), [events]);
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="ui-section-label">Recent activity</p>
        <p className="text-xs text-dim">Last 100 events are retained</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
        {rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-secondary">No gateway activity yet.</p>
        ) : (
          rows.map((event) => (
            <div
              key={event.id}
              className="grid grid-cols-[7rem_1fr_auto] items-center gap-4 border-t border-border-subtle px-5 py-3 text-sm first:border-t-0"
            >
              <span className="text-xs text-dim">{timeAgoCompact(new Date(event.createdAt).getTime())}</span>
              <span>{event.message}</span>
              <span className="text-xs capitalize text-secondary">{event.kind}</span>
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

function formatGatewayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /Unexpected token.*doctype|not valid JSON/i.test(message) ? 'Gateway API is unavailable in this preview.' : message;
}
