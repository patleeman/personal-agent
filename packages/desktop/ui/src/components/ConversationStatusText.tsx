import { sessionNeedsAttention } from '../session/sessionIndicators';
import { cx } from './ui';

export function ConversationStatusText({
  isRunning,
  needsAttention,
  className,
}: {
  isRunning?: boolean;
  needsAttention?: boolean;
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
