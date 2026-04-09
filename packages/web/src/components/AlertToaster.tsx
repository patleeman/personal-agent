import React, { useEffect, useRef, useState } from 'react';
import { useAppData } from '../contexts';

type BrowserNotificationPermissionState = NotificationPermission | 'unsupported';

void React;

function readNotificationPermission(): BrowserNotificationPermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export function AlertToaster() {
  const { alerts } = useAppData();
  const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermissionState>(() => readNotificationPermission());
  const previousActiveAlertIdsRef = useRef<Set<string>>(new Set());

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

  return null;
}
