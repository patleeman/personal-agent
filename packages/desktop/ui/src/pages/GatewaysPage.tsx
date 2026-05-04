import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../client/api';
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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        {/* Header */}
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Gateways</h1>
            <p className="mt-1 text-sm leading-relaxed text-secondary">
              Route external apps into conversation threads.{' '}
              <Link to="/settings#settings-gateways" className="text-accent hover:underline">
                Provider credentials in Settings.
              </Link>
            </p>
          </div>
          <button className="ui-toolbar-button shrink-0" onClick={ensureTelegram} disabled={busy !== null}>
            {telegramConnection ? 'Refresh' : '+ Connect Telegram'}
          </button>
        </header>

        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {loading ? <p className="text-sm text-dim">Loading…</p> : null}

        {/* Gateways list */}
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <p className="ui-section-label">Connected</p>
          </div>

          {telegramConnection ? (
            <GatewayRow
              connection={telegramConnection}
              binding={telegramBinding}
              busy={busy}
              onPause={() => updateTelegram(false)}
              onResume={() => updateTelegram(true)}
              onDetach={detachTelegram}
            />
          ) : (
            <div className="py-4">
              <p className="text-sm text-secondary">No gateways connected.</p>
              <p className="mt-1 text-sm text-dim">Save a Telegram bot token in Settings, then connect it here.</p>
              <button className="ui-toolbar-button mt-4" onClick={ensureTelegram} disabled={busy !== null}>
                Connect Telegram
              </button>
            </div>
          )}
        </section>

        {/* Activity */}
        <GatewayActivity events={state.events} />
      </div>
    </div>
  );
}

function GatewayRow({
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
    <div className="space-y-4">
      {/* Name + status + actions */}
      <div className="flex items-center gap-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-500 text-[11px] font-bold text-white">TG</div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="font-medium">Telegram</span>
          <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
          <span className="text-[12px] text-secondary">{statusLabel}</span>
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

      {/* Metadata row */}
      <dl className="grid grid-cols-3 gap-6 border-t border-border-subtle pt-4 text-sm max-sm:grid-cols-1">
        <GatewayMeta label="Thread" value={binding?.conversationTitle || binding?.conversationId || '—'} muted={!binding} />
        <GatewayMeta
          label="Telegram chat"
          value={binding?.externalChatLabel || binding?.externalChatId || '—'}
          muted={!binding?.externalChatId}
        />
        <GatewayMeta label="Updated" value={timeAgoCompact(new Date(connection.updatedAt).getTime())} />
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
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <p className="ui-section-label">Recent activity</p>
        <p className="text-xs text-dim">Last 100 retained</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-secondary">No activity yet.</p>
      ) : (
        <div className="space-y-0 divide-y divide-border-subtle">
          {rows.map((event) => (
            <div key={event.id} className="flex items-baseline gap-6 py-2.5 text-sm">
              <span className="w-20 shrink-0 text-xs text-dim">{timeAgoCompact(new Date(event.createdAt).getTime())}</span>
              <span className="min-w-0 flex-1">{event.message}</span>
              <span className="shrink-0 text-xs capitalize text-dim">{event.kind}</span>
            </div>
          ))}
        </div>
      )}
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
