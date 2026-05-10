import type { ThreadGoal } from '../../shared/types';
import { cx } from '../ui';

export interface GoalPanelProps {
  goal: ThreadGoal | null;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'text-success' },
  paused: { label: 'Paused', className: 'text-warning' },
  complete: { label: 'Complete', className: 'text-dim' },
};

const TASK_STATUS_ICON: Record<string, string> = {
  done: '✓',
  in_progress: '◷',
  blocked: '⊘',
  pending: '○',
};

const TASK_STATUS_CLASS: Record<string, string> = {
  done: 'text-success line-through opacity-55',
  in_progress: 'text-accent',
  blocked: 'text-danger',
  pending: 'text-secondary',
};

export function ConversationGoalPanel({ goal }: GoalPanelProps) {
  if (!goal || !goal.objective) {
    return null;
  }

  const statusConfig = STATUS_CONFIG[goal.status] ?? STATUS_CONFIG.complete;
  const doneTasks = goal.tasks.filter((t) => t.status === 'done').length;
  const totalTasks = goal.tasks.length;
  const taskSummary = totalTasks > 0 ? `${doneTasks}/${totalTasks} tasks` : null;

  return (
    <div className="border-b border-border-subtle/60 bg-surface/20 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-accent">Goal</span>
        <span className="min-w-0 flex-1 truncate text-primary">{goal.objective}</span>
        <span className={cx('shrink-0 text-[11px] font-medium', statusConfig.className)}>{statusConfig.label}</span>
        {taskSummary && <span className="shrink-0 text-dim">{taskSummary}</span>}
      </div>
      {goal.tasks.length > 0 && (
        <div className="mt-1.5 max-h-36 overflow-y-auto pr-1">
          {goal.tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 py-0.5 text-[12px]">
              <span
                className={cx(
                  'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border text-[8px]',
                  task.status === 'done'
                    ? 'border-success/60 bg-success/10 text-success'
                    : task.status === 'in_progress'
                      ? 'border-accent/60 bg-accent/10 text-accent'
                      : task.status === 'blocked'
                        ? 'border-danger/60 bg-danger/10 text-danger'
                        : 'border-border-default text-transparent',
                )}
              >
                {TASK_STATUS_ICON[task.status] ?? ''}
              </span>
              <span className={cx('min-w-0 flex-1 truncate', TASK_STATUS_CLASS[task.status] || 'text-primary')}>{task.description}</span>
              {task.status !== 'pending' && task.status !== 'done' ? (
                <span className="shrink-0 text-[10px] text-dim">{task.status.replace('_', ' ')}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
