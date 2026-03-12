import { sessionNeedsAttention } from '../sessionIndicators';
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
        className={cx('font-medium text-accent', className)}
        title="Agent is still running"
      >
        running
      </span>
    );
  }

  if (!sessionNeedsAttention({ isRunning, needsAttention })) {
    return null;
  }

  return (
    <span
      className={cx('font-medium text-warning', className)}
      title="Stopped with new output or linked updates you have not viewed yet"
    >
      needs review
    </span>
  );
}
