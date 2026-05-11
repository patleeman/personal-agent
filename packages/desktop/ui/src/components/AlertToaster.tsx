import { useCallback, useEffect, useState } from 'react';

import { cx } from '../extensions/ui';

interface Toast {
  id: number;
  message: string;
  leaving: boolean;
}

let nextId = 1;

const TOAST_DURATION_MS = 4_000;
const LEAVE_ANIMATION_MS = 300;

export function AlertToaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const dismissToast = useCallback(
    (id: number) => {
      setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      setTimeout(() => removeToast(id), LEAVE_ANIMATION_MS);
    },
    [removeToast],
  );

  useEffect(() => {
    function handleExtensionToast(event: CustomEvent<{ extensionId: string; message: string }>) {
      const { message } = event.detail;
      if (!message) return;
      const id = nextId++;
      setToasts((current) => [...current, { id, message, leaving: false }]);
      setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
    }

    window.addEventListener('pa-extension-toast', handleExtensionToast as EventListener);
    return () => window.removeEventListener('pa-extension-toast', handleExtensionToast as EventListener);
  }, [dismissToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 left-1/2 z-[9999] flex -translate-x-1/2 flex-col items-center gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cx(
            'pointer-events-auto cursor-pointer whitespace-nowrap rounded-lg border border-border-subtle bg-surface px-3.5 py-2 text-[13px] text-primary shadow-xl transition-all duration-300',
            toast.leaving ? 'translate-y-2 opacity-0' : 'translate-y-0 opacity-100',
          )}
          onClick={() => dismissToast(toast.id)}
          role="alert"
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
