import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAppEvents, useAppData } from '../contexts';
import { useApi } from '../hooks';
import { formatTaskSchedule } from '../taskSchedule';
import type { ScheduledTaskDetail } from '../types';
import { timeAgo } from '../utils';
import { COMPANION_TASKS_PATH } from './routes';

interface CompanionTaskDetailData {
  task: ScheduledTaskDetail;
  log: { log: string; path: string } | null;
}

function taskStatus(task: ScheduledTaskDetail): { text: string; className: string } {
  if (task.running) return { text: 'running', className: 'text-accent' };
  if (task.lastStatus === 'success') return { text: 'ok', className: 'text-success' };
  if (task.lastStatus === 'failure') return { text: 'failed', className: 'text-danger' };
  if (!task.enabled) return { text: 'disabled', className: 'text-dim' };
  return { text: 'pending', className: 'text-dim' };
}

function summarizeLog(log: string | undefined): string[] {
  if (!log) {
    return [];
  }

  const lines = log.split('\n');
  return lines.slice(Math.max(0, lines.length - 80));
}

export function CompanionTaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { versions } = useAppEvents();
  const { setTasks } = useAppData();
  const [taskActionBusy, setTaskActionBusy] = useState<'toggle' | 'run' | null>(null);
  const [taskActionMessage, setTaskActionMessage] = useState<string | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);

  const fetchTask = useCallback(async (): Promise<CompanionTaskDetailData> => {
    if (!id) {
      throw new Error('Missing task id.');
    }

    const task = await api.taskDetail(id);
    const log = await api.taskLog(id).catch(() => null);
    return { task, log };
  }, [id]);
  const { data, loading, refreshing, error, refetch, replaceData } = useApi(fetchTask, `companion-task:${id ?? ''}:${versions.tasks}`);

  const task = data?.task ?? null;
  const status = task ? taskStatus(task) : null;
  const logLines = useMemo(() => summarizeLog(data?.log?.log), [data?.log?.log]);

  const refreshTaskList = useCallback(async () => {
    try {
      setTasks(await api.tasks());
    } catch {
      // Keep the detail page usable even if the summary refresh fails.
    }
  }, [setTasks]);

  const updateTask = useCallback(async (action: 'toggle' | 'run') => {
    if (!task || taskActionBusy) {
      return;
    }

    setTaskActionBusy(action);
    setTaskActionMessage(null);
    setTaskActionError(null);
    try {
      if (action === 'toggle') {
        await api.setTaskEnabled(task.id, !task.enabled);
      } else {
        const result = await api.runTaskNow(task.id);
        setTaskActionMessage(`Queued run ${result.runId}.`);
      }

      const next = await refetch({ resetLoading: false });
      if (next) {
        replaceData(next);
      }
      await refreshTaskList();
    } catch (actionError) {
      setTaskActionError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setTaskActionBusy(null);
    }
  }, [refetch, refreshTaskList, replaceData, task, taskActionBusy]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border-subtle bg-base/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
          <div className="flex items-center justify-between gap-3">
            <Link to={COMPANION_TASKS_PATH} className="text-[12px] font-medium text-accent">← Tasks</Link>
            <button
              type="button"
              onClick={() => { void refetch({ resetLoading: false }); }}
              disabled={refreshing}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">Scheduled task</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-primary">{task?.title ?? task?.id ?? 'Task'}</h1>
          {task && status ? (
            <>
              <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-secondary">{task.prompt.trim() || 'No prompt body.'}</p>
              <p className="mt-3 break-words text-[12px] text-dim">
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
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { void updateTask('run'); }}
                  disabled={taskActionBusy !== null || task.running}
                  className="rounded-full bg-accent px-3 py-1.5 text-[11px] font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-45"
                >
                  {task.running ? 'Running…' : taskActionBusy === 'run' ? 'Queueing…' : 'Run now'}
                </button>
                <button
                  type="button"
                  onClick={() => { void updateTask('toggle'); }}
                  disabled={taskActionBusy !== null || task.running}
                  className="rounded-full border border-border-default px-3 py-1.5 text-[11px] font-medium text-secondary transition-colors hover:text-primary disabled:cursor-default disabled:opacity-45"
                >
                  {task.enabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-6">
          {loading ? <p className="px-4 text-[13px] text-dim">Loading task…</p> : null}
          {!loading && error ? <p className="px-4 text-[13px] text-danger">Unable to load task: {error}</p> : null}
          {!loading && !error && !data ? <p className="px-4 text-[13px] text-dim">Task not found.</p> : null}
          {taskActionError ? <p className="px-4 pb-4 text-[13px] text-danger">{taskActionError}</p> : null}
          {taskActionMessage ? <p className="px-4 pb-4 text-[13px] text-success">{taskActionMessage}</p> : null}

          {task ? (
            <div className="overflow-hidden border-y border-border-subtle bg-surface/70">
              <section className="border-t border-border-subtle px-4 py-4 first:border-t-0">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">Configuration</h2>
                <div className="mt-3 grid gap-3">
                  <div className="rounded-xl bg-base/65 px-3 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Schedule</p>
                    <p className="mt-2 text-[14px] text-primary">{task.cron || task.at ? formatTaskSchedule(task) : 'No schedule'}</p>
                  </div>
                  {task.model ? (
                    <div className="rounded-xl bg-base/65 px-3 py-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Model</p>
                      <p className="mt-2 break-words text-[14px] text-primary">{task.model}</p>
                    </div>
                  ) : null}
                  {task.cwd ? (
                    <div className="rounded-xl bg-base/65 px-3 py-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Working directory</p>
                      <p className="mt-2 break-words font-mono text-[12px] text-primary">{task.cwd}</p>
                    </div>
                  ) : null}
                  {typeof task.timeoutSeconds === 'number' ? (
                    <div className="rounded-xl bg-base/65 px-3 py-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Timeout</p>
                      <p className="mt-2 text-[14px] text-primary">{task.timeoutSeconds}s</p>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="border-t border-border-subtle px-4 py-4">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">Prompt</h2>
                <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-base/65 px-3 py-3 text-[12px] leading-relaxed text-secondary">{task.prompt || 'No prompt body.'}</pre>
              </section>

              <section className="border-t border-border-subtle px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">Recent log</h2>
                  <button
                    type="button"
                    onClick={() => { void refetch({ resetLoading: false }); }}
                    disabled={refreshing}
                    className="rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    {refreshing ? 'Refreshing…' : 'Refresh log'}
                  </button>
                </div>
                {logLines.length > 0 ? (
                  <>
                    <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-base/65 px-3 py-3 font-mono text-[11px] leading-relaxed text-secondary">{logLines.join('\n')}</pre>
                    {data?.log?.path ? <p className="mt-2 break-words text-[11px] text-dim">{data.log.path}</p> : null}
                  </>
                ) : (
                  <p className="mt-3 text-[13px] text-dim">No log available for this task yet.</p>
                )}
              </section>

              <section className="border-t border-border-subtle px-4 py-4">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">Definition</h2>
                <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-base/65 px-3 py-3 font-mono text-[11px] leading-relaxed text-secondary">{task.fileContent}</pre>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
