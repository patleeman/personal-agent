/**
 * NotificationBell — top-bar bell icon with unread count badge.
 *
 * Opens the NotificationCenter panel on click.
 */
import { ToolbarButton } from '../ui';
import { useNotificationStore } from './notificationStore';

export function NotificationBell({ onClick }: { onClick: () => void }) {
  const { unreadCount } = useNotificationStore();

  return (
    <ToolbarButton
      className="relative"
      onClick={onClick}
      aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
      title={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unreadCount > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-[14px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold leading-4 text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      ) : null}
    </ToolbarButton>
  );
}
