/**
 * NotificationToaster — typed transient toast popups.
 *
 * Replaces the old AlertToaster with type-based styling.
 * Error toasts stay longer; info/warning toasts auto-dismiss.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { cx } from '../ui';
import { type NotificationType, useNotificationStore } from './notificationStore';

const TOAST_DURATION_MS: Record<NotificationType, number> = {
  info: 4_000,
  warning: 5_000,
  error: 8_000,
};
const LEAVE_ANIMATION_MS = 300;

interface ToastDisplay {
  id: string;
  type: NotificationType;
  message: string;
  source?: string;
  count: number;
  leaving: boolean;
}

const TYPE_BORDER_CLASS: Record<NotificationType, string> = {
  info: 'border-border-subtle',
  warning: 'border-amber-500/30',
  error: 'border-red-500/30',
};

const TYPE_BG_CLASS: Record<NotificationType, string> = {
  info: 'bg-surface',
  warning: 'bg-amber-50 dark:bg-amber-950/40',
  error: 'bg-red-50 dark:bg-red-950/40',
};

export function NotificationToaster() {
  const { notifications, markRead } = useNotificationStore();
  const [toasts, setToasts] = useState<ToastDisplay[]>([]);
  const seenCounts = useRef(new Map<string, number>());
  const autoDismissTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearAutoDismissTimer = useCallback((id: string) => {
    const timer = autoDismissTimers.current.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    autoDismissTimers.current.delete(id);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const dismissToast = useCallback(
    (id: string) => {
      clearAutoDismissTimer(id);
      setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      setTimeout(() => removeToast(id), LEAVE_ANIMATION_MS);
    },
    [clearAutoDismissTimer, removeToast],
  );

  const scheduleAutoDismiss = useCallback(
    (id: string, duration: number) => {
      clearAutoDismissTimer(id);
      const timer = setTimeout(() => {
        autoDismissTimers.current.delete(id);
        dismissToast(id);
        markRead(id);
      }, duration);
      autoDismissTimers.current.set(id, timer);
    },
    [clearAutoDismissTimer, dismissToast, markRead],
  );

  // Sync non-dismissed error/warning notifications into the toast display.
  useEffect(() => {
    const activeNotifications = notifications.filter((notif) => !notif.dismissed && !notif.read && notif.type !== 'info');
    const activeById = new Map(activeNotifications.map((notif) => [notif.id, notif]));
    const activeIds = new Set(activeById.keys());

    for (const id of autoDismissTimers.current.keys()) {
      if (!activeIds.has(id)) {
        clearAutoDismissTimer(id);
      }
    }
    for (const id of seenCounts.current.keys()) {
      if (!activeIds.has(id)) {
        seenCounts.current.delete(id);
      }
    }

    setToasts((current) => {
      const next = current
        .filter((toast) => toast.leaving || activeById.has(toast.id))
        .map((toast) => {
          const notif = activeById.get(toast.id);
          if (!notif) return toast;
          return {
            ...toast,
            type: notif.type,
            message: notif.message,
            source: notif.source,
            count: notif.count,
          };
        });
      const existingIds = new Set(next.map((toast) => toast.id));

      for (const notif of activeNotifications) {
        if (existingIds.has(notif.id)) continue;
        next.push({
          id: notif.id,
          type: notif.type,
          message: notif.message,
          source: notif.source,
          count: notif.count,
          leaving: false,
        });
      }

      return next;
    });

    for (const notif of activeNotifications) {
      const previousCount = seenCounts.current.get(notif.id);
      if (previousCount === notif.count) continue;
      seenCounts.current.set(notif.id, notif.count);
      scheduleAutoDismiss(notif.id, TOAST_DURATION_MS[notif.type]);
    }
  }, [clearAutoDismissTimer, notifications, scheduleAutoDismiss]);

  useEffect(
    () => () => {
      for (const timer of autoDismissTimers.current.values()) {
        clearTimeout(timer);
      }
      autoDismissTimers.current.clear();
    },
    [],
  );

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-28 right-4 z-[9999] flex flex-col items-end gap-1.5 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cx(
            'pointer-events-auto cursor-pointer max-w-sm rounded-lg border px-3 py-1.5 text-[12px] shadow-lg transition-all duration-300',
            TYPE_BORDER_CLASS[toast.type],
            TYPE_BG_CLASS[toast.type],
            toast.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-primary',
            toast.leaving ? 'translate-x-2 opacity-0' : 'translate-x-0 opacity-100',
          )}
          onClick={() => {
            dismissToast(toast.id);
            markRead(toast.id);
          }}
          role="alert"
        >
          {toast.source ? <span className="mr-1 opacity-50 text-[10px]">[{toast.source}]</span> : null}
          {toast.message}
          {toast.count > 1 ? <span className="ml-1 opacity-50">({toast.count})</span> : null}
        </div>
      ))}
    </div>
  );
}
