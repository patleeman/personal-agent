import React, { useEffect, useRef, useState } from 'react';
import { useAppData } from '../contexts';
import type { AlertEntry } from '../types';

type BrowserNotificationPermissionState = NotificationPermission | 'unsupported';

void React;

function readNotificationPermission(): BrowserNotificationPermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export function collectFreshDisruptiveAlerts(
  previousActiveAlertIds: ReadonlySet<string> | null,
  entries: AlertEntry[] | null | undefined,
): {
  freshEntries: AlertEntry[];
  nextActiveAlertIds: Set<string>;
} {
  const nextActiveAlerts = (entries ?? []).filter((entry) => entry.status === 'active' && entry.severity === 'disruptive');
  const nextActiveAlertIds = new Set(nextActiveAlerts.map((entry) => entry.id));

  if (previousActiveAlertIds === null) {
    return {
      freshEntries: [],
      nextActiveAlertIds,
    };
  }

  return {
    freshEntries: nextActiveAlerts.filter((entry) => !previousActiveAlertIds.has(entry.id)),
    nextActiveAlertIds,
  };
}

export function AlertToaster() {
  const { alerts } = useAppData();
  const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermissionState>(() => readNotificationPermission());
  const previousActiveAlertIdsRef = useRef<Set<string> | null>(null);

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
    const { freshEntries, nextActiveAlertIds } = collectFreshDisruptiveAlerts(previousActiveAlertIdsRef.current, alerts?.entries);

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && typeof Notification !== 'undefined' && notificationPermission === 'granted') {
      for (const entry of freshEntries) {
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

    previousActiveAlertIdsRef.current = nextActiveAlertIds;
  }, [alerts?.entries, notificationPermission]);

  return null;
}
