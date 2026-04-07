import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAppData } from '../contexts';
import { sessionNeedsAttention } from '../sessionIndicators';
import { type ConversationLayout, CONVERSATION_LAYOUT_CHANGED_EVENT, readConversationLayout } from '../sessionTabs';
import type { ActivityEntry, AlertEntry, SessionMeta } from '../types';
import { kindMeta, timeAgo } from '../utils';
import { cx } from './ui';

const TOAST_TTL_MS = 6000;
const MAX_VISIBLE_TOASTS = 4;

const EMPTY_LAYOUT: ConversationLayout = {
  sessionIds: [],
  pinnedSessionIds: [],
  archivedSessionIds: [],
};

type NotificationTone = 'accent' | 'warning' | 'danger' | 'muted';

type NotificationToast = {
  key: string;
  href: string;
  timestamp: string;
  label: string;
  title: string;
  body: string;
  tone: NotificationTone;
};

type SurfaceItem =
  | {
      type: 'alert';
      key: string;
      sortAt: string;
      entry: AlertEntry;
    }
  | {
      type: 'activity';
      key: string;
      sortAt: string;
      entry: ActivityEntry;
    }
  | {
      type: 'conversation';
      key: string;
      sortAt: string;
      session: SessionMeta;
    };

function readLayoutSnapshot(): ConversationLayout {
  if (typeof window === 'undefined') {
    return EMPTY_LAYOUT;
  }

  return readConversationLayout();
}

function buildConversationReason(session: SessionMeta): string {
  const parts: string[] = [];

  if ((session.attentionUnreadActivityCount ?? 0) > 0) {
    const count = session.attentionUnreadActivityCount ?? 0;
    parts.push(`${count} linked update${count === 1 ? '' : 's'}`);
  }

  if ((session.attentionUnreadMessageCount ?? 0) > 0) {
    const count = session.attentionUnreadMessageCount ?? 0;
    parts.push(`${count} new message${count === 1 ? '' : 's'}`);
  }

  return parts.join(' · ') || 'Needs attention';
}

function sortAlerts(entries: AlertEntry[]): AlertEntry[] {
  return [...entries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function alertTone(entry: AlertEntry): { label: string; tone: NotificationTone } {
  if (entry.kind === 'approval-needed') {
    return { label: 'approval', tone: 'warning' };
  }

  if (entry.kind === 'reminder') {
    return { label: 'reminder', tone: 'warning' };
  }

  if (entry.kind === 'task-failed' || entry.kind === 'blocked') {
    return { label: 'failed', tone: 'danger' };
  }

  if (entry.kind === 'task-callback') {
    return { label: 'callback', tone: 'accent' };
  }

  return {
    label: entry.kind.replace(/-/g, ' '),
    tone: entry.severity === 'disruptive' ? 'accent' : 'muted',
  };
}

function activityTone(entry: ActivityEntry): { label: string; tone: NotificationTone } {
  const meta = kindMeta(entry.kind);

  if (entry.notificationState === 'failed' || entry.kind === 'blocked') {
    return { label: meta.label, tone: 'danger' };
  }

  if (entry.kind === 'follow-up' || entry.kind === 'reminder') {
    return { label: meta.label, tone: 'warning' };
  }

  if (entry.kind === 'verification' || entry.kind === 'deployment' || entry.kind === 'task-callback') {
    return { label: meta.label, tone: 'accent' };
  }

  return { label: meta.label, tone: 'muted' };
}

function toneClasses(tone: NotificationTone): string {
  switch (tone) {
    case 'danger':
      return 'border-danger/35';
    case 'warning':
      return 'border-warning/35';
    case 'accent':
      return 'border-accent/35';
    default:
      return 'border-border-subtle';
  }
}

function createToast(item: SurfaceItem): NotificationToast {
  if (item.type === 'alert') {
    const meta = alertTone(item.entry);
    return {
      key: item.key,
      href: item.entry.conversationId
        ? `/conversations/${encodeURIComponent(item.entry.conversationId)}`
        : '/inbox',
      timestamp: item.entry.updatedAt,
      label: meta.label,
      title: item.entry.title,
      body: item.entry.body,
      tone: meta.tone,
    };
  }

  if (item.type === 'activity') {
    const meta = activityTone(item.entry);
    return {
      key: item.key,
      href: `/inbox/${encodeURIComponent(item.entry.id)}`,
      timestamp: item.entry.createdAt,
      label: meta.label,
      title: item.entry.summary,
      body: item.entry.details ?? 'Open notifications for more context.',
      tone: meta.tone,
    };
  }

  return {
    key: item.key,
    href: `/conversations/${encodeURIComponent(item.session.id)}`,
    timestamp: item.session.attentionUpdatedAt ?? item.session.lastActivityAt ?? item.session.timestamp,
    label: 'conversation',
    title: item.session.title,
    body: buildConversationReason(item.session),
    tone: 'accent',
  };
}

export function NotificationCenterToaster() {
  const location = useLocation();
  const { activity, alerts, sessions } = useAppData();
  const [layout, setLayout] = useState<ConversationLayout>(() => readLayoutSnapshot());
  const [toasts, setToasts] = useState<NotificationToast[]>([]);
  const previousSurfaceKeysRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const timeoutIdsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    function handleConversationLayoutChanged() {
      setLayout(readConversationLayout());
    }

    window.addEventListener(CONVERSATION_LAYOUT_CHANGED_EVENT, handleConversationLayoutChanged);
    return () => window.removeEventListener(CONVERSATION_LAYOUT_CHANGED_EVENT, handleConversationLayoutChanged);
  }, []);

  const activeAlerts = useMemo(
    () => sortAlerts((alerts?.entries ?? []).filter((entry) => entry.status === 'active')),
    [alerts?.entries],
  );
  const activeAlertConversationIds = useMemo(
    () => new Set(activeAlerts
      .map((entry) => entry.conversationId)
      .filter((conversationId): conversationId is string => typeof conversationId === 'string' && conversationId.trim().length > 0)),
    [activeAlerts],
  );
  const activeAlertActivityIds = useMemo(
    () => new Set(activeAlerts
      .map((entry) => entry.activityId)
      .filter((activityId): activityId is string => typeof activityId === 'string' && activityId.trim().length > 0)),
    [activeAlerts],
  );
  const knownConversationIds = useMemo(
    () => new Set((sessions ?? []).map((session) => session.id)),
    [sessions],
  );
  const standaloneActivities = useMemo(
    () => (activity?.entries ?? []).filter((entry) => {
      if (entry.read || activeAlertActivityIds.has(entry.id)) {
        return false;
      }

      return !(entry.relatedConversationIds ?? []).some((conversationId) => knownConversationIds.has(conversationId));
    }),
    [activity?.entries, activeAlertActivityIds, knownConversationIds],
  );
  const workspaceConversationIdSet = useMemo(
    () => new Set([...layout.sessionIds, ...layout.pinnedSessionIds]),
    [layout.pinnedSessionIds, layout.sessionIds],
  );
  const archivedConversationIdSet = useMemo(
    () => new Set(layout.archivedSessionIds),
    [layout.archivedSessionIds],
  );
  const attentionConversations = useMemo(
    () => (sessions ?? []).filter((session) => (
      !workspaceConversationIdSet.has(session.id)
      && sessionNeedsAttention(session)
      && !archivedConversationIdSet.has(session.id)
      && !activeAlertConversationIds.has(session.id)
    )),
    [activeAlertConversationIds, archivedConversationIdSet, sessions, workspaceConversationIdSet],
  );
  const surfaceItems = useMemo<SurfaceItem[]>(() => {
    const alertItems: SurfaceItem[] = activeAlerts.map((entry) => ({
      type: 'alert',
      key: `alert:${entry.id}`,
      sortAt: entry.updatedAt,
      entry,
    }));
    const activityItems: SurfaceItem[] = standaloneActivities.map((entry) => ({
      type: 'activity',
      key: `activity:${entry.id}`,
      sortAt: entry.createdAt,
      entry,
    }));
    const conversationItems: SurfaceItem[] = attentionConversations.map((session) => ({
      type: 'conversation',
      key: `conversation:${session.id}`,
      sortAt: session.attentionUpdatedAt ?? session.lastActivityAt ?? session.timestamp,
      session,
    }));

    return [...alertItems, ...conversationItems, ...activityItems]
      .sort((left, right) => right.sortAt.localeCompare(left.sortAt));
  }, [activeAlerts, attentionConversations, standaloneActivities]);

  const dismissToast = useCallback((key: string) => {
    const timeoutId = timeoutIdsRef.current.get(key);
    if (typeof timeoutId === 'number') {
      window.clearTimeout(timeoutId);
      timeoutIdsRef.current.delete(key);
    }

    setToasts((current) => current.filter((toast) => toast.key !== key));
  }, []);

  useEffect(() => {
    return () => {
      for (const timeoutId of timeoutIdsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      timeoutIdsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const currentKeys = new Set(surfaceItems.map((item) => item.key));
    if (!initializedRef.current) {
      previousSurfaceKeysRef.current = currentKeys;
      initializedRef.current = true;
      return;
    }

    const previousKeys = previousSurfaceKeysRef.current;
    previousSurfaceKeysRef.current = currentKeys;

    if (location.pathname.startsWith('/inbox')) {
      return;
    }

    const freshToasts = surfaceItems
      .filter((item) => !previousKeys.has(item.key))
      .slice(0, MAX_VISIBLE_TOASTS)
      .map(createToast);

    if (freshToasts.length === 0) {
      return;
    }

    setToasts((current) => {
      const freshKeys = new Set(freshToasts.map((toast) => toast.key));
      const merged = [...freshToasts, ...current.filter((toast) => !freshKeys.has(toast.key))];
      const seen = new Set<string>();
      const deduped: NotificationToast[] = [];

      for (const toast of merged) {
        if (seen.has(toast.key)) {
          continue;
        }

        seen.add(toast.key);
        deduped.push(toast);
        if (deduped.length >= MAX_VISIBLE_TOASTS) {
          break;
        }
      }

      return deduped;
    });

    for (const toast of freshToasts) {
      if (timeoutIdsRef.current.has(toast.key)) {
        window.clearTimeout(timeoutIdsRef.current.get(toast.key)!);
      }

      const timeoutId = window.setTimeout(() => {
        dismissToast(toast.key);
      }, TOAST_TTL_MS);
      timeoutIdsRef.current.set(toast.key, timeoutId);
    }
  }, [dismissToast, location.pathname, surfaceItems]);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-5 top-5 z-[75] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.key}
          className={cx(
            'pointer-events-auto rounded-2xl border bg-surface/96 px-4 py-3 shadow-lg backdrop-blur',
            toneClasses(toast.tone),
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-dim">
                <span>{toast.label}</span>
                <span aria-hidden="true">•</span>
                <span>{timeAgo(toast.timestamp)}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-[14px] font-semibold text-primary">{toast.title}</p>
              <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-secondary">{toast.body}</p>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.key)}
              className="text-[12px] text-dim transition hover:text-primary"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
          <div className="mt-3 flex items-center justify-end">
            <Link
              to={toast.href}
              className="text-[12px] font-medium text-accent transition hover:opacity-80"
              onClick={() => dismissToast(toast.key)}
            >
              Open
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
