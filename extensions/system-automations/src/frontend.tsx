import type { NativeExtensionClient } from '@personal-agent/extensions';
import type { ScheduledTaskSchedulerHealth, ScheduledTaskSummary } from '@personal-agent/extensions/data';
import { timeAgo } from '@personal-agent/extensions/data';
import {
  AppPageIntro,
  AppPageLayout,
  cx,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  ToolbarButton,
} from '@personal-agent/extensions/ui';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface AutomationFormState {
  title: string;
  prompt: string;
  scheduleType: 'cron' | 'at';
  cron: string;
  at: string;
  cwd: string;
  targetType: 'background-agent' | 'conversation';
  threadMode: 'dedicated' | 'existing' | 'none';
  threadConversationId: string;
  model: string;
  timeoutSeconds: string;
  catchUpWindowSeconds: string;
  enabled: boolean;
}

type AutomationFilter = 'all' | 'current' | 'past-due' | 'failed' | 'disabled';

const FILTER_LABELS: Record<AutomationFilter, string> = {
  all: 'All',
  current: 'Current',
  'past-due': 'Past due',
  failed: 'Failed',
  disabled: 'Disabled',
};

const emptyForm: AutomationFormState = {
  title: '',
  prompt: '',
  scheduleType: 'cron',
  cron: '0 9 * * 1-5',
  at: '',
  cwd: '',
  targetType: 'background-agent',
  threadMode: 'dedicated',
  threadConversationId: '',
  model: '',
  timeoutSeconds: '',
  catchUpWindowSeconds: '',
  enabled: true,
};

function taskName(task: Pick<ScheduledTaskSummary, 'id' | 'title'>) {
  return (task.title || '').trim() || task.id;
}

function isFailedTask(task: ScheduledTaskSummary) {
  return task.lastStatus === 'failed' || task.lastStatus === 'failure';
}

function taskRank(task: ScheduledTaskSummary) {
  if (task.running) return 0;
  if (isFailedTask(task)) return 1;
  if (task.enabled) return 2;
  return 3;
}

function sortTasks(tasks: ScheduledTaskSummary[]) {
  return [...tasks].sort(
    (a, b) =>
      taskRank(a) - taskRank(b) ||
      String(b.lastRunAt || '').localeCompare(String(a.lastRunAt || '')) ||
      taskName(a).localeCompare(taskName(b)),
  );
}

function sortPastDueTasks(tasks: ScheduledTaskSummary[]) {
  return [...tasks].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')) || taskName(a).localeCompare(taskName(b)));
}

function oneTimeTaskAtMs(task: Pick<ScheduledTaskSummary, 'at'>) {
  const scheduledAt = task.at?.trim();
  if (!scheduledAt) return null;
  const atMs = Date.parse(scheduledAt);
  return Number.isFinite(atMs) ? atMs : null;
}

function isPastDueOneTimeTask(task: ScheduledTaskSummary, nowMs = Date.now()) {
  if (task.enabled === false || task.running || task.lastRunAt) return false;
  const atMs = oneTimeTaskAtMs(task);
  return atMs !== null && atMs <= nowMs;
}

function statusText(task: ScheduledTaskSummary, nowMs = Date.now()) {
  if (task.running) return 'Running';
  if (isPastDueOneTimeTask(task, nowMs)) return 'Past due';
  if (!task.enabled) return 'Disabled';
  if (isFailedTask(task)) return 'Needs attention';
  if (task.lastStatus === 'success') return 'Active';
  return task.cron || task.at ? 'Active' : 'Manual';
}

function statusClass(task: ScheduledTaskSummary, nowMs = Date.now()) {
  if (task.running) return 'bg-accent border-accent';
  if (isPastDueOneTimeTask(task, nowMs)) return 'bg-warning border-warning';
  if (!task.enabled) return 'opacity-40';
  if (isFailedTask(task)) return 'bg-danger border-danger';
  if (task.lastStatus === 'success') return 'bg-success border-success';
  return 'border-secondary';
}

function statusTextClass(task: ScheduledTaskSummary, nowMs = Date.now()) {
  if (task.running) return 'text-accent';
  if (isPastDueOneTimeTask(task, nowMs)) return 'text-warning';
  if (!task.enabled) return 'text-dim';
  if (isFailedTask(task)) return 'text-danger';
  return 'text-success';
}

function scheduleText(task: ScheduledTaskSummary) {
  if (task.cron) return `Cron ${task.cron}`;
  if (task.at) return `Once ${task.at}`;
  return 'Manual';
}

function taskScopeText(task: ScheduledTaskSummary) {
  return task.cwd?.split('/').filter(Boolean).at(-1) ?? task.threadTitle ?? task.threadConversationId ?? '';
}

function taskScheduleSummary(task: ScheduledTaskSummary) {
  if (task.cron === '0 2 * * *') return 'Daily at 02:00';
  if (task.cron === '0 * * * *') return 'Every hour';
  if (task.cron?.startsWith('0 */')) {
    const hours = task.cron.match(/^0 \*\/(\d+) \* \* \*$/)?.[1];
    if (hours) return `Every ${hours}h on the hour`;
  }
  return scheduleText(task);
}

function taskLastRunText(task: ScheduledTaskSummary, nowMs = Date.now()) {
  if (isPastDueOneTimeTask(task, nowMs)) return 'Scheduled time passed';
  return task.lastRunAt ? `Last run ${timeAgo(task.lastRunAt)}` : 'Not run yet';
}

function taskTargetLabel(task: ScheduledTaskSummary) {
  return task.targetType === 'conversation' ? 'Thread' : 'Job';
}

function taskSearchText(task: ScheduledTaskSummary) {
  return [
    task.id,
    task.title,
    task.prompt,
    task.cron,
    task.at,
    task.cwd,
    task.threadConversationId,
    task.threadTitle,
    task.targetType,
    taskScheduleSummary(task),
    taskLastRunText(task),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matchesAutomationFilter(task: ScheduledTaskSummary, filter: AutomationFilter, nowMs: number) {
  switch (filter) {
    case 'all':
      return true;
    case 'current':
      return !isPastDueOneTimeTask(task, nowMs);
    case 'past-due':
      return isPastDueOneTimeTask(task, nowMs);
    case 'failed':
      return isFailedTask(task);
    case 'disabled':
      return task.enabled === false;
    default:
      return true;
  }
}

function numberOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formFromTask(task: ScheduledTaskSummary): AutomationFormState {
  return {
    title: task.title || '',
    prompt: task.prompt || '',
    scheduleType: task.at ? 'at' : 'cron',
    cron: task.cron || (task.at ? '' : '0 9 * * 1-5'),
    at: task.at || '',
    cwd: task.cwd || '',
    targetType: task.targetType === 'conversation' ? 'conversation' : 'background-agent',
    threadMode: 'dedicated',
    threadConversationId: task.threadConversationId || '',
    model: task.model || '',
    timeoutSeconds: '',
    catchUpWindowSeconds: task.catchUpWindowSeconds ? String(task.catchUpWindowSeconds) : '',
    enabled: task.enabled !== false,
  };
}

function readFormInput(form: AutomationFormState) {
  return {
    title: form.title.trim(),
    enabled: form.enabled,
    prompt: form.prompt.trim(),
    cron: form.scheduleType === 'cron' ? form.cron.trim() : null,
    at: form.scheduleType === 'at' ? form.at.trim() : null,
    cwd: form.cwd.trim() || null,
    targetType: form.targetType,
    threadMode: form.threadMode,
    threadConversationId: form.threadConversationId.trim() || null,
    model: form.model.trim() || null,
    timeoutSeconds: numberOrNull(form.timeoutSeconds),
    catchUpWindowSeconds: numberOrNull(form.catchUpWindowSeconds),
  };
}

function schedulerHealthLabel(health: ScheduledTaskSchedulerHealth | null) {
  if (!health?.lastEvaluatedAt) {
    return 'Scheduler has not checked automations yet.';
  }
  return health.status === 'stale'
    ? `Scheduler stale. Last checked ${timeAgo(health.lastEvaluatedAt)}.`
    : `Scheduler healthy. Last checked ${timeAgo(health.lastEvaluatedAt)}.`;
}

function SchedulerHealthDot({ health }: { health: ScheduledTaskSchedulerHealth | null }) {
  const label = schedulerHealthLabel(health);
  const statusClass = health?.status === 'stale' ? 'bg-warning' : health?.status === 'healthy' ? 'bg-success' : 'bg-dim';
  return (
    <span
      tabIndex={0}
      title={label}
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-secondary outline-none transition-colors hover:bg-surface/40 focus:bg-surface/40"
    >
      <span className={cx('h-2.5 w-2.5 rounded-full', statusClass)} />
    </span>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1.5 text-[12px] text-secondary">
      <span className="font-medium text-primary">{label}</span>
      {children}
      {hint ? <span className="text-[11px] leading-5 text-dim">{hint}</span> : null}
    </label>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border-subtle pt-5">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-dim">{title}</h3>
      {children}
    </section>
  );
}

function fieldClass() {
  return 'w-full rounded-lg border border-border-subtle bg-base px-3 py-2 text-[13px] text-primary outline-none focus:border-accent';
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="currentColor">
      <circle cx="3" cy="8" r="1.2" />
      <circle cx="8" cy="8" r="1.2" />
      <circle cx="13" cy="8" r="1.2" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M6 4h6v6" />
      <path d="M12 4 5 11" />
      <path d="M3.5 6.5v6h6" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3.5 11.8 4 9.5 10.8 2.7a1.4 1.4 0 0 1 2 2L6 11.5l-2.5.3Z" />
      <path d="M9.6 4 12 6.4" />
      <path d="M3 13h10" />
    </svg>
  );
}

function RunIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="currentColor">
      <path d="M5 3.2v9.6L12.6 8 5 3.2Z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12.5 7.5a4.5 4.5 0 1 1-1.2-3.1" />
      <path d="M10 2.8h3v3" />
    </svg>
  );
}

function TaskActionsMenu({
  task,
  busy,
  logOpen,
  onToggleLog,
  onDelete,
}: {
  task: ScheduledTaskSummary;
  busy: boolean;
  logOpen: boolean;
  onToggleLog: () => void;
  onDelete: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const menuButtonClass =
    'w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-secondary hover:bg-base hover:text-primary disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div ref={rootRef} className="relative" onClick={(event) => event.stopPropagation()}>
      <IconButton
        compact
        disabled={busy}
        title={`More actions for ${taskName(task)}`}
        aria-label={`More actions for ${taskName(task)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <MoreIcon />
      </IconButton>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-40 rounded-xl border border-border-subtle bg-surface p-1.5 shadow-xl" role="menu">
          <button
            type="button"
            className={menuButtonClass}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onToggleLog();
            }}
          >
            {logOpen ? 'Hide log' : 'Show log'}
          </button>
          <button
            type="button"
            className={cx(menuButtonClass, 'text-danger hover:text-danger')}
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onDelete();
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AutomationTable({
  tasks,
  logById,
  busy,
  nowMs,
  onRunTask,
  onOpenEditor,
  onToggleLog,
  onDeleteTask,
}: {
  tasks: ScheduledTaskSummary[];
  logById: Record<string, string>;
  busy: string | null;
  nowMs: number;
  onRunTask: (taskId: string) => void;
  onOpenEditor: (task: ScheduledTaskSummary) => void;
  onToggleLog: (taskId: string) => void;
  onDeleteTask: (task: ScheduledTaskSummary) => void;
}) {
  return (
    <section className="min-w-0 overflow-auto">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead className="sticky top-0 z-10 bg-base/95 backdrop-blur">
          <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">
            <th className="py-2 pr-4 font-semibold">Name</th>
            <th className="py-2 px-3 font-semibold">Schedule</th>
            <th className="py-2 px-3 font-semibold">Status</th>
            <th className="py-2 pl-3 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const scope = taskScopeText(task);
            const taskBusy = busy === `run:${task.id}` || busy === `delete:${task.id}`;
            return (
              <Fragment key={task.id}>
                <tr className="group border-t border-border-subtle/70 transition-colors hover:bg-surface/30">
                  <td className="min-w-0 py-3 pr-4 align-middle">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full border', statusClass(task, nowMs))} />
                        <div className="truncate text-[14px] font-semibold text-primary">{taskName(task)}</div>
                      </div>
                      <div className="mt-0.5 max-w-[44rem] whitespace-normal break-words text-[12px] leading-5 text-secondary">
                        {task.prompt || 'No prompt summary.'}
                      </div>
                      <div className="mt-1 text-[11px] text-dim">
                        {task.id} · {taskTargetLabel(task)}
                        {scope ? ` · ${scope}` : ''}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <div className="text-[13px] text-primary">{taskScheduleSummary(task)}</div>
                    <div className="mt-0.5 break-all font-mono text-[11px] text-dim">{task.cron ?? task.at ?? 'Manual'}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-middle">
                    <div className={cx('text-[12px]', statusTextClass(task, nowMs))}>{statusText(task, nowMs)}</div>
                    <div className="mt-0.5 text-[12px] text-secondary">{taskLastRunText(task, nowMs)}</div>
                  </td>
                  <td className="py-3 pl-3 align-middle">
                    <div className="flex items-center justify-end gap-1.5">
                      {taskBusy ? <span className="text-[11px] text-dim">Working…</span> : null}
                      {task.threadConversationId ? (
                        <a
                          className="ui-icon-button ui-icon-button-compact"
                          href={`/conversations/${encodeURIComponent(task.threadConversationId)}`}
                          title={`Open thread for ${taskName(task)}`}
                          aria-label={`Open thread for ${taskName(task)}`}
                        >
                          <OpenIcon />
                        </a>
                      ) : null}
                      <IconButton
                        compact
                        disabled={taskBusy}
                        title={`Run ${taskName(task)} now`}
                        aria-label={`Run ${taskName(task)} now`}
                        onClick={() => onRunTask(task.id)}
                      >
                        <RunIcon />
                      </IconButton>
                      <IconButton
                        compact
                        disabled={taskBusy}
                        title={`Edit ${taskName(task)}`}
                        aria-label={`Edit ${taskName(task)}`}
                        onClick={() => onOpenEditor(task)}
                      >
                        <EditIcon />
                      </IconButton>
                      <TaskActionsMenu
                        task={task}
                        busy={taskBusy}
                        logOpen={Boolean(logById[task.id])}
                        onToggleLog={() => onToggleLog(task.id)}
                        onDelete={() => onDeleteTask(task)}
                      />
                    </div>
                  </td>
                </tr>
                {logById[task.id] ? (
                  <tr className="border-t border-border-subtle/40 bg-surface/20">
                    <td colSpan={4} className="px-4 py-3">
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap border-l-2 border-border-subtle pl-3 text-[12px] leading-5 text-secondary">
                        {logById[task.id]}
                      </pre>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function SectionHeader({ title, count, tone = 'default' }: { title: string; count: string; tone?: 'default' | 'warning' }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-[18px] font-semibold tracking-tight text-primary">{title}</h2>
      <span className={cx('text-[12px]', tone === 'warning' ? 'text-warning' : 'text-dim')}>{count}</span>
    </div>
  );
}

export function AutomationsPage({ pa }: { pa: NativeExtensionClient }) {
  const [tasks, setTasks] = useState<ScheduledTaskSummary[]>([]);
  const [health, setHealth] = useState<ScheduledTaskSchedulerHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<AutomationFormState>(emptyForm);
  const [logById, setLogById] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<AutomationFilter>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setError(null);
    const [nextTasks, nextHealth] = await Promise.all([pa.automations.list(), pa.automations.readSchedulerHealth()]);
    setTasks(sortTasks(Array.isArray(nextTasks) ? nextTasks : []));
    setHealth(nextHealth as ScheduledTaskSchedulerHealth);
    setLoading(false);
  }, [pa]);

  useEffect(() => {
    void load().catch((err: Error) => {
      setError(err.message);
      setLoading(false);
      pa.ui.notify({ type: 'error', message: `Failed to load automations: ${err.message}`, source: 'system-automations' });
    });
  }, [load, pa]);

  const reload = useCallback(async () => {
    setBusy('reload');
    setNotice(null);
    try {
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      pa.ui.notify({ type: 'error', message: `Failed to reload automations: ${msg}`, source: 'system-automations' });
    } finally {
      setBusy(null);
    }
  }, [load, pa]);

  const openEditor = useCallback((task?: ScheduledTaskSummary) => {
    setEditingId(task?.id ?? null);
    setEditorOpen(true);
    setForm(task ? formFromTask(task) : { ...emptyForm });
    setNotice(null);
  }, []);

  const closeEditor = useCallback(() => {
    setEditingId(null);
    setEditorOpen(false);
    setForm(emptyForm);
  }, []);

  const save = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy('save');
      try {
        if (editingId) {
          await pa.automations.update(editingId, readFormInput(form));
          setNotice('Automation updated.');
        } else {
          await pa.automations.create(readFormInput(form));
          setNotice('Automation created.');
        }
        closeEditor();
        await load();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        pa.ui.notify({ type: 'error', message: `Failed to save automation: ${msg}`, source: 'system-automations' });
      } finally {
        setBusy(null);
      }
    },
    [closeEditor, editingId, form, load, pa],
  );

  const runTask = useCallback(
    async (taskId: string) => {
      setBusy(`run:${taskId}`);
      try {
        await pa.automations.run(taskId);
        setNotice('Automation run started.');
        await load();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        pa.ui.notify({ type: 'error', message: `Failed to run automation: ${msg}`, source: 'system-automations' });
      } finally {
        setBusy(null);
      }
    },
    [load, pa],
  );

  const deleteTask = useCallback(
    async (task: Pick<ScheduledTaskSummary, 'id' | 'title'>) => {
      const confirmed = await pa.ui.confirm({
        title: 'Delete automation',
        message: `Delete ${taskName(task)}? This cannot be undone.`,
      });
      if (!confirmed) return;

      setBusy(`delete:${task.id}`);
      try {
        await pa.automations.delete(task.id);
        setNotice('Automation deleted.');
        if (editingId === task.id) {
          closeEditor();
        }
        await load();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        pa.ui.notify({ type: 'error', message: `Failed to delete automation: ${msg}`, source: 'system-automations' });
      } finally {
        setBusy(null);
      }
    },
    [closeEditor, editingId, load, pa],
  );

  const toggleLog = useCallback(
    async (taskId: string) => {
      if (logById[taskId]) {
        setLogById((prev) => {
          const next = { ...prev };
          delete next[taskId];
          return next;
        });
        return;
      }
      setLogById((prev) => ({ ...prev, [taskId]: 'Loading log…' }));
      try {
        const result = (await pa.automations.readLog(taskId)) as { log?: string };
        setLogById((prev) => ({ ...prev, [taskId]: result.log || 'No log yet.' }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLogById((prev) => ({
          ...prev,
          [taskId]: message.includes('No log available') ? 'No log yet.' : `Could not read log: ${message}`,
        }));
      }
    },
    [logById, pa],
  );

  const enabledCount = useMemo(() => tasks.filter((task) => task.enabled !== false).length, [tasks]);
  const enabledLabel = useMemo(() => (enabledCount === 1 ? '1 enabled' : `${enabledCount} enabled`), [enabledCount]);
  const countLabel = useMemo(() => (tasks.length === 1 ? '1 automation' : `${tasks.length} automations`), [tasks.length]);
  const nowMs = Date.now();
  const allPastDueTasks = useMemo(() => sortPastDueTasks(tasks.filter((task) => isPastDueOneTimeTask(task, nowMs))), [tasks, nowMs]);
  const pastDueLabel = allPastDueTasks.length === 1 ? '1 past due' : `${allPastDueTasks.length} past due`;

  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (!matchesAutomationFilter(task, filter, nowMs)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return taskSearchText(task).includes(normalizedQuery);
    });
  }, [filter, nowMs, query, tasks]);

  const visibleCurrentTasks = useMemo(() => filteredTasks.filter((task) => !isPastDueOneTimeTask(task, nowMs)), [filteredTasks, nowMs]);
  const visiblePastDueTasks = useMemo(
    () => sortPastDueTasks(filteredTasks.filter((task) => isPastDueOneTimeTask(task, nowMs))),
    [filteredTasks, nowMs],
  );
  const shouldSplitSections = filter === 'all';

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <LoadingState label="Loading automations…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <ErrorState message={error} />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="space-y-10">
        {!editorOpen && (
          <>
            <AppPageIntro
              title="Automations"
              summary="Scheduled prompts and background jobs that run without babysitting."
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <ToolbarButton onClick={() => openEditor()}>New automation</ToolbarButton>
                  <IconButton title="Reload automations" aria-label="Reload automations" onClick={() => void reload()}>
                    <RefreshIcon />
                  </IconButton>
                  <SchedulerHealthDot health={health} />
                </div>
              }
            />

            {notice ? (
              <div className="sticky top-0 z-20 border-b border-border-subtle/60 bg-base/95 py-2 text-[13px] text-secondary backdrop-blur">
                {notice}
              </div>
            ) : null}
          </>
        )}

        {editorOpen && (
          <form className="space-y-6" onSubmit={save}>
            <div className="flex items-start justify-between gap-4 border-b border-border-subtle pb-5">
              <div className="min-w-0">
                <p className="text-[13px] text-secondary">← Automations</p>
                <h2 className="mt-6 text-[32px] font-semibold tracking-tight text-primary">
                  {editingId ? 'Edit automation' : 'New automation'}
                </h2>
                <p className="mt-2 text-[13px] text-secondary">Define the schedule, runtime, and delivery target.</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <ToolbarButton type="submit" disabled={busy === 'save'}>
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </ToolbarButton>
                <ToolbarButton type="button" onClick={closeEditor}>
                  Cancel
                </ToolbarButton>
              </div>
            </div>

            <FormSection title="Basics">
              <div className="grid gap-4">
                <Field label="Title">
                  <input
                    className={fieldClass()}
                    required
                    value={form.title}
                    onChange={(event) => setForm({ ...form, title: event.target.value })}
                  />
                </Field>
                <Field label="Prompt" hint="This is the exact instruction sent when the automation runs.">
                  <textarea
                    className={fieldClass()}
                    required
                    rows={9}
                    value={form.prompt}
                    onChange={(event) => setForm({ ...form, prompt: event.target.value })}
                  />
                </Field>
                <label className="flex items-center gap-2 text-[13px] text-secondary">
                  <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
                  Enabled
                </label>
              </div>
            </FormSection>

            <FormSection title="Schedule">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Type">
                  <select
                    className={fieldClass()}
                    value={form.scheduleType}
                    onChange={(event) => setForm({ ...form, scheduleType: event.target.value as 'cron' | 'at' })}
                  >
                    <option value="cron">Recurring cron</option>
                    <option value="at">Run once</option>
                  </select>
                </Field>
                {form.scheduleType === 'cron' ? (
                  <Field label="Cron expression" hint="Five-field cron, for example 0 9 * * 1-5.">
                    <input
                      className={fieldClass()}
                      value={form.cron}
                      onChange={(event) => setForm({ ...form, cron: event.target.value })}
                    />
                  </Field>
                ) : (
                  <Field label="Run at" hint="ISO timestamp or natural phrase, depending on backend support.">
                    <input className={fieldClass()} value={form.at} onChange={(event) => setForm({ ...form, at: event.target.value })} />
                  </Field>
                )}
                {form.scheduleType === 'cron' ? (
                  <Field label="Catch-up window seconds" hint="How long a missed run remains eligible after wake.">
                    <input
                      className={fieldClass()}
                      type="number"
                      min="1"
                      value={form.catchUpWindowSeconds}
                      onChange={(event) => setForm({ ...form, catchUpWindowSeconds: event.target.value })}
                    />
                  </Field>
                ) : null}
              </div>
            </FormSection>

            <FormSection title="Delivery">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Target">
                  <select
                    className={fieldClass()}
                    value={form.targetType}
                    onChange={(event) => setForm({ ...form, targetType: event.target.value as 'background-agent' | 'conversation' })}
                  >
                    <option value="background-agent">Background job</option>
                    <option value="conversation">Conversation</option>
                  </select>
                </Field>
                <Field label="Thread mode">
                  <select
                    className={fieldClass()}
                    value={form.threadMode}
                    onChange={(event) => setForm({ ...form, threadMode: event.target.value as 'dedicated' | 'existing' | 'none' })}
                  >
                    <option value="dedicated">Dedicated thread</option>
                    <option value="existing">Existing thread</option>
                    <option value="none">No thread</option>
                  </select>
                </Field>
                {form.threadMode === 'existing' ? (
                  <Field label="Thread conversation ID">
                    <input
                      className={fieldClass()}
                      value={form.threadConversationId}
                      onChange={(event) => setForm({ ...form, threadConversationId: event.target.value })}
                    />
                  </Field>
                ) : null}
              </div>
            </FormSection>

            <FormSection title="Runtime">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Working directory">
                  <input className={fieldClass()} value={form.cwd} onChange={(event) => setForm({ ...form, cwd: event.target.value })} />
                </Field>
                <Field label="Model">
                  <input
                    className={fieldClass()}
                    value={form.model}
                    onChange={(event) => setForm({ ...form, model: event.target.value })}
                  />
                </Field>
                <Field label="Timeout seconds">
                  <input
                    className={fieldClass()}
                    type="number"
                    min="1"
                    value={form.timeoutSeconds}
                    onChange={(event) => setForm({ ...form, timeoutSeconds: event.target.value })}
                  />
                </Field>
              </div>
            </FormSection>

            <div className="flex flex-wrap justify-between gap-2 border-t border-border-subtle pt-5">
              <div>
                {editingId ? (
                  <ToolbarButton
                    type="button"
                    disabled={busy === `delete:${editingId}`}
                    onClick={() => void deleteTask({ id: editingId, title: form.title })}
                  >
                    Delete
                  </ToolbarButton>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <ToolbarButton type="button" onClick={closeEditor}>
                  Cancel
                </ToolbarButton>
                <ToolbarButton type="submit" disabled={busy === 'save'}>
                  {busy === 'save' ? 'Saving…' : 'Save automation'}
                </ToolbarButton>
              </div>
            </div>
          </form>
        )}

        {!editorOpen && (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <h2 className="text-[18px] font-semibold tracking-tight text-primary">Current health</h2>
                <p className="mt-1 text-[12px] text-secondary">
                  {enabledLabel} · {countLabel}
                  {allPastDueTasks.length > 0 ? ` · ${pastDueLabel}` : ''}
                </p>
              </div>
            </div>

            {tasks.length === 0 ? (
              <EmptyState
                title="No automations yet"
                body="Create one to run scheduled or conversation-bound agent work."
                className="py-10"
              />
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-1 rounded-xl bg-surface/40 p-1">
                    {(Object.keys(FILTER_LABELS) as AutomationFilter[]).map((nextFilter) => (
                      <button
                        key={nextFilter}
                        type="button"
                        className={cx(
                          'rounded-lg px-3 py-1.5 text-[12px] transition-colors',
                          filter === nextFilter ? 'bg-surface text-primary shadow-sm' : 'text-secondary hover:text-primary',
                        )}
                        onClick={() => setFilter(nextFilter)}
                      >
                        {FILTER_LABELS[nextFilter]}
                      </button>
                    ))}
                  </div>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search automations…"
                    className="w-72 rounded-xl border border-border-subtle bg-surface/40 px-3 py-2 text-[13px] text-primary outline-none transition-colors placeholder:text-dim focus:border-accent/50"
                  />
                </div>

                {filteredTasks.length === 0 ? (
                  <EmptyState title="No matching automations" body="Adjust the filter or search query." />
                ) : shouldSplitSections ? (
                  <div className="space-y-6">
                    <section className="space-y-3">
                      <SectionHeader title="Current" count={`${visibleCurrentTasks.length} shown`} />
                      {visibleCurrentTasks.length > 0 ? (
                        <AutomationTable
                          tasks={visibleCurrentTasks}
                          logById={logById}
                          busy={busy}
                          nowMs={nowMs}
                          onRunTask={(taskId) => void runTask(taskId)}
                          onOpenEditor={openEditor}
                          onToggleLog={(taskId) => void toggleLog(taskId)}
                          onDeleteTask={(task) => void deleteTask(task)}
                        />
                      ) : (
                        <div className="py-2 text-[13px] text-secondary">No current automations.</div>
                      )}
                    </section>

                    {visiblePastDueTasks.length > 0 ? (
                      <section className="space-y-3 border-t border-border-subtle/70 pt-4">
                        <SectionHeader title="Past due" count={`${visiblePastDueTasks.length} shown`} tone="warning" />
                        <AutomationTable
                          tasks={visiblePastDueTasks}
                          logById={logById}
                          busy={busy}
                          nowMs={nowMs}
                          onRunTask={(taskId) => void runTask(taskId)}
                          onOpenEditor={openEditor}
                          onToggleLog={(taskId) => void toggleLog(taskId)}
                          onDeleteTask={(task) => void deleteTask(task)}
                        />
                      </section>
                    ) : null}
                  </div>
                ) : (
                  <AutomationTable
                    tasks={filter === 'past-due' ? visiblePastDueTasks : filteredTasks}
                    logById={logById}
                    busy={busy}
                    nowMs={nowMs}
                    onRunTask={(taskId) => void runTask(taskId)}
                    onOpenEditor={openEditor}
                    onToggleLog={(taskId) => void toggleLog(taskId)}
                    onDeleteTask={(task) => void deleteTask(task)}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </AppPageLayout>
    </div>
  );
}
