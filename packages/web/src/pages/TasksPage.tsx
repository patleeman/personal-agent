import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePolling } from '../hooks';
import { api } from '../api';
import { timeAgo } from '../utils';

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
  const r = await fetch('/api/tasks');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function statusDotClass(task: Task) {
  if (task.running)                  return 'bg-accent animate-pulse';
  if (task.lastStatus === 'success') return 'bg-success';
  if (task.lastStatus === 'failure') return 'bg-danger';
  if (!task.enabled)                 return 'bg-border-default';
  return 'bg-border-default/50';
}

function statusText(task: Task): { text: string; cls: string } {
  if (task.running)                  return { text: 'running',  cls: 'text-accent'  };
  if (task.lastStatus === 'success') return { text: 'ok',       cls: 'text-success' };
  if (task.lastStatus === 'failure') return { text: 'failed',   cls: 'text-danger'  };
  if (!task.enabled)                 return { text: 'disabled', cls: 'text-dim'     };
  return                                    { text: 'pending',  cls: 'text-dim'     };
}

function cronHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, month, dow] = parts;
  if (dom === '*' && month === '*' && dow === '*') {
    if (hour === '*' && min !== '*') return `every hour at :${min.padStart(2,'0')}`;
    if (hour !== '*' && min !== '*') {
      const m = hour.match(/^\*\/(\d+)$/);
      if (m) return `every ${m[1]}h at :${min.padStart(2,'0')}`;
      return `daily at ${hour.padStart(2,'0')}:${min.padStart(2,'0')}`;
    }
    if (hour === '*' && min === '*') return 'every minute';
    const m = min.match(/^\*\/(\d+)$/);
    if (m && hour === '*') return `every ${m[1]} min`;
  }
  return cron;
}

function TaskRow({ task, isSelected, onRefetch }: { task: Task; isSelected: boolean; onRefetch: () => void }) {
  const [toggling, setToggling] = useState(false);
  const { text, cls } = statusText(task);

  async function handleToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (toggling || task.running) return;
    setToggling(true);
    try {
      await api.setTaskEnabled(task.id, !task.enabled);
      onRefetch();
    } catch (err) { console.error(err); }
    finally { setToggling(false); }
  }

  return (
    <Link
      to={`/tasks/${task.id}`}
      className={`flex items-start gap-4 px-4 py-3 -mx-2 rounded-lg transition-colors group ${
        isSelected ? 'bg-surface' : 'hover:bg-surface'
      }`}
    >
      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${statusDotClass(task)}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[13px] font-mono font-semibold text-primary">{task.id}</span>
          <span className={`text-[11px] font-mono ${cls}`}>{text}</span>
          {task.lastAttemptCount !== undefined && task.lastAttemptCount > 1 && (
            <span className="text-[11px] text-warning font-mono">attempt {task.lastAttemptCount}</span>
          )}
        </div>

        {task.prompt && (
          <p
            className="text-[12px] text-secondary mt-0.5 leading-snug line-clamp-1"
            dangerouslySetInnerHTML={{
              __html: task.prompt
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/`(.+?)`/g, '<code class="font-mono text-[11px]">$1</code>'),
            }}
          />
        )}

        <p className="text-[11px] text-dim mt-0.5 font-mono flex items-center gap-1.5 flex-wrap">
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
      </div>

      <button
        onClick={handleToggle}
        disabled={toggling || task.running}
        className={`shrink-0 text-[11px] font-mono transition-colors disabled:opacity-40 mt-0.5 ${
          task.enabled
            ? 'text-dim hover:text-danger'
            : 'text-success hover:text-success/70'
        }`}
      >
        {toggling ? '…' : task.enabled ? 'disable' : 'enable'}
      </button>
    </Link>
  );
}

export function TasksPage() {
  const { id: selectedId } = useParams<{ id?: string }>();
  const { data: tasks, loading, error, refetch } = usePolling(fetchTasks, 10_000);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-base/95 backdrop-blur-sm border-b border-border-subtle px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-primary">Scheduled Tasks</h1>
          {tasks && (
            <p className="text-xs text-secondary mt-0.5 font-mono">
              {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
              {tasks.filter(t => t.running).length > 0 && (
                <span className="ml-2 text-accent animate-pulse">
                  · {tasks.filter(t => t.running).length} running
                </span>
              )}
            </p>
          )}
        </div>
        <button onClick={refetch} className="text-xs text-secondary hover:text-primary transition-colors px-2 py-1 rounded hover:bg-surface">
          ↻ Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-dim py-8">
            <span className="animate-pulse">●</span>
            <span>Loading tasks…</span>
          </div>
        )}
        {error && <div className="py-8 text-sm text-danger/80">Failed to load tasks: {error}</div>}
        {!loading && !error && tasks?.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-2xl mb-3">⏰</p>
            <p className="text-sm text-primary">No scheduled tasks.</p>
            <p className="text-xs text-secondary mt-1">
              Create a <code className="font-mono text-accent">*.task.md</code> file in your profile's tasks folder.
            </p>
          </div>
        )}
        {!loading && tasks && (
          <div className="space-y-px">
            {tasks.map(task => (
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
