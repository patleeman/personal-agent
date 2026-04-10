import { useEffect, useMemo, useRef } from 'react';
import { getConversationDisplayTitle } from '../conversationTitle';
import type { AlertSnapshot, SessionMeta } from '../types';
import type { CompanionNotificationCandidate } from './notifications';
import {
  collectCompanionAlertNotifications,
  collectCompanionSessionNotifications,
} from './notifications';

async function showCompanionNotification(candidate: CompanionNotificationCandidate): Promise<void> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return;
  }

  const notificationOptions: NotificationOptions = {
    body: candidate.body,
    tag: candidate.tag,
    data: {
      conversationId: candidate.conversationId,
      url: candidate.path,
    },
    icon: '/app/icon-192.png?v=pa-brand-20260410-104629',
    badge: '/app/icon-192.png?v=pa-brand-20260410-104629',
  };

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(candidate.title, notificationOptions);
      return;
    }
  } catch {
    // Fall back to a window notification when the service worker is unavailable.
  }

  const notification = new Notification(candidate.title, notificationOptions);
  notification.onclick = () => {
    window.focus();
    window.location.href = candidate.path;
  };
}

export function useCompanionNotifications(input: {
  alerts: AlertSnapshot | null;
  sessions: SessionMeta[] | null;
  enabled: boolean;
}) {
  const previousAlertsRef = useRef<AlertSnapshot | null>(null);
  const previousSessionsRef = useRef<SessionMeta[] | null>(null);
  const conversationTitleById = useMemo(() => new Map(
    (input.sessions ?? []).map((session) => [session.id, getConversationDisplayTitle(session.title)] as const),
  ), [input.sessions]);

  useEffect(() => {
    if (!input.enabled || typeof document === 'undefined') {
      previousAlertsRef.current = input.alerts;
      previousSessionsRef.current = input.sessions;
      return;
    }

    if (document.visibilityState === 'visible') {
      previousAlertsRef.current = input.alerts;
      previousSessionsRef.current = input.sessions;
      return;
    }

    const alertNotifications = collectCompanionAlertNotifications(previousAlertsRef.current, input.alerts, {
      conversationTitleById,
    });
    const suppressedConversationIds = new Set(alertNotifications.map((notification) => notification.conversationId));
    const sessionNotifications = collectCompanionSessionNotifications(previousSessionsRef.current, input.sessions, {
      suppressConversationIds: suppressedConversationIds,
    });

    previousAlertsRef.current = input.alerts;
    previousSessionsRef.current = input.sessions;

    for (const candidate of [...alertNotifications, ...sessionNotifications]) {
      void showCompanionNotification(candidate);
    }
  }, [conversationTitleById, input.alerts, input.enabled, input.sessions]);
}
