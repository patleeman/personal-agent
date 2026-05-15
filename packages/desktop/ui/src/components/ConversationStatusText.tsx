import { sessionNeedsAttention } from '../session/sessionIndicators';
import { cx } from './ui';

function PendingRunsIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="pa-pending-runs-hourglass"
    >
      <path d="M6 3h12M6 21h12M7 3c0 4 2.5 6 5 9-2.5 3-5 5-5 9M17 3c0 4-2.5 6-5 9 2.5 3 5 5 5 9" />
    </svg>
  );
}

export function ConversationStatusText({
  isRunning,
  needsAttention,
  hasPendingRuns,
  className,
}: {
  isRunning?: boolean;
  needsAttention?: boolean;
  hasPendingRuns?: boolean;
  className?: string;
}) {
  if (isRunning) {
    return (
      <span
        role="img"
        aria-label="Running conversation"
        className={cx('flex h-3 w-3 items-center justify-center text-accent', className)}
        title="Agent is still running"
      >
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
      </span>
    );
  }

  if (hasPendingRuns) {
    return (
      <span
        role="img"
        aria-label="Pending background work"
        className={cx('flex h-3 w-3 items-center justify-center text-accent/80', className)}
        title="Background work is pending"
      >
        <PendingRunsIcon />
      </span>
    );
  }

  if (!sessionNeedsAttention({ isRunning, needsAttention })) {
    return null;
  }

  return (
    <span
      role="img"
      aria-label="Conversation needs review"
      className={cx('block h-2 w-2 rounded-full bg-warning', className)}
      title="Stopped with new output or linked updates you have not viewed yet"
    />
  );
}
