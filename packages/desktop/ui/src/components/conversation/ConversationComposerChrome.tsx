import { cx } from '../ui';

export function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.75 7.5A1.5 1.5 0 0 1 5.25 6h4.018a1.5 1.5 0 0 1 1.06.44l1.172 1.17a1.5 1.5 0 0 0 1.06.44h6.19a1.5 1.5 0 0 1 1.5 1.5v7.95a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V7.5Z" />
      <path d="M3.75 9.75h16.5" />
    </svg>
  );
}

export function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5a2.25 2.25 0 0 1 2.25 2.25v6.75a2.25 2.25 0 0 1-2.25 2.25H12l-4.5 3v-3H6.75A2.25 2.25 0 0 1 4.5 13.5V6.75Z" />
    </svg>
  );
}

function FolderPlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.75 7.5A1.5 1.5 0 0 1 5.25 6h4.018a1.5 1.5 0 0 1 1.06.44l1.172 1.17a1.5 1.5 0 0 0 1.06.44h6.19a1.5 1.5 0 0 1 1.5 1.5v7.95a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V7.5Z" />
      <path d="M3.75 9.75h16.5" />
      <path d="M16.5 12.5v6" />
      <path d="M13.5 15.5h6" />
    </svg>
  );
}

export function BrowsePathButton({
  busy,
  title,
  ariaLabel,
  onClick,
}: {
  busy: boolean;
  title: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-secondary transition-colors hover:bg-surface/45 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/25 focus-visible:ring-offset-1 focus-visible:ring-offset-base disabled:opacity-50"
      title={title}
      aria-label={ariaLabel}
    >
      <FolderPlusIcon className={cx(busy && 'animate-pulse')} />
    </button>
  );
}

export function RemoteExecutionIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
    >
      <rect x="1.75" y="2" width="4.5" height="3.5" rx="1" />
      <rect x="7.75" y="8.5" width="4.5" height="3.5" rx="1" />
      <path d="M6.2 4.8h1.5c1.1 0 2 .9 2 2v1" />
      <path d="M7.9 7.8 9.7 7.8 9.7 6" />
    </svg>
  );
}

export function ComposerActionIcon({ label, className }: { label: 'Steer' | 'Follow up' | 'Parallel'; className?: string }) {
  if (label === 'Follow up') {
    return (
      <svg
        className={className}
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 14 4 9l5-5" />
        <path d="M20 20c0-6-4-11-11-11H4" />
      </svg>
    );
  }

  if (label === 'Parallel') {
    return (
      <svg
        className={className}
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 7h10" />
        <path d="M7 12h10" />
        <path d="M7 17h10" />
        <path d="m15 5 4 2-4 2" />
        <path d="m9 15-4 2 4 2" />
      </svg>
    );
  }

  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12h11" />
      <path d="m11 5 7 7-7 7" />
    </svg>
  );
}

export function resolveConversationComposerShellStateClassName({
  dragOver,
  hasInteractiveOverlay,
  autoModeEnabled,
}: {
  dragOver: boolean;
  hasInteractiveOverlay: boolean;
  autoModeEnabled: boolean;
}): string {
  if (dragOver) {
    return 'border-accent/50 ring-2 ring-accent/20 bg-accent/5';
  }

  if (hasInteractiveOverlay) {
    return 'border-accent/40 ring-1 ring-accent/15';
  }

  if (autoModeEnabled) {
    return 'border-warning/30 ring-1 ring-warning/15 ui-input-shell-auto-mode';
  }

  return 'border-border-subtle';
}
