import { useEffect, useMemo, useRef } from 'react';
import { getConversationDisplayTitle } from '../conversationTitle';
import type { ActivitySnapshot, SessionMeta } from '../types';
import type { CompanionNotificationCandidate } from './notifications';
import {
  collectCompanionActivityNotifications,
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
    icon: '/app/icon.svg',
    badge: '/app/icon.svg',
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
  activity: ActivitySnapshot | null;
  sessions: SessionMeta[] | null;
  enabled: boolean;
}) {
  const previousActivityRef = useRef<ActivitySnapshot | null>(null);
  const previousSessionsRef = useRef<SessionMeta[] | null>(null);
  const conversationTitleById = useMemo(() => new Map(
    (input.sessions ?? []).map((session) => [session.id, getConversationDisplayTitle(session.title)] as const),
  ), [input.sessions]);

  useEffect(() => {
    if (!input.enabled || typeof document === 'undefined') {
      previousActivityRef.current = input.activity;
      previousSessionsRef.current = input.sessions;
      return;
    }

    if (document.visibilityState === 'visible') {
      previousActivityRef.current = input.activity;
      previousSessionsRef.current = input.sessions;
      return;
    }

    const activityNotifications = collectCompanionActivityNotifications(previousActivityRef.current, input.activity, {
      conversationTitleById,
    });
    const suppressedConversationIds = new Set(activityNotifications.map((notification) => notification.conversationId));
    const sessionNotifications = collectCompanionSessionNotifications(previousSessionsRef.current, input.sessions, {
      suppressConversationIds: suppressedConversationIds,
    });

    previousActivityRef.current = input.activity;
    previousSessionsRef.current = input.sessions;

    for (const candidate of [...activityNotifications, ...sessionNotifications]) {
      void showCompanionNotification(candidate);
    }
  }, [conversationTitleById, input.activity, input.enabled, input.sessions]);
}
