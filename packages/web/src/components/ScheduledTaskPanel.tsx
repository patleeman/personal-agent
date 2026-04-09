import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAppData } from '../contexts';
import { useApi } from '../hooks';
import { isScheduledTaskDetail } from '../scheduledTaskDetail';
import {
  buildCronFromEasyTaskSchedule,
  createCronEditorState,
  formatTaskSchedule,
  formatTimeInputValue,
  fromDateTimeLocalValue,
  parseTimeInputValue,
  toDateTimeLocalValue,
  WEEKDAY_OPTIONS,
  type CronEditorState,
  type EasyTaskCadence,
  type EasyTaskSchedule,
} from '../taskSchedule';
import type { ScheduledTaskDetail, ScheduledTaskSummary } from '../types';
import { timeAgo } from '../utils';
import { ErrorState, LoadingState, ToolbarButton, cx } from './ui';
import { MentionTextarea } from './MentionTextarea';

const INPUT_CLASS = 'w-full rounded-xl border border-border-default bg-base px-3 py-2.5 text-[13px] leading-relaxed text-primary placeholder:text-dim/75 focus:outline-none focus:border-accent/60';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[12rem] resize-y`;
const SELECT_CLASS = `${INPUT_CLASS} pr-10`;
const ACTION_BUTTON_CLASS = 'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors';

interface TaskFormState {
  title: string;
  scheduleMode: 'cron' | 'at';
  cronEditor: CronEditorState;
  atValue: string;
  cwd: string;
  prompt: string;
}

function taskStatusMeta(task: ScheduledTaskDetail): { text: string; cls: string } {
  if (task.running) return { text: 'running', cls: 'text-accent' };
  if (task.lastStatus === 'success') return { text: 'success', cls: 'text-success' };
  if (task.lastStatus === 'failure') return { text: 'failed', cls: 'text-danger' };
  return { text: 'never run', cls: 'text-dim' };
}

function createDefaultTaskFormState(): TaskFormState {
  return {
    title: '',
    scheduleMode: 'cron',
    cronEditor: createCronEditorState('0 9 * * 1-5'),
    atValue: '',
    cwd: '',
    prompt: '',
  };
}

function createTaskFormState(task: ScheduledTaskDetail): TaskFormState {
  return {
    title: task.title ?? task.id,
    scheduleMode: task.at ? 'at' : 'cron',
    cronEditor: createCronEditorState(task.cron),
    atValue: toDateTimeLocalValue(task.at),
    cwd: task.cwd ?? '',
    prompt: task.prompt,
  };
}

function scheduleModeButtonClass(active: boolean): string {
  return cx(
    ACTION_BUTTON_CLASS,
    active
      ? 'border-accent/30 bg-accent/10 text-accent'
      : 'border-border-subtle bg-base text-dim hover:border-border-default hover:text-primary',
  );
}

function dayButtonClass(active: boolean): string {
  return cx(
    ACTION_BUTTON_CLASS,
    active
      ? 'border-accent/20 bg-surface text-primary'
      : 'border-border-subtle bg-base text-dim hover:border-border-default hover:text-primary',
  );
}

function resolveCronExpression(state: TaskFormState): string {
  return state.cronEditor.mode === 'builder'
    ? buildCronFromEasyTaskSchedule(state.cronEditor.builder)
    : state.cronEditor.rawCron.trim();
}

function validateTaskForm(state: TaskFormState, _mode: 'create' | 'edit'): string | null {
  if (!state.title.trim()) {
    return 'Title is required.';
  }

  if (!state.prompt.trim()) {
    return 'Prompt is required.';
  }

  if (state.scheduleMode === 'cron') {
    if (!resolveCronExpression(state)) {
      return 'Cron is required.';
    }
  } else if (!state.atValue.trim() || !fromDateTimeLocalValue(state.atValue)) {
    return 'Choose when this one-time task should run.';
  }

  return null;
}

function createTaskMutationPayload(state: TaskFormState) {
  return {
    title: state.title.trim(),
    cron: state.scheduleMode === 'cron' ? resolveCronExpression(state) : null,
    at: state.scheduleMode === 'at' ? fromDateTimeLocalValue(state.atValue) : null,
    cwd: state.cwd.trim() || null,
    prompt: state.prompt,
  };
}

async function refreshTaskSnapshot(setTasks: (tasks: ScheduledTaskSummary[]) => void) {
  const tasks = await api.tasks();
  setTasks(tasks);
  return tasks;
}

function PromptText({ value }: { value: string }) {
  const lines = value.split('\n');
  return (
    <div className="text-[12px] leading-relaxed text-secondary space-y-1 whitespace-pre-wrap break-words">
      {lines.map((line, index) => {
        if (line.startsWith('## ') || line.startsWith('# ')) {
          return <p key={index} className="text-primary font-semibold text-[13px] mt-2">{line.replace(/^#+\s/, '')}</p>;
        }
        if (line.startsWith('- ') || line.match(/^\d+\. /)) {
          return <p key={index} className="pl-2">{line}</p>;
        }
        if (line.trim() === '') {
          return <div key={index} className="h-1.5" />;
        }
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

function CronBuilderEditor({
  value,
  onChange,
}: {
  value: CronEditorState;
  onChange: (next: CronEditorState) => void;
}) {
  const previewCron = value.mode === 'builder'
    ? buildCronFromEasyTaskSchedule(value.builder)
    : value.rawCron.trim();

  function updateBuilder(patch: Partial<EasyTaskSchedule>) {
    onChange({
      ...value,
      builder: {
        ...value.builder,
        ...patch,
      },
    });
  }

  function handleTimeChange(nextValue: string) {
    const parsed = parseTimeInputValue(nextValue);
    if (!parsed) {
      return;
    }

    updateBuilder(parsed);
  }

  function toggleWeekday(day: number) {
    const current = value.builder.weekdays;
    const next = current.includes(day)
      ? current.length > 1 ? current.filter((entry) => entry !== day) : current
      : [...current, day].sort((left, right) => left - right);
    updateBuilder({ weekdays: next });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange({ ...value, mode: 'builder' })}
          className={scheduleModeButtonClass(value.mode === 'builder')}
        >
          simple
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...value, mode: 'raw' })}
          className={scheduleModeButtonClass(value.mode === 'raw')}
        >
          raw cron
        </button>
      </div>

      {!value.supported && value.mode === 'raw' && (
        <p className="text-[11px] text-dim">
          This cron pattern is outside the simple editor. Keep editing raw cron, or switch to a simpler recurring pattern.
        </p>
      )}

      {value.mode === 'builder' ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="ui-card-meta">Pattern</label>
            <select
              value={value.builder.cadence}
              onChange={(event) => updateBuilder({ cadence: event.target.value as EasyTaskCadence })}
              className={SELECT_CLASS}
            >
              <option value="hourly">Every hour</option>
              <option value="interval">Every few hours</option>
              <option value="daily">Every day</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Specific weekdays</option>
              <option value="monthly">Day of month</option>
            </select>
          </div>

          {value.builder.cadence === 'hourly' && (
            <div className="space-y-1.5">
              <label className="ui-card-meta">Minute past the hour</label>
              <input
                type="number"
                min={0}
                max={59}
                value={value.builder.minute}
                onChange={(event) => updateBuilder({ minute: Number.parseInt(event.target.value || '0', 10) || 0 })}
                className={INPUT_CLASS}
              />
            </div>
          )}

          {value.builder.cadence === 'interval' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="ui-card-meta">Every N hours</label>
                <input
                  type="number"
                  min={1}
                  max={23}
                  value={value.builder.intervalHours}
                  onChange={(event) => updateBuilder({ intervalHours: Number.parseInt(event.target.value || '1', 10) || 1 })}
                  className={INPUT_CLASS}
                />
              </div>
              <div className="space-y-1.5">
                <label className="ui-card-meta">Minute past the hour</label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={value.builder.minute}
                  onChange={(event) => updateBuilder({ minute: Number.parseInt(event.target.value || '0', 10) || 0 })}
                  className={INPUT_CLASS}
                />
              </div>
            </div>
          )}

          {(value.builder.cadence === 'daily' || value.builder.cadence === 'weekdays' || value.builder.cadence === 'weekly' || value.builder.cadence === 'monthly') && (
            <div className="space-y-1.5">
              <label className="ui-card-meta">Time</label>
              <input
                type="time"
                value={formatTimeInputValue(value.builder.hour, value.builder.minute)}
                onChange={(event) => handleTimeChange(event.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          )}

          {value.builder.cadence === 'weekly' && (
            <div className="space-y-1.5">
              <label className="ui-card-meta">Days</label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleWeekday(option.value)}
                    className={dayButtonClass(value.builder.weekdays.includes(option.value))}
                  >
                    {option.shortLabel}
                  </button>
                ))}
              </div>
            </div>
          )}

          {value.builder.cadence === 'monthly' && (
            <div className="space-y-1.5">
              <label className="ui-card-meta">Day of month</label>
              <input
                type="number"
                min={1}
                max={31}
                value={value.builder.dayOfMonth}
                onChange={(event) => updateBuilder({ dayOfMonth: Number.parseInt(event.target.value || '1', 10) || 1 })}
                className={INPUT_CLASS}
              />
            </div>
          )}

          <div className="space-y-1">
            <p className="ui-card-meta">Preview</p>
            <p className="text-[12px] text-secondary">{formatTaskSchedule({ cron: previewCron })}</p>
            <p className="text-[11px] font-mono text-dim">{previewCron}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="ui-card-meta">Cron expression</label>
          <input
            value={value.rawCron}
            onChange={(event) => onChange({ ...value, rawCron: event.target.value })}
            className={`${INPUT_CLASS} font-mono`}
            placeholder="0 9 * * 1-5"
          />
        </div>
      )}
    </div>
  );
}

function TaskFolderField({
  value,
  onChange,
}: {
  value: string;
  onChange: (cwd: string) => void;
}) {
  const [pickBusy, setPickBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  async function handlePickFolder() {
    if (pickBusy) {
      return;
    }

    setPickBusy(true);
    setPickError(null);
    try {
      const result = await api.pickFolder(value.trim() || undefined);
      if (result.cancelled || !result.path) {
        return;
      }

      onChange(result.path);
    } catch (nextError) {
      setPickError(nextError instanceof Error ? nextError.message : 'Could not choose a folder.');
    } finally {
      setPickBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="ui-card-meta">Working directory</label>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(event) => {
            if (pickError) {
              setPickError(null);
            }
            onChange(event.target.value);
          }}
          className={`${INPUT_CLASS} font-mono`}
          placeholder="Optional"
          spellCheck={false}
        />
        <ToolbarButton type="button" onClick={() => { void handlePickFolder(); }} disabled={pickBusy} className="shrink-0 whitespace-nowrap text-accent">
          {pickBusy ? 'Choosing…' : 'Choose…'}
        </ToolbarButton>
      </div>
      {pickError && <p className="text-[12px] text-danger">{pickError}</p>}
    </div>
  );
}

function TaskEditorForm({
  mode,
  value,
  saving,
  error,
  onChange,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  value: TaskFormState;
  saving: boolean;
  error: string | null;
  onChange: (patch: Partial<TaskFormState>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const validationError = useMemo(() => validateTaskForm(value, mode), [mode, value]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
        <div className="space-y-1 min-w-0">
          <p className="ui-card-title break-all">{mode === 'create' ? 'New automation' : value.title}</p>
          <p className="ui-card-meta">{mode === 'create' ? 'Create an automation' : 'Edit automation'}</p>
        </div>
        <button type="button" onClick={onCancel} className="ui-toolbar-button">Cancel</button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
          <div className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(18rem,1.2fr)]">
              <div className="space-y-1.5">
                <label className="ui-card-meta">Title</label>
                <input
                  value={value.title}
                  onChange={(event) => onChange({ title: event.target.value })}
                  className={INPUT_CLASS}
                  placeholder="Daily bug scan"
                />
              </div>

              <TaskFolderField value={value.cwd} onChange={(cwd) => onChange({ cwd })} />
            </div>

            <div className="space-y-1.5">
              <label className="ui-card-meta">Prompt</label>
              <MentionTextarea
                value={value.prompt}
                onValueChange={(prompt) => onChange({ prompt })}
                className={TEXTAREA_CLASS}
              />
            </div>
          </div>

          <div className="space-y-4 border-t border-border-subtle pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
            <div className="space-y-2">
              <p className="ui-card-meta">Schedule</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onChange({ scheduleMode: 'cron' })}
                  className={scheduleModeButtonClass(value.scheduleMode === 'cron')}
                >
                  recurring
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ scheduleMode: 'at' })}
                  className={scheduleModeButtonClass(value.scheduleMode === 'at')}
                >
                  one time
                </button>
              </div>
            </div>

            {value.scheduleMode === 'cron' ? (
              <CronBuilderEditor
                value={value.cronEditor}
                onChange={(cronEditor) => onChange({ cronEditor })}
              />
            ) : (
              <div className="space-y-1.5">
                <label className="ui-card-meta">Run at</label>
                <input
                  type="datetime-local"
                  value={value.atValue}
                  onChange={(event) => onChange({ atValue: event.target.value })}
                  className={INPUT_CLASS}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-border-subtle px-5 py-3">
        {(validationError || error) && (
          <p className="mb-3 text-[12px] text-danger">{validationError ?? error}</p>
        )}

        <div className="flex items-center gap-3">
          <ToolbarButton onClick={onSubmit} disabled={saving || Boolean(validationError)}>
            {saving ? (mode === 'create' ? 'Creating…' : 'Saving…') : (mode === 'create' ? 'Create automation' : 'Save automation')}
          </ToolbarButton>
          <button type="button" onClick={onCancel} className="text-[13px] text-secondary hover:text-primary transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskLogSection({ taskId }: { taskId: string }) {
  const [log, setLog] = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  function loadLog() {
    if (log !== null) {
      setOpen((current) => !current);
      return;
    }

    setLoading(true);
    api.taskLog(taskId)
      .then((data) => {
        setLog(data.log);
        setLogPath(data.path);
        setOpen(true);
        setLoading(false);
      })
      .catch(() => {
        setLog('No log available.');
        setOpen(true);
        setLoading(false);
      });
  }

  return (
    <div className="border-t border-border-subtle pt-3">
      <button onClick={loadLog} className="text-[11px] text-accent hover:underline flex items-center gap-1.5">
        {loading ? <span className="animate-spin text-[10px]">⟳</span> : (open ? '▾' : '▸')}
        Last run log
      </button>
      {open && log !== null && (
        <div className="mt-2">
          {logPath && <p className="text-[9px] font-mono text-dim/50 truncate mb-1">{logPath.split('/').slice(-1)[0]}</p>}
          <pre className="text-[10px] font-mono text-secondary whitespace-pre-wrap break-all bg-elevated rounded-lg p-2.5 max-h-64 overflow-y-auto leading-relaxed">
            {log || '(empty)'}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ScheduledTaskCreatePanel({ onCancel }: { onCancel?: () => void } = {}) {
  const navigate = useNavigate();
  const { setTasks } = useAppData();
  const [draft, setDraft] = useState<TaskFormState>(() => createDefaultTaskFormState());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleCreate() {
    const validationError = validateTaskForm(draft, 'create');
    if (validationError) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const response = await api.createTask(createTaskMutationPayload(draft));
      await refreshTaskSnapshot(setTasks);
      navigate(`/automations/${encodeURIComponent(response.task.id)}`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TaskEditorForm
      mode="create"
      value={draft}
      saving={saving}
      error={saveError}
      onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
      onCancel={onCancel ?? (() => navigate('/automations'))}
      onSubmit={() => { void handleCreate(); }}
    />
  );
}

export function ScheduledTaskPanel({
  id,
  initialMode = 'view',
  onClose,
}: {
  id: string;
  initialMode?: 'view' | 'edit';
  onClose?: () => void;
}) {
  const { setTasks } = useAppData();
  const { data: task, loading, error, refetch } = useApi(async () => {
    const detail = await api.taskDetail(id);
    if (!isScheduledTaskDetail(detail)) {
      throw new Error('Task details are unavailable.');
    }
    return detail;
  }, id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TaskFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setSaveError(null);
  }, [id]);

  useEffect(() => {
    if (initialMode !== 'edit' || !task || editing || draft) {
      return;
    }

    setDraft(createTaskFormState(task));
    setSaveError(null);
    setEditing(true);
  }, [draft, editing, initialMode, task]);

  if (loading && !task) {
    return <LoadingState label="Loading task…" className="px-4 py-4" />;
  }

  if (error && !task) {
    return <ErrorState message={error} className="px-4 py-4" />;
  }

  if (!task) {
    return <div className="px-4 py-4 text-[12px] text-dim">Task not found.</div>;
  }

  async function handleSave() {
    if (!draft || validateTaskForm(draft, 'edit')) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      await api.saveTask(id, createTaskMutationPayload(draft));
      await Promise.all([
        refetch({ resetLoading: false }),
        refreshTaskSnapshot(setTasks),
      ]);
      setEditing(false);
      setDraft(null);
      onClose?.();
    } catch (nextError) {
      setSaveError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  }

  if (editing && draft) {
    return (
      <TaskEditorForm
        mode="edit"
        value={draft}
        saving={saving}
        error={saveError}
        onChange={(patch) => setDraft((current) => current ? { ...current, ...patch } : current)}
        onCancel={() => {
          setEditing(false);
          setDraft(null);
          setSaveError(null);
          if (initialMode === 'edit') {
            onClose?.();
          }
        }}
        onSubmit={() => { void handleSave(); }}
      />
    );
  }

  const taskDetail = task;
  const status = taskStatusMeta(taskDetail);

  return (
    <div className="space-y-4 px-4 py-4 overflow-y-auto">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <p className="ui-card-title break-all">{taskDetail.title ?? taskDetail.id}</p>
          <p className="ui-card-meta">
            <span className={status.cls}>{status.text}</span>
            {taskDetail.lastRunAt && <><span className="opacity-40 mx-1.5">·</span>last run {timeAgo(taskDetail.lastRunAt)}</>}
            {!taskDetail.enabled && <><span className="opacity-40 mx-1.5">·</span>disabled</>}
          </p>
          <p className="text-[12px] text-secondary">{taskDetail.id}</p>
        </div>
        <ToolbarButton onClick={() => {
          setDraft(createTaskFormState(taskDetail));
          setSaveError(null);
          setEditing(true);
        }}>
          Edit
        </ToolbarButton>
      </div>

      <div className="border-t border-border-subtle pt-3">
        <div className="ui-detail-list">
          <div className="ui-detail-row">
            <span className="ui-detail-label">schedule</span>
            <div className="min-w-0">
              <p className="ui-detail-value">{formatTaskSchedule(taskDetail)}</p>
              <p className="ui-card-meta mt-0.5 font-mono break-all">{taskDetail.cron ?? taskDetail.at}</p>
            </div>
          </div>
          {taskDetail.model && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">model</span>
              <p className="ui-detail-value break-all">{taskDetail.model}</p>
            </div>
          )}
          {taskDetail.cwd && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">cwd</span>
              <p className="ui-detail-value break-all">{taskDetail.cwd}</p>
            </div>
          )}
          {taskDetail.timeoutSeconds !== undefined && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">timeout</span>
              <p className="ui-detail-value">{taskDetail.timeoutSeconds}s</p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border-subtle pt-3">
        <p className="ui-section-label mb-2">Prompt</p>
        <PromptText value={taskDetail.prompt} />
      </div>

      <TaskLogSection taskId={id} />
    </div>
  );
}
