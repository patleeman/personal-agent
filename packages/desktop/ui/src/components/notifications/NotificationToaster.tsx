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
  const dismissedIds = useRef(new Set<string>());

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const dismissToast = useCallback(
    (id: string) => {
      setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      setTimeout(() => removeToast(id), LEAVE_ANIMATION_MS);
    },
    [removeToast],
  );

  // Sync new non-dismissed error/warning notifications into the toast display
  useEffect(() => {
    const newToasts: ToastDisplay[] = [];
    for (const notif of notifications) {
      if (notif.dismissed || notif.read) continue;
      if (notif.type === 'info') continue; // Info only shows in the panel, not as popup
      if (dismissedIds.current.has(notif.id)) continue;

      dismissedIds.current.add(notif.id);
      newToasts.push({
        id: notif.id,
        type: notif.type,
        message: notif.message,
        source: notif.source,
        leaving: false,
      });
    }

    if (newToasts.length === 0) return;

    setToasts((current) => [...current, ...newToasts]);

    for (const toast of newToasts) {
      const duration = TOAST_DURATION_MS[toast.type];
      setTimeout(() => {
        dismissToast(toast.id);
        markRead(toast.id);
      }, duration);
    }
  }, [notifications, dismissToast, markRead]);

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
