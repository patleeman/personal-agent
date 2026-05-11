import type { ThreadGoal } from '../../shared/types';
import { cx } from '../ui';

export interface GoalPanelProps {
  goal: ThreadGoal | null;
  workingLabel?: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'text-success' },
  paused: { label: 'Paused', className: 'text-warning' },
  complete: { label: 'Complete', className: 'text-dim' },
};

export function ConversationGoalPanel({ goal, workingLabel }: GoalPanelProps) {
  if (!goal || !goal.objective || goal.status === 'complete') {
    return null;
  }

  const statusConfig = STATUS_CONFIG[goal.status] ?? STATUS_CONFIG.complete;

  return (
    <div className="border-b border-border-subtle/60 bg-surface/20 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-accent">Goal</span>
        <span className="min-w-0 flex-1 truncate text-primary">{goal.objective}</span>
        <span className={cx('shrink-0 text-[11px] font-medium', statusConfig.className)}>{statusConfig.label}</span>
        {workingLabel ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-secondary">
            <span className="inline-flex h-3 w-3 items-center justify-center text-accent" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
            </span>
            {workingLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
