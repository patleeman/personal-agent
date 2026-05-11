/**
 * NotificationCenter — slide-out overlay panel from the right.
 *
 * Shows notification history with type filtering, expandable details, and
 * bulk actions (dismiss all, mark all read).
 */
import { useMemo, useState } from 'react';

import { cx } from '../ui';
import { type NotificationItem, type NotificationType, useNotificationStore } from './notificationStore';

type FilterMode = 'all' | 'error' | 'warning' | 'info';

const FILTER_LABELS: Record<FilterMode, string> = {
  all: 'All',
  error: 'Errors',
  warning: 'Warnings',
  info: 'Info',
};

const TYPE_DOT_CLASS: Record<NotificationType, string> = {
  info: 'bg-steel',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
};

const TYPE_LABEL: Record<NotificationType, string> = {
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
};

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();

  if (diffMs < 60_000) return 'Just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function NotificationRow({
  item,
  onDismiss,
  onMarkRead,
}: {
  item: NotificationItem;
  onDismiss: (id: string) => void;
  onMarkRead: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cx('group -mx-2 rounded-lg px-2.5 py-2 transition-colors', item.read ? 'opacity-60' : 'bg-steel/5')}
      onClick={() => {
        if (!item.read) onMarkRead(item.id);
        setExpanded(!expanded);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!item.read) onMarkRead(item.id);
          setExpanded(!expanded);
        }
      }}
    >
      <div className="flex items-start gap-2.5">
        <span className={cx('mt-1 h-2 w-2 shrink-0 rounded-full', TYPE_DOT_CLASS[item.type])} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-dim">{TYPE_LABEL[item.type]}</span>
            {item.source ? <span className="text-[10px] text-steel/60">[{item.source}]</span> : null}
            <span className="ml-auto text-[10px] text-steel/50">{formatTimestamp(item.timestamp)}</span>
          </div>
          <p className="mt-0.5 text-[12px] leading-5 text-primary">{item.message}</p>
          {item.count > 1 ? <span className="mt-0.5 text-[10px] text-steel/60">Repeated {item.count} times</span> : null}
          {item.details && expanded ? (
            <pre className="mt-1.5 overflow-x-auto rounded-md bg-base/60 px-2 py-1.5 text-[11px] leading-5 text-secondary whitespace-pre-wrap break-words">
              {item.details}
            </pre>
          ) : null}
        </div>
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-steel/50 opacity-0 transition-opacity hover:text-secondary group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(item.id);
          }}
          aria-label="Dismiss notification"
          title="Dismiss"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function NotificationCenter({ onClose }: { onClose: () => void }) {
  const { notifications, unreadCount, dismiss, dismissAll, markAllRead } = useNotificationStore();
  const [filter, setFilter] = useState<FilterMode>('all');

  const filtered = useMemo(() => {
    const active = notifications.filter((n) => !n.dismissed);
    if (filter === 'all') return active;
    return active.filter((n) => n.type === filter);
  }, [notifications, filter]);

  const filterModes: FilterMode[] = ['all', 'error', 'warning', 'info'];
  const hasNotifications = notifications.some((n) => !n.dismissed);
  const hasUnread = unreadCount > 0;

  return (
    <div
      className="fixed inset-0 z-[130] flex justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative z-10 flex h-full w-[380px] max-w-[90vw] flex-col bg-surface shadow-2xl animate-slide-in-from-right">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold text-primary">Notifications</h2>
            {hasUnread ? <p className="text-[11px] text-secondary">{unreadCount} unread</p> : null}
          </div>
          <div className="flex items-center gap-1.5">
            {hasNotifications && (
              <>
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-[10px] font-medium text-dim transition-colors hover:bg-steel/10 hover:text-secondary"
                  onClick={dismissAll}
                >
                  Dismiss all
                </button>
                {hasUnread && (
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-[10px] font-medium text-dim transition-colors hover:bg-steel/10 hover:text-secondary"
                    onClick={markAllRead}
                  >
                    Mark all read
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              className="ml-1 rounded-md p-1 text-secondary transition-colors hover:bg-steel/10 hover:text-primary"
              onClick={onClose}
              aria-label="Close notifications"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex shrink-0 gap-1 border-b border-border-subtle px-3 py-2">
          {filterModes.map((mode) => {
            const count =
              mode === 'all'
                ? notifications.filter((n) => !n.dismissed).length
                : notifications.filter((n) => !n.dismissed && n.type === mode).length;
            return (
              <button
                key={mode}
                type="button"
                className={cx(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                  filter === mode ? 'bg-steel/15 text-primary' : 'text-dim hover:bg-steel/8 hover:text-secondary',
                )}
                onClick={() => setFilter(mode)}
              >
                {FILTER_LABELS[mode]}
                {count > 0 ? <span className="ml-1 text-[10px] opacity-60">({count})</span> : null}
              </button>
            );
          })}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <div>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mx-auto text-steel/30"
                  aria-hidden="true"
                >
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <p className="mt-3 text-[12px] text-dim">No {filter === 'all' ? '' : filter} notifications</p>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((item) => (
                <NotificationRow key={item.id} item={item} onDismiss={dismiss} onMarkRead={markRead} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
