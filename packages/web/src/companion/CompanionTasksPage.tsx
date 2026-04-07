import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAppData, useSseConnection } from '../contexts';
import { useCompanionTopBarAction } from './CompanionLayout';
import { formatTaskSchedule } from '../taskSchedule';
import type { ScheduledTaskSummary } from '../types';
import { timeAgo } from '../utils';
import { buildCompanionTaskPath } from './routes';

function statusDotClass(task: ScheduledTaskSummary): string {
  if (task.running) return 'bg-accent animate-pulse';
  if (task.lastStatus === 'success') return 'bg-success';
  if (task.lastStatus === 'failure') return 'bg-danger';
  if (!task.enabled) return 'bg-border-default';
  return 'bg-border-default/60';
}

function statusText(task: ScheduledTaskSummary): { text: string; className: string } {
  if (task.running) return { text: 'running', className: 'text-accent' };
  if (task.lastStatus === 'success') return { text: 'ok', className: 'text-success' };
  if (task.lastStatus === 'failure') return { text: 'failed', className: 'text-danger' };
  if (!task.enabled) return { text: 'disabled', className: 'text-dim' };
  return { text: 'pending', className: 'text-dim' };
}

function sortTasks(tasks: ScheduledTaskSummary[]): ScheduledTaskSummary[] {
  return [...tasks].sort((left, right) => {
    if (Boolean(left.running) !== Boolean(right.running)) {
      return left.running ? -1 : 1;
    }

    const leftFailed = left.lastStatus === 'failure';
    const rightFailed = right.lastStatus === 'failure';
    if (leftFailed !== rightFailed) {
      return leftFailed ? -1 : 1;
    }

    if (Boolean(left.enabled) !== Boolean(right.enabled)) {
      return left.enabled ? -1 : 1;
    }

    return (right.lastRunAt ?? '').localeCompare(left.lastRunAt ?? '') || left.id.localeCompare(right.id);
  });
}

function previewTaskPrompt(prompt: string): string {
  const normalized = prompt
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .trim();

  return normalized.split('\n').find((line) => line.trim().length > 0)?.trim() ?? 'No prompt body.';
}

export function CompanionTasksPage() {
  const { tasks, setTasks } = useAppData();
  const { status: sseStatus } = useSseConnection();
  const { setTopBarAction } = useCompanionTopBarAction();
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const sortedTasks = useMemo(() => sortTasks(tasks ?? []), [tasks]);
  const runningCount = sortedTasks.filter((task) => task.running).length;
  const failureCount = sortedTasks.filter((task) => task.lastStatus === 'failure').length;
  const isLoading = tasks === null && sseStatus !== 'offline';

  const refreshTasks = useCallback(async () => {
    setRefreshing(true);
    setActionError(null);
    try {
      const next = await api.tasks();
      setTasks(next);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }, [setTasks]);

  useEffect(() => {
    setTopBarAction(
      <button
        key="refresh"
        type="button"
        onClick={() => { void refreshTasks(); }}
        disabled={refreshing}
        className="rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
      >
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>,
    );
    return () => setTopBarAction(undefined);
  }, [refreshTasks, refreshing, setTopBarAction]);

  const handleToggleTask = useCallback(async (task: ScheduledTaskSummary) => {
    if (busyTaskId) {
      return;
    }

    setBusyTaskId(task.id);
    setActionError(null);
    try {
      await api.setTaskEnabled(task.id, !task.enabled);
      const next = await api.tasks();
      setTasks(next);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyTaskId(null);
    }
  }, [busyTaskId, setTasks]);

  const handleRunTask = useCallback(async (task: ScheduledTaskSummary) => {
    if (busyTaskId) {
      return;
    }

    setBusyTaskId(task.id);
    setActionError(null);
    try {
      await api.runTaskNow(task.id);
      const next = await api.tasks();
      setTasks(next);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyTaskId(null);
    }
  }, [busyTaskId, setTasks]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-4">
          {isLoading ? <p className="px-4 text-[13px] text-dim">Loading tasks…</p> : null}
          {!isLoading && actionError ? <p className="px-4 text-[13px] text-danger">Unable to update tasks: {actionError}</p> : null}
          {!isLoading && !actionError && sortedTasks.length === 0 ? (
            <div className="px-4 pt-5">
              <p className="text-[15px] text-primary">No scheduled tasks yet.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                Create tasks from the main workspace and they will show up here automatically.
              </p>
            </div>
          ) : null}
          {!isLoading && sortedTasks.length > 0 ? (
            <div className="border-y border-border-subtle">
              {sortedTasks.map((task) => {
                const busy = busyTaskId === task.id;
                const status = statusText(task);

                return (
                  <div key={task.id} className="border-b border-border-subtle px-4 py-3.5 last:border-b-0">
                    <div className="flex items-start gap-3">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${statusDotClass(task)}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <Link to={buildCompanionTaskPath(task.id)} className="truncate text-[15px] font-medium leading-tight text-primary hover:text-accent">
                              {task.id}
                            </Link>
                            <p className="mt-1 text-[12px] leading-relaxed text-secondary">{previewTaskPrompt(task.prompt)}</p>
                            <p className="mt-2 break-words text-[11px] text-dim">
                              <span className={status.className}>{status.text}</span>
                              {(task.cron || task.at) ? (
                                <>
                                  <span className="mx-1.5 opacity-40">·</span>
                                  {formatTaskSchedule(task)}
                                </>
                              ) : null}
                              {task.lastRunAt ? (
                                <>
                                  <span className="mx-1.5 opacity-40">·</span>
                                  last run {timeAgo(task.lastRunAt)}
                                </>
                              ) : null}
                            </p>
                          </div>
                          <Link to={buildCompanionTaskPath(task.id)} className="shrink-0 rounded-full border border-border-default px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-secondary transition-colors hover:text-primary">
                            open
                          </Link>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => { void handleRunTask(task); }}
                            disabled={busy || task.running}
                            className="rounded-full bg-accent px-3 py-1.5 text-[11px] font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-45"
                          >
                            {task.running ? 'Running…' : busy ? 'Working…' : 'Run now'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { void handleToggleTask(task); }}
                            disabled={busy || task.running}
                            className="rounded-full border border-border-default px-3 py-1.5 text-[11px] font-medium text-secondary transition-colors hover:text-primary disabled:cursor-default disabled:opacity-45"
                          >
                            {task.enabled ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
