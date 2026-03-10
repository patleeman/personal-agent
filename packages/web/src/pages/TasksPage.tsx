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

function StatusDot({ task }: { task: Task }) {
  if (task.running)                    return <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" title="running" />;
  if (task.lastStatus === 'success')   return <span className="w-2 h-2 rounded-full bg-success shrink-0" title="last run succeeded" />;
  if (task.lastStatus === 'failure')   return <span className="w-2 h-2 rounded-full bg-danger shrink-0" title="last run failed" />;
  if (!task.enabled)                   return <span className="w-2 h-2 rounded-full bg-border-default shrink-0" title="disabled" />;
  return                                      <span className="w-2 h-2 rounded-full bg-border-default/50 shrink-0" title="never run" />;
}

function statusLabel(task: Task) {
  if (task.running)                  return { text: 'running',  cls: 'text-accent bg-accent/10 border-accent/20'    };
  if (task.lastStatus === 'success') return { text: 'ok',       cls: 'text-success bg-success/10 border-success/20' };
  if (task.lastStatus === 'failure') return { text: 'failed',   cls: 'text-danger bg-danger/10 border-danger/20'    };
  if (!task.enabled)                 return { text: 'disabled', cls: 'text-dim bg-elevated border-border-subtle'    };
  return                                    { text: 'pending',  cls: 'text-dim bg-elevated border-border-subtle'    };
}

// Format a cron expression into something human-readable
function cronHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, month, dow] = parts;
  if (dom === '*' && month === '*' && dow === '*') {
    if (hour === '*' && min !== '*') return `every hour at :${min.padStart(2,'0')}`;
    if (hour !== '*' && min !== '*') {
      const intervalMatch = hour.match(/^\*\/(\d+)$/);
      if (intervalMatch) return `every ${intervalMatch[1]}h at :${min.padStart(2,'0')}`;
      return `daily at ${hour.padStart(2,'0')}:${min.padStart(2,'0')}`;
    }
    if (hour === '*' && min === '*') return 'every minute';
    const intervalMatch = min.match(/^\*\/(\d+)$/);
    if (intervalMatch && hour === '*') return `every ${intervalMatch[1]} min`;
  }
  return cron;
}

export function TasksPage() {
  const { id: selectedId } = useParams<{ id?: string }>();
  const { data: tasks, loading, error, refetch } = usePolling(fetchTasks, 10_000);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
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
        <button
          onClick={refetch}
          className="text-xs text-secondary hover:text-primary transition-colors px-2 py-1 rounded hover:bg-surface"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-dim py-8">
            <span className="animate-pulse">●</span>
            <span>Loading tasks…</span>
          </div>
        )}

        {error && (
          <div className="py-8 text-sm text-danger/80">Failed to load tasks: {error}</div>
        )}

        {!loading && !error && tasks?.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-2xl mb-3">⏰</p>
            <p className="text-sm text-primary">No scheduled tasks.</p>
            <p className="text-xs text-secondary mt-1">
              Create a <code className="font-mono text-accent">*.task.md</code> file in your profile's tasks folder.
            </p>
          </div>
        )}

        {!loading && tasks?.map(task => {
          const { text: statusText, cls: statusCls } = statusLabel(task);
          const isSelected = task.id === selectedId;
          return (
            <TaskCard key={task.id} task={task} isSelected={isSelected} statusText={statusText} statusCls={statusCls} onRefetch={refetch} />
          );
        })}
      </div>
    </div>
  );
}

function TaskCard({ task, isSelected, statusText, statusCls, onRefetch }: {
  task: Task; isSelected: boolean; statusText: string; statusCls: string; onRefetch: () => void;
}) {
  const [toggling, setToggling] = useState(false);

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
            <Link key={task.id} to={`/tasks/${task.id}`}
              className={`block p-4 rounded-xl border transition-colors group ${
                isSelected
                  ? 'bg-elevated border-accent/30 ring-1 ring-accent/20'
                  : 'bg-surface border-border-subtle hover:border-border-default'
              }`}>
              {/* Top row */}
              <div className="flex items-start gap-3 mb-3">
                <StatusDot task={task} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-mono font-semibold text-primary">{task.id}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${statusCls}`}>
                      {statusText}
                    </span>
                  </div>
                  {task.prompt && (
                    <p className="text-[12px] text-secondary mt-1 leading-snug">{task.prompt}</p>
                  )}
                </div>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-4 text-[11px] text-dim flex-wrap">
                {task.cron && (
                  <span className="flex items-center gap-1.5">
                    <span className="opacity-50">⏱</span>
                    <span className="font-mono">{task.cron}</span>
                    <span className="opacity-60">({cronHuman(task.cron)})</span>
                  </span>
                )}
                {task.model && (
                  <span className="flex items-center gap-1.5">
                    <span className="opacity-50">⊕</span>
                    <span className="font-mono">{task.model.split('/').pop()}</span>
                  </span>
                )}
                {task.lastRunAt && (
                  <span>last run {timeAgo(task.lastRunAt)}</span>
                )}
                {task.lastAttemptCount !== undefined && task.lastAttemptCount > 1 && (
                  <span className="text-warning">attempt {task.lastAttemptCount}</span>
                )}
              </div>

              {/* File path + toggle */}
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[10px] font-mono text-dim/50 truncate" title={task.filePath}>{task.filePath}</p>
                <button
                  onClick={handleToggle}
                  disabled={toggling || task.running}
                  className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors disabled:opacity-40 ${
                    task.enabled
                      ? 'text-dim border-border-subtle hover:text-danger hover:border-danger/30'
                      : 'text-success border-success/30 hover:bg-success/10'
                  }`}
                >
                  {toggling ? '…' : task.enabled ? 'disable' : 'enable'}
                </button>
              </div>
            </Link>
  );
}
