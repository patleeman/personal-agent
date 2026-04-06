import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppData } from '../contexts';
import { cx } from './ui';

type BrowserNotificationPermissionState = NotificationPermission | 'unsupported';

function readNotificationPermission(): BrowserNotificationPermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export function AlertToaster() {
  const { alerts } = useAppData();
  const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermissionState>(() => readNotificationPermission());
  const previousActiveAlertIdsRef = useRef<Set<string>>(new Set());
  const showPermissionPrompt = notificationPermission === 'default' && (alerts?.activeCount ?? 0) > 0;

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

  if (!showPermissionPrompt) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3">
      <div className={cx('pointer-events-auto rounded-2xl border border-accent/35 bg-surface/98 px-4 py-3 shadow-lg backdrop-blur')}>
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
    </div>
  );
}
