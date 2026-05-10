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
  streamIsStreaming,
  autoModeEnabled,
  runMode,
}: {
  dragOver: boolean;
  hasInteractiveOverlay: boolean;
  streamIsStreaming?: boolean;
  autoModeEnabled?: boolean;
  runMode?: 'mission' | 'loop' | 'nudge' | 'manual';
}): string {
  if (dragOver) {
    return 'border-accent/50 ring-2 ring-accent/20 bg-accent/5';
  }

  if (hasInteractiveOverlay) {
    return 'border-accent/40 ring-1 ring-accent/15';
  }

  if (streamIsStreaming) {
    return 'border-accent/20 ring-1 ring-accent/8 ui-input-shell-streaming';
  }

  if (autoModeEnabled) {
    return cx(
      'border-accent/20 ring-1 ring-accent/8 ui-input-shell-auto-mode',
      runMode === 'mission' && 'ui-input-shell-mission',
      runMode === 'loop' && 'ui-input-shell-loop',
    );
  }

  return 'border-border-subtle';
}
