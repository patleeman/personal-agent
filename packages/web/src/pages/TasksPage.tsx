import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePolling } from '../hooks';
import { api } from '../api';
import { timeAgo } from '../utils';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, ToolbarButton } from '../components/ui';

interface Task {
  id: string;
  filePath: string;
  scheduleType: string;
  running: boolean;
  enabled: boolean;
  cron?: string;
  prompt: string;
  model?: string;
  lastStatus?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastAttemptCount?: number;
}

async function fetchTasks(): Promise<Task[]> {
  const response = await fetch('/api/tasks');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function statusDotClass(task: Task) {
  if (task.running) return 'bg-accent animate-pulse';
  if (task.lastStatus === 'success') return 'bg-success';
  if (task.lastStatus === 'failure') return 'bg-danger';
  if (!task.enabled) return 'bg-border-default';
  return 'bg-border-default/50';
}

function statusText(task: Task): { text: string; cls: string } {
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

function TaskRow({ task, isSelected, onRefetch }: { task: Task; isSelected: boolean; onRefetch: () => void }) {
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
      to={`/tasks/${task.id}`}
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
            {running ? '…' : '▷ run'}
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
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="ui-row-title-mono">{task.id}</span>
        <span className={`text-[11px] font-mono ${cls}`}>{text}</span>
        {task.lastAttemptCount !== undefined && task.lastAttemptCount > 1 && (
          <span className="text-[11px] text-warning font-mono">attempt {task.lastAttemptCount}</span>
        )}
      </div>

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
        {task.cron && (
          <>
            <span>{cronHuman(task.cron)}</span>
            <span className="opacity-40">·</span>
          </>
        )}
        {task.lastRunAt && <span>last run {timeAgo(task.lastRunAt)}</span>}
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
  const { data: tasks, loading, error, refetch } = usePolling(fetchTasks, 10_000);

  return (
    <div className="flex flex-col h-full">
      <PageHeader actions={<ToolbarButton onClick={refetch}>↻ Refresh</ToolbarButton>}>
        <PageHeading
          title="Scheduled Tasks"
          meta={
            tasks && (
              <>
                {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
                {tasks.filter((task) => task.running).length > 0 && (
                  <span className="ml-2 text-accent animate-pulse">
                    · {tasks.filter((task) => task.running).length} running
                  </span>
                )}
              </>
            )
          }
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && <LoadingState label="Loading tasks…" />}
        {error && <ErrorState message={`Failed to load tasks: ${error}`} />}
        {!loading && !error && tasks?.length === 0 && (
          <EmptyState
            icon="⏰"
            title="No scheduled tasks."
            body={
              <>
                Create a <code className="font-mono text-accent">*.task.md</code> file in your profile&apos;s tasks folder.
              </>
            }
          />
        )}
        {!loading && tasks && (
          <div className="space-y-px">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                isSelected={task.id === selectedId}
                onRefetch={refetch}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
