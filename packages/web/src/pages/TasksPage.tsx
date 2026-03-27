import { useCallback, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAppData, useSseConnection } from '../contexts';
import type { ScheduledTaskSummary } from '../types';
import { formatTaskSchedule } from '../taskSchedule';
import { timeAgo } from '../utils';
import { SettingsSplitLayout } from '../components/SettingsLayout';
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

function TaskRow({ task, isSelected, onRefetch }: { task: ScheduledTaskSummary; isSelected: boolean; onRefetch: () => void }) {
  const navigate = useNavigate();
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);
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
      const result = await api.runTaskNow(task.id);
      onRefetch();
      setRunning(false);
      navigate(`/runs/${encodeURIComponent(result.runId)}`);
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
        {(task.cron || task.at) && (
          <>
            <span className="opacity-40">·</span>
            <span>{formatTaskSchedule(task)}</span>
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
  const navigate = useNavigate();
  const location = useLocation();
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
  const showingCreateForm = new URLSearchParams(location.search).get('new') === '1';

  function toggleCreateTask() {
    navigate(showingCreateForm ? '/scheduled' : '/scheduled?new=1');
  }

  return (
    <SettingsSplitLayout>
      <div className="flex flex-col h-full">
        <PageHeader actions={(
        <>
          <ToolbarButton onClick={toggleCreateTask}>{showingCreateForm ? 'Close new task' : '+ New task'}</ToolbarButton>
          <ToolbarButton onClick={() => { void refreshTasks(); }}>↻ Refresh</ToolbarButton>
        </>
      )}>
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
        {!isLoading && !visibleError && tasks?.length === 0 && !showingCreateForm && (
          <EmptyState
            title="No scheduled tasks."
            body={
              <>
                Create a <code className="font-mono text-accent">*.task.md</code> file in your profile&apos;s <code className="font-mono text-secondary">agent/tasks</code> folder, or use the new-task form.
              </>
            }
            action={<ToolbarButton onClick={toggleCreateTask}>Create task</ToolbarButton>}
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
    </SettingsSplitLayout>
  );
}
