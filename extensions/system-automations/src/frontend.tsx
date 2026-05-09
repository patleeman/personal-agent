import type { NativeExtensionClient } from '@personal-agent/extensions';
import type { ScheduledTaskSchedulerHealth, ScheduledTaskSummary } from '@personal-agent/extensions/data';
import { timeAgo } from '@personal-agent/extensions/data';
import { AppPageIntro, AppPageLayout, cx, EmptyState, ErrorState, LoadingState, ToolbarButton } from '@personal-agent/extensions/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

export { TaskShelf } from './TaskShelf.js';

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

function taskName(task: ScheduledTaskSummary) {
  return (task.title || '').trim() || task.id;
}

function taskRank(task: ScheduledTaskSummary) {
  if (task.running) return 0;
  if (task.lastStatus === 'failed' || task.lastStatus === 'failure') return 1;
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

function statusText(task: ScheduledTaskSummary) {
  if (task.running) return 'Running';
  if (!task.enabled) return 'Disabled';
  if (task.lastStatus === 'failed' || task.lastStatus === 'failure') return 'Needs attention';
  if (task.lastStatus === 'success') return 'Active';
  return task.cron || task.at ? 'Active' : 'Manual';
}

function statusClass(task: ScheduledTaskSummary) {
  if (task.running) return 'bg-accent border-accent';
  if (!task.enabled) return 'opacity-40';
  if (task.lastStatus === 'failed' || task.lastStatus === 'failure') return 'bg-danger border-danger';
  if (task.lastStatus === 'success') return 'bg-success border-success';
  return 'border-secondary';
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

function taskLastRunText(task: ScheduledTaskSummary) {
  return task.lastRunAt ? `Last run ${timeAgo(task.lastRunAt)}` : 'Not run yet';
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

function HealthLine({ health }: { health: ScheduledTaskSchedulerHealth | null }) {
  if (!health?.lastEvaluatedAt) return <span>Scheduler has not checked automations yet.</span>;
  return (
    <span>
      {health.status === 'stale'
        ? `Scheduler stale. Last checked ${timeAgo(health.lastEvaluatedAt)}.`
        : `Scheduler healthy. Last checked ${timeAgo(health.lastEvaluatedAt)}.`}
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
    });
  }, [load]);

  const openEditor = useCallback((task?: ScheduledTaskSummary) => {
    setEditingId(task?.id ?? null);
    setEditorOpen(true);
    setForm(task ? formFromTask(task) : { ...emptyForm });
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
        setEditingId(null);
        setEditorOpen(false);
        setForm(emptyForm);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [editingId, form, load, pa],
  );

  const runTask = useCallback(
    async (taskId: string) => {
      setBusy(taskId);
      try {
        await pa.automations.run(taskId);
        setNotice('Automation run started.');
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [load, pa],
  );

  const deleteTask = useCallback(async () => {
    if (!editingId || !window.confirm(`Delete ${editingId}?`)) return;
    setBusy('delete');
    try {
      await pa.automations.delete(editingId);
      setNotice('Automation deleted.');
      setEditingId(null);
      setEditorOpen(false);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [editingId, load, pa]);

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
              actions={<ToolbarButton onClick={() => openEditor()}>+ New automation</ToolbarButton>}
            />

            <div className="border border-border-subtle px-4 py-4 text-[13px] text-secondary">
              <HealthLine health={health} />
            </div>

            {notice ? <div className="text-[13px] text-accent">{notice}</div> : null}
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
                <ToolbarButton
                  onClick={() => {
                    setEditingId(null);
                    setEditorOpen(false);
                    setForm(emptyForm);
                  }}
                >
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
                  <ToolbarButton type="button" disabled={busy === 'delete'} onClick={() => void deleteTask()}>
                    Delete
                  </ToolbarButton>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <ToolbarButton
                  onClick={() => {
                    setEditingId(null);
                    setEditorOpen(false);
                    setForm(emptyForm);
                  }}
                >
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
          <section>
            <div className="flex items-baseline justify-between gap-4 border-b border-border-subtle pb-4">
              <h2 className="text-[18px] font-semibold tracking-tight text-primary">Current</h2>
              <span className="text-[12px] text-dim">
                {enabledLabel} · {countLabel}
              </span>
            </div>
            {tasks.length === 0 ? (
              <EmptyState
                title="No automations yet"
                body="Create one to run scheduled or conversation-bound agent work."
                className="py-10"
              />
            ) : (
              <div>
                {tasks.map((task) => {
                  const scope = taskScopeText(task);
                  return (
                    <article key={task.id} className="group border-b border-border-subtle py-5">
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_12rem_auto] lg:items-start">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cx('h-2.5 w-2.5 rounded-full border', statusClass(task))} />
                            <h3 className="truncate text-[15px] font-semibold text-primary">{taskName(task)}</h3>
                            {scope ? <span className="truncate text-[13px] text-dim">{scope}</span> : null}
                          </div>
                          <p className="mt-1 text-[12px] text-secondary">
                            <span className={task.enabled ? 'text-success' : 'text-dim'}>{statusText(task)}</span>
                            <span className="opacity-40 mx-1.5">·</span>
                            {task.targetType === 'conversation' && task.threadConversationId ? (
                              <a
                                className="text-accent hover:underline"
                                href={`/conversations/${encodeURIComponent(task.threadConversationId)}`}
                              >
                                Thread
                              </a>
                            ) : task.targetType === 'conversation' ? (
                              'Thread'
                            ) : (
                              'Job'
                            )}
                            <span className="opacity-40 mx-1.5">·</span>
                            {taskLastRunText(task)}
                          </p>
                          {logById[task.id] ? (
                            <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap border-l-2 border-border-subtle pl-3 text-[12px] leading-5 text-secondary">
                              {logById[task.id]}
                            </pre>
                          ) : null}
                        </div>
                        <p className="text-[13px] text-secondary lg:text-right">{taskScheduleSummary(task)}</p>
                        <div className="flex flex-wrap gap-2 opacity-100 lg:justify-end lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:focus-within:opacity-100">
                          {task.threadConversationId ? (
                            <a className={cx('ui-toolbar-button')} href={`/conversations/${encodeURIComponent(task.threadConversationId)}`}>
                              Open thread
                            </a>
                          ) : null}
                          <ToolbarButton disabled={busy === task.id} onClick={() => void runTask(task.id)}>
                            Run
                          </ToolbarButton>
                          <ToolbarButton onClick={() => openEditor(task)}>Edit</ToolbarButton>
                          <ToolbarButton onClick={() => void toggleLog(task.id)}>{logById[task.id] ? 'Hide log' : 'Log'}</ToolbarButton>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </AppPageLayout>
    </div>
  );
}
