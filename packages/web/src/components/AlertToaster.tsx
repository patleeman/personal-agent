import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAppData } from '../contexts';
import type { AlertEntry, AlertSnapshot } from '../types';
import { cx } from './ui';

const DEFAULT_ALERT_SNOOZE_DELAY = '15m';

type BrowserNotificationPermissionState = NotificationPermission | 'unsupported';

function sortAlerts(entries: AlertEntry[]): AlertEntry[] {
  return [...entries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function updateSnapshot(snapshot: AlertSnapshot | null, alertId: string, status: AlertEntry['status']): AlertSnapshot | null {
  if (!snapshot) {
    return snapshot;
  }

  const entries = snapshot.entries.map((entry) => entry.id === alertId
    ? {
        ...entry,
        status,
        updatedAt: new Date().toISOString(),
        ...(status === 'acknowledged' ? { acknowledgedAt: new Date().toISOString() } : {}),
        ...(status === 'dismissed' ? { dismissedAt: new Date().toISOString() } : {}),
      }
    : entry);
  return {
    entries,
    activeCount: entries.filter((entry) => entry.status === 'active').length,
  };
}

function readNotificationPermission(): BrowserNotificationPermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export function AlertToaster() {
  const location = useLocation();
  const { alerts, setAlerts = () => {} } = useAppData();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermissionState>(() => readNotificationPermission());
  const previousActiveAlertIdsRef = useRef<Set<string>>(new Set());
  const visibleAlerts = useMemo(() => {
    if (location.pathname.startsWith('/inbox')) {
      return [];
    }

    return sortAlerts((alerts?.entries ?? []).filter((entry) => entry.status === 'active' && entry.severity === 'disruptive')).slice(0, 3);
  }, [alerts?.entries, location.pathname]);
  const showPermissionPrompt = notificationPermission === 'default' && (alerts?.activeCount ?? 0) > 0;

  const refreshAlerts = useCallback(async () => {
    const snapshot = await api.alerts();
    setAlerts(snapshot);
  }, [setAlerts]);

  const acknowledge = useCallback(async (alertId: string) => {
    setBusyId(alertId);
    setAlerts(updateSnapshot(alerts, alertId, 'acknowledged') ?? { entries: [], activeCount: 0 });
    try {
      await api.acknowledgeAlert(alertId);
    } catch {
      await refreshAlerts();
    } finally {
      setBusyId(null);
    }
  }, [alerts, refreshAlerts, setAlerts]);

  const dismiss = useCallback(async (alertId: string) => {
    setBusyId(alertId);
    setAlerts(updateSnapshot(alerts, alertId, 'dismissed') ?? { entries: [], activeCount: 0 });
    try {
      await api.dismissAlert(alertId);
    } catch {
      await refreshAlerts();
    } finally {
      setBusyId(null);
    }
  }, [alerts, refreshAlerts, setAlerts]);

  const snooze = useCallback(async (alertId: string) => {
    setBusyId(alertId);
    setAlerts(updateSnapshot(alerts, alertId, 'acknowledged') ?? { entries: [], activeCount: 0 });
    try {
      await api.snoozeAlert(alertId, { delay: DEFAULT_ALERT_SNOOZE_DELAY });
      await refreshAlerts();
    } catch {
      await refreshAlerts();
    } finally {
      setBusyId(null);
    }
  }, [alerts, refreshAlerts, setAlerts]);

  const requestNotificationPermission = useCallback(async () => {
    if (typeof Notification === 'undefined' || notificationPermission !== 'default') {
      return;
    }

    const nextPermission = await Notification.requestPermission();
    setNotificationPermission(nextPermission);
  }, [notificationPermission]);

  useEffect(() => {
    function syncNotificationPermission() {
      setNotificationPermission(readNotificationPermission());
    }

    syncNotificationPermission();
    window.addEventListener('focus', syncNotificationPermission);
    document.addEventListener('visibilitychange', syncNotificationPermission);
    return () => {
      window.removeEventListener('focus', syncNotificationPermission);
      document.removeEventListener('visibilitychange', syncNotificationPermission);
    };
  }, []);

  useEffect(() => {
    const nextActiveAlerts = (alerts?.entries ?? []).filter((entry) => entry.status === 'active' && entry.severity === 'disruptive');
    const previousIds = previousActiveAlertIdsRef.current;
    const nextIds = new Set(nextActiveAlerts.map((entry) => entry.id));

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && typeof Notification !== 'undefined' && notificationPermission === 'granted') {
      for (const entry of nextActiveAlerts) {
        if (previousIds.has(entry.id)) {
          continue;
        }

        const notification = new Notification(entry.title, {
          body: entry.body,
          tag: `alert:${entry.id}`,
        });
        notification.onclick = () => {
          window.focus();
          if (entry.conversationId) {
            window.location.href = `/conversations/${encodeURIComponent(entry.conversationId)}`;
          } else {
            window.location.href = '/inbox';
          }
        };
      }
    }

    previousActiveAlertIdsRef.current = nextIds;
  }, [alerts?.entries, notificationPermission]);

  if (visibleAlerts.length === 0 && !showPermissionPrompt) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3">
      {showPermissionPrompt ? (
        <div className="pointer-events-auto rounded-2xl border border-accent/35 bg-surface/98 px-4 py-3 shadow-lg backdrop-blur">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim">Browser alerts</p>
          <p className="mt-1 text-[14px] font-semibold text-primary">Enable browser notifications</p>
          <p className="mt-1 text-[13px] leading-6 text-secondary">
            Let reminders and scheduled-task callbacks interrupt even when this tab is hidden.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="ui-toolbar-button"
              onClick={() => { void requestNotificationPermission(); }}
            >
              Enable browser alerts
            </button>
          </div>
        </div>
      ) : null}

      {visibleAlerts.map((entry) => {
        const busy = busyId === entry.id;
        const canSnooze = Boolean(entry.wakeupId);
        return (
          <div
            key={entry.id}
            className={cx(
              'pointer-events-auto rounded-2xl border shadow-lg backdrop-blur',
              'bg-surface/98 px-4 py-3',
              entry.kind === 'reminder' || entry.kind === 'approval-needed'
                ? 'border-warning/50'
                : entry.kind === 'task-failed' || entry.kind === 'blocked'
                  ? 'border-danger/40'
                  : 'border-accent/40',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim">Alert</p>
                <p className="mt-1 text-[15px] font-semibold text-primary">{entry.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-6 text-secondary">{entry.body}</p>
              </div>
              {entry.conversationId ? (
                <Link to={`/conversations/${encodeURIComponent(entry.conversationId)}`} className="ui-action-button shrink-0">
                  Open
                </Link>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {canSnooze ? (
                <button
                  type="button"
                  className="ui-toolbar-button"
                  disabled={busy}
                  onClick={() => { void snooze(entry.id); }}
                >
                  {busy ? 'Working…' : 'Snooze 15m'}
                </button>
              ) : null}
              <button
                type="button"
                className="ui-toolbar-button"
                disabled={busy}
                onClick={() => { void acknowledge(entry.id); }}
              >
                {busy ? 'Working…' : 'Acknowledge'}
              </button>
              <button
                type="button"
                className="ui-toolbar-button"
                disabled={busy}
                onClick={() => { void dismiss(entry.id); }}
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
