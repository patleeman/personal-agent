/**
 * Notification store — central state for all in-app notifications.
 *
 * Architecture:
 *   NotificationProvider (in Layout) → useNotificationStore() hook
 *
 * External sources feed in via:
 *   - `pa-extension-toast` CustomEvent (extension frontend → store)
 *   - `pa-notification` CustomEvent (core code, error boundaries → store)
 *   - Direct `addNotification()` export (class components, imperative use)
 *   - DesktopAppEvent `{ type: 'notification' }` (backend extension → SSE → store)
 */
import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react';

export type NotificationType = 'info' | 'warning' | 'error';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  message: string;
  details?: string;
  source?: string;
  timestamp: string;
  count: number;
  read: boolean;
  dismissed: boolean;
}

export interface AddNotificationPayload {
  type: NotificationType;
  message: string;
  details?: string;
  source?: string;
}

type Action =
  | { kind: 'ADD'; payload: AddNotificationPayload }
  | { kind: 'DISMISS'; id: string }
  | { kind: 'DISMISS_ALL' }
  | { kind: 'MARK_READ'; id: string }
  | { kind: 'MARK_ALL_READ' };

const DEDUP_WINDOW_MS = 30_000;

let nextId = 1;

function generateId(): string {
  return `notif-${nextId++}-${Date.now()}`;
}

function reducer(state: NotificationItem[], action: Action): NotificationItem[] {
  switch (action.kind) {
    case 'ADD': {
      const now = Date.now();
      // Dedup: same message + source + type within the window increments counter
      const existing = state.find(
        (n) =>
          !n.dismissed &&
          n.message === action.payload.message &&
          n.source === action.payload.source &&
          n.type === action.payload.type &&
          now - new Date(n.timestamp).getTime() < DEDUP_WINDOW_MS,
      );

      if (existing) {
        return state.map((n) =>
          n.id === existing.id ? { ...n, count: n.count + 1, timestamp: new Date().toISOString(), read: false } : n,
        );
      }

      return [
        ...state,
        {
          id: generateId(),
          type: action.payload.type,
          message: action.payload.message,
          details: action.payload.details,
          source: action.payload.source,
          timestamp: new Date().toISOString(),
          count: 1,
          read: false,
          dismissed: false,
        },
      ];
    }
    case 'DISMISS':
      return state.map((n) => (n.id === action.id ? { ...n, dismissed: true } : n));
    case 'DISMISS_ALL':
      return state.map((n) => (n.dismissed ? n : { ...n, dismissed: true }));
    case 'MARK_READ':
      return state.map((n) => (n.id === action.id ? { ...n, read: true } : n));
    case 'MARK_ALL_READ':
      return state.map((n) => (n.read ? n : { ...n, read: true }));
    default:
      return state;
  }
}

function countUnread(items: NotificationItem[]): number {
  return items.filter((n) => !n.dismissed && !n.read).length;
}

interface NotificationContextValue {
  notifications: NotificationItem[];
  unreadCount: number;
  add: (payload: AddNotificationPayload) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  add: () => '',
  dismiss: () => {},
  dismissAll: () => {},
  markRead: () => {},
  markAllRead: () => {},
});

export function useNotificationStore() {
  return useContext(NotificationContext);
}

// ── External API for class components / non-React code ────────────────────────

type AddFn = (payload: AddNotificationPayload) => string;
let externalAdd: AddFn | null = null;

/**
 * Add a notification from outside a React component (e.g. error boundaries).
 * Falls back to dispatching a CustomEvent on window if the store isn't mounted.
 */
export function addNotification(payload: AddNotificationPayload): string {
  if (externalAdd) {
    return externalAdd(payload);
  }

  // Fallback: fire a CustomEvent that the provider listens for.
  const id = generateId();
  window.dispatchEvent(
    new CustomEvent('pa-notification', {
      detail: { ...payload, _id: id },
    }),
  );
  return id;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, []);
  const externalAddRef = useRef<AddFn | null>(null);

  // Register the imperative add handler so `addNotification()` works.
  useEffect(() => {
    const handler: AddFn = (payload) => {
      const id = generateId();
      dispatch({ kind: 'ADD', payload: { ...payload } });
      return id;
    };
    externalAddRef.current = handler;
    externalAdd = handler;

    return () => {
      if (externalAdd === handler) {
        externalAdd = null;
      }
    };
  }, []);

  // Listen for `pa-extension-toast` from extension frontends
  useEffect(() => {
    function handleExtensionToast(event: CustomEvent) {
      const detail = event.detail as {
        extensionId: string;
        message: string;
        type?: 'info' | 'warning' | 'error';
      };
      if (!detail.message) return;
      dispatch({
        kind: 'ADD',
        payload: {
          message: detail.message,
          type: detail.type ?? 'info',
          source: detail.extensionId,
        },
      });
    }

    window.addEventListener('pa-extension-toast', handleExtensionToast as EventListener);
    return () => window.removeEventListener('pa-extension-toast', handleExtensionToast as EventListener);
  }, []);

  // Listen for `pa-notification` from core code / error boundaries
  useEffect(() => {
    function handleNotification(event: CustomEvent) {
      const detail = event.detail as AddNotificationPayload & { _id?: string };
      if (!detail.message) return;
      dispatch({ kind: 'ADD', payload: { type: detail.type, message: detail.message, details: detail.details, source: detail.source } });
    }

    window.addEventListener('pa-notification', handleNotification as EventListener);
    return () => window.removeEventListener('pa-notification', handleNotification as EventListener);
  }, []);

  const add = useCallback((payload: AddNotificationPayload): string => {
    const id = generateId();
    dispatch({ kind: 'ADD', payload });
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    dispatch({ kind: 'DISMISS', id });
  }, []);

  const dismissAll = useCallback(() => {
    dispatch({ kind: 'DISMISS_ALL' });
  }, []);

  const markRead = useCallback((id: string) => {
    dispatch({ kind: 'MARK_READ', id });
  }, []);

  const markAllRead = useCallback(() => {
    dispatch({ kind: 'MARK_ALL_READ' });
  }, []);

  const value: NotificationContextValue = {
    notifications: state,
    unreadCount: countUnread(state),
    add,
    dismiss,
    dismissAll,
    markRead,
    markAllRead,
  };

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
