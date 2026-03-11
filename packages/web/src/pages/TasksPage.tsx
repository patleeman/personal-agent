import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAppData, useSseConnection } from '../contexts';
import type { ScheduledTaskSummary } from '../types';
import { timeAgo } from '../utils';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, ToolbarButton } from '../components/ui';

function statusDotClass(task: ScheduledTaskSummary) {
  if (task.running) return 'bg-accent animate-pulse';
  if (task.lastStatus === 'success') return 'bg-success';
  if (task.lastStatus === 'failure') return 'bg-danger';
  if (!task.enabled) return 'bg-border-default';
  return 'bg-border-default/50';
}

function statusText(task: ScheduledTaskSummary): { text: string; cls: string } {
  if (task.running) return { text: 'running', cls: 'text-accent' };
  if (task.lastStatus === 'success') return { text: 'ok', cls: 'text-success' };
  if (task.lastStatus === 'failure') return { text: 'failed', cls: 'text-danger' };
  if (!task.enabled) return { text: 'disabled', cls: 'text-dim' };
  return { text: 'pending', cls: 'text-dim' };
}

function cronHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, dom, month, dow] = parts;
  if (dom === '*' && month === '*' && dow === '*') {
    if (hour === '*' && min !== '*') return `every hour at :${min.padStart(2, '0')}`;
    if (hour !== '*' && min !== '*') {
      const hourly = hour.match(/^\*\/(\d+)$/);
      if (hourly) return `every ${hourly[1]}h at :${min.padStart(2, '0')}`;
      return `daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (hour === '*' && min === '*') return 'every minute';
    const minuteStep = min.match(/^\*\/(\d+)$/);
    if (minuteStep && hour === '*') return `every ${minuteStep[1]} min`;
  }

  return cron;
}

function TaskRow({ task, isSelected, onRefetch }: { task: ScheduledTaskSummary; isSelected: boolean; onRefetch: () => void }) {
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);
  const navigate = useNavigate();
  const { text, cls } = statusText(task);

  async function handleToggle(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (toggling || task.running) return;

    setToggling(true);
    try {
      await api.setTaskEnabled(task.id, !task.enabled);
      onRefetch();
    } catch (error) {
      console.error(error);
    } finally {
      setToggling(false);
    }
  }

  async function handleRunNow(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (running || task.running) return;

    setRunning(true);
    try {
      const { sessionId } = await api.runTaskNow(task.id);
      navigate(`/conversations/${sessionId}`);
    } catch (error) {
      console.error(error);
      setRunning(false);
    }
  }

  return (
    <ListLinkRow
      to={`/scheduled/${task.id}`}
      selected={isSelected}
      leading={<span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${statusDotClass(task)}`} />}
      trailing={(
        <div className="flex items-center gap-3 shrink-0 mt-0.5">
          <button
            onClick={handleRunNow}
            disabled={running || task.running}
            title="Run now"
            className="text-[11px] font-mono text-dim hover:text-accent transition-colors disabled:opacity-40"
          >
            {running ? '…' : 'run'}
          </button>
          <button
            onClick={handleToggle}
            disabled={toggling || task.running}
            className={[
              'text-[11px] font-mono transition-colors disabled:opacity-40',
              task.enabled ? 'text-dim hover:text-danger' : 'text-success hover:text-success/70',
            ].join(' ')}
          >
            {toggling ? '…' : task.enabled ? 'disable' : 'enable'}
          </button>
        </div>
      )}
    >
      <p className="ui-row-title-mono">{task.id}</p>

      {task.prompt && (
        <p
          className="ui-row-summary line-clamp-1"
          dangerouslySetInnerHTML={{
            __html: task.prompt
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/\*\*(.+?)\*\*/g, '$1')
              .replace(/`(.+?)`/g, '<code class="font-mono text-[11px]">$1</code>'),
          }}
        />
      )}

      <p className="ui-row-meta flex items-center gap-1.5 flex-wrap">
        <span className={cls}>{text}</span>
        {task.lastAttemptCount !== undefined && task.lastAttemptCount > 1 && (
          <>
            <span className="opacity-40">·</span>
            <span className="text-warning">attempt {task.lastAttemptCount}</span>
          </>
        )}
        {task.cron && (
          <>
            <span className="opacity-40">·</span>
            <span>{cronHuman(task.cron)}</span>
          </>
        )}
        {task.lastRunAt && (
          <>
            <span className="opacity-40">·</span>
            <span>last run {timeAgo(task.lastRunAt)}</span>
          </>
        )}
        {task.model && (
          <>
            <span className="opacity-40">·</span>
            <span>{task.model.split('/').pop()}</span>
          </>
        )}
      </p>
    </ListLinkRow>
  );
}

export function TasksPage() {
  const { id: selectedId } = useParams<{ id?: string }>();
  const { tasks, setTasks } = useAppData();
  const { status: sseStatus } = useSseConnection();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const isLoading = tasks === null && (sseStatus === 'connecting' || sseStatus === 'reconnecting');
  const visibleError = tasks === null && sseStatus === 'offline'
    ? refreshError ?? 'Live updates are offline. Use refresh to load the latest scheduled tasks.'
    : refreshError;

  const refreshTasks = useCallback(async () => {
    try {
      const next = await api.tasks();
      setTasks(next);
      setRefreshError(null);
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRefreshError(message);
      return null;
    }
  }, [setTasks]);

  const runningCount = tasks?.filter((task) => task.running).length ?? 0;

  return (
    <div className="flex flex-col h-full">
      <PageHeader actions={<ToolbarButton onClick={() => { void refreshTasks(); }}>↻ Refresh</ToolbarButton>}>
        <PageHeading
          title="Scheduled"
          meta={
            tasks && (
              <>
                {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
                {runningCount > 0 && (
                  <span className="ml-2 text-accent animate-pulse">
                    · {runningCount} running
                  </span>
                )}
              </>
            )
          }
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading && <LoadingState label="Loading scheduled tasks…" />}
        {visibleError && <ErrorState message={`Failed to load scheduled tasks: ${visibleError}`} />}
        {!isLoading && !visibleError && tasks?.length === 0 && (
          <EmptyState
            title="No scheduled tasks."
            body={
              <>
                Create a <code className="font-mono text-accent">*.task.md</code> file in your profile&apos;s <code className="font-mono text-secondary">agent/tasks</code> folder.
              </>
            }
          />
        )}
        {!isLoading && tasks && (
          <div className="space-y-px">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                isSelected={task.id === selectedId}
                onRefetch={() => { void refreshTasks(); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
