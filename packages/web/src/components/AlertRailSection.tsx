import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAppData } from '../contexts';
import type { AlertEntry } from '../types';
import { cx } from './ui';

const DEFAULT_ALERT_SNOOZE_DELAY = '15m';

function sortActiveAlerts(entries: AlertEntry[]): AlertEntry[] {
  return [...entries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
}

function currentConversationIdFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'conversations' && parts[1] && parts[1] !== 'new'
    ? parts[1]
    : null;
}

function pickVisibleAlerts(entries: AlertEntry[], pathname: string): AlertEntry[] {
  const activeAlerts = entries.filter((entry) => entry.status === 'active');
  const conversationId = currentConversationIdFromPath(pathname);

  if (!conversationId) {
    return sortActiveAlerts(activeAlerts);
  }

  const scopedAlerts = activeAlerts.filter((entry) => entry.conversationId === conversationId);
  return sortActiveAlerts(scopedAlerts);
}

function statusTone(entry: AlertEntry): 'warning' | 'danger' | 'muted' {
  if (entry.requiresAck || entry.kind === 'approval-needed' || entry.kind === 'reminder') {
    return 'warning';
  }

  if (entry.kind === 'task-failed' || entry.kind === 'blocked') {
    return 'danger';
  }

  return 'muted';
}

function statusLabel(entry: AlertEntry): string {
  if (entry.kind === 'approval-needed') {
    return 'approval';
  }

  if (entry.kind === 'reminder') {
    return 'reminder';
  }

  if (entry.kind === 'task-failed') {
    return 'failed';
  }

  if (entry.kind === 'blocked') {
    return 'blocked';
  }

  return 'alert';
}

export function AlertRailSection() {
  const location = useLocation();
  const { alerts, setAlerts = () => {} } = useAppData();
  const [busyKey, setBusyKey] = useState<string | 'all' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const currentConversationId = useMemo(() => currentConversationIdFromPath(location.pathname), [location.pathname]);
  useEffect(() => {
    if (alerts !== null) {
      return;
    }

    let cancelled = false;
    void api.alerts()
      .then((snapshot) => {
        if (!cancelled) {
          setAlerts(snapshot);
        }
      })
      .catch(() => {
        // Keep waiting for the shared bootstrap or the next retry.
      });

    return () => {
      cancelled = true;
    };
  }, [alerts, setAlerts]);

  const visibleAlerts = useMemo(
    () => pickVisibleAlerts(alerts?.entries ?? [], location.pathname),
    [alerts?.entries, location.pathname],
  );

  const refreshAlerts = useCallback(async () => {
    const snapshot = await api.alerts();
    setAlerts(snapshot);
  }, [setAlerts]);

  const runAction = useCallback(async (key: string | 'all', action: () => Promise<unknown>) => {
    setBusyKey(key);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      try {
        await refreshAlerts();
      } catch {
        // Ignore refresh failures and keep the existing state.
      }
      setBusyKey(null);
    }
  }, [refreshAlerts]);

  const clearAll = useCallback(async () => {
    if (visibleAlerts.length === 0) {
      return;
    }

    await runAction('all', async () => {
      await Promise.all(visibleAlerts.map((entry) => api.dismissAlert(entry.id)));
    });
  }, [runAction, visibleAlerts]);

  if (visibleAlerts.length === 0) {
    return null;
  }

  const busy = busyKey !== null;

  return (
    <section className="shrink-0 border-b border-border-subtle bg-surface/72 backdrop-blur">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="ui-section-label">Alerts</p>
          <p className="mt-1 text-[11px] text-secondary">
            {visibleAlerts.length} active {visibleAlerts.length === 1 ? 'alert' : 'alerts'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void clearAll(); }}
          disabled={busy}
          className="ui-toolbar-button shrink-0 text-accent"
        >
          {busyKey === 'all' ? 'Clearing…' : 'Clear all'}
        </button>
      </div>

      {actionError && (
        <p className="px-4 pb-2 text-[11px] text-danger">{actionError}</p>
      )}

      <div className="max-h-[18rem] overflow-y-auto divide-y divide-border-subtle/70">
        {visibleAlerts.map((entry) => {
          const entryBusy = busyKey === entry.id;
          const tone = statusTone(entry);
          const canSnooze = Boolean(entry.wakeupId);
          const targetHref = entry.conversationId
            ? `/conversations/${encodeURIComponent(entry.conversationId)}`
            : '/inbox';
          const showOpenLink = !entry.conversationId || entry.conversationId !== currentConversationId;

          return (
            <div key={entry.id} className="space-y-2 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cx(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]',
                      tone === 'warning'
                        ? 'bg-warning/10 text-warning'
                        : tone === 'danger'
                          ? 'bg-danger/10 text-danger'
                          : 'bg-elevated text-dim',
                    )}>
                      {statusLabel(entry)}
                    </span>
                    {entry.requiresAck && <span className="text-[10px] uppercase tracking-[0.12em] text-dim">ack required</span>}
                  </div>
                  <p className="mt-1 text-[13px] font-semibold text-primary">{entry.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-6 text-secondary">{entry.body}</p>
                </div>
                {showOpenLink ? (
                  <Link to={targetHref} className="ui-toolbar-button shrink-0 text-accent">
                    Open
                  </Link>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                {canSnooze && (
                  <button
                    type="button"
                    onClick={() => { void runAction(entry.id, () => api.snoozeAlert(entry.id, { delay: DEFAULT_ALERT_SNOOZE_DELAY })); }}
                    disabled={busy}
                    className="ui-toolbar-button"
                  >
                    {entryBusy ? 'Working…' : 'Snooze 15m'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { void runAction(entry.id, () => api.acknowledgeAlert(entry.id)); }}
                  disabled={busy}
                  className="ui-toolbar-button"
                >
                  {entryBusy ? 'Working…' : 'Acknowledge'}
                </button>
                <button
                  type="button"
                  onClick={() => { void runAction(entry.id, () => api.dismissAlert(entry.id)); }}
                  disabled={busy}
                  className="ui-toolbar-button"
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
