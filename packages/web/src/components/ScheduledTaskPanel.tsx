import { useEffect, useMemo, useRef, useState, type SelectHTMLAttributes } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../client/api';
import { useAppData } from '../app/contexts';
import { buildConversationGroupLabels, normalizeConversationGroupCwd } from '../conversation/conversationCwdGroups';
import { useApi } from '../hooks/useApi';
import { normalizeWorkspacePaths } from '../local/savedWorkspacePaths';
import { THINKING_LEVEL_OPTIONS } from '../model/modelPreferences';
import { isScheduledTaskDetail } from '../automation/scheduledTaskDetail';
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
} from '../automation/taskSchedule';
import type { ProjectRecord, ScheduledTaskDetail, ScheduledTaskSummary, SessionMeta } from '../shared/types';
import { timeAgo } from '../shared/utils';
import { ErrorState, LoadingState, ToolbarButton, cx } from './ui';
import { MentionTextarea } from './MentionTextarea';

const TITLE_INPUT_CLASS = 'w-full min-w-0 bg-transparent text-[16px] font-medium text-primary placeholder:text-dim/75 outline-none';
const PROMPT_INPUT_CLASS = 'min-h-0 flex-1 w-full resize-none overflow-y-auto bg-transparent px-1 pb-3 pt-2 text-[15px] leading-7 text-primary placeholder:text-dim/75 outline-none';
const INLINE_FIELD_CLASS = 'h-8 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-[12px] font-medium text-secondary outline-none transition-colors hover:bg-surface/45 hover:text-primary focus-visible:border-border-subtle focus-visible:bg-surface/55 focus-visible:text-primary focus-visible:ring-1 focus-visible:ring-accent/20 disabled:cursor-default disabled:opacity-40';
const INLINE_INPUT_CLASS = INLINE_FIELD_CLASS;
const INLINE_SELECT_CLASS = `${INLINE_FIELD_CLASS} appearance-none pr-6`;
const FIELD_LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-dim';
const FIELD_HELP_CLASS = 'text-[12px] leading-relaxed text-secondary';

interface TaskFormState {
  title: string;
  targetType: 'background-agent' | 'conversation';
  scheduleMode: 'cron' | 'at';
  cronEditor: CronEditorState;
  atValue: string;
  runIn: 'local' | 'worktree';
  projectPath: string;
  threadMode: 'dedicated' | 'existing' | 'none';
  threadConversationId: string;
  model: string;
  thinkingLevel: string;
  catchUpWindowMinutes: string;
  prompt: string;
}

export function taskStatusMeta(task: ScheduledTaskDetail): { text: string; cls: string } {
  if (task.running) return { text: 'running', cls: 'text-accent' };
  if (task.lastStatus === 'success') return { text: 'success', cls: 'text-success' };
  if (task.lastStatus === 'failed' || task.lastStatus === 'failure') return { text: 'failed', cls: 'text-danger' };
  return { text: 'never run', cls: 'text-dim' };
}

export function shouldShowTaskModelControls(state: Pick<TaskFormState, 'targetType'>): boolean {
  return state.targetType === 'background-agent' || state.targetType === 'conversation';
}

function createDefaultTaskFormState(): TaskFormState {
  return {
    title: '',
    targetType: 'background-agent',
    scheduleMode: 'cron',
    cronEditor: createCronEditorState('0 9 * * 1-5'),
    atValue: '',
    runIn: 'local',
    projectPath: '',
    threadMode: 'dedicated',
    threadConversationId: '',
    model: '',
    thinkingLevel: '',
    catchUpWindowMinutes: '',
    prompt: '',
  };
}

function createTaskFormState(task: ScheduledTaskDetail): TaskFormState {
  return {
    title: task.title ?? task.id,
    targetType: task.targetType === 'conversation' ? 'conversation' : 'background-agent',
    scheduleMode: task.at ? 'at' : 'cron',
    cronEditor: createCronEditorState(task.cron),
    atValue: toDateTimeLocalValue(task.at),
    runIn: task.cwd ? 'worktree' : 'local',
    projectPath: task.cwd ?? '',
    threadMode: task.threadMode,
    threadConversationId: task.threadConversationId ?? '',
    model: task.model ?? '',
    thinkingLevel: task.thinkingLevel ?? '',
    catchUpWindowMinutes: task.catchUpWindowSeconds ? String(Math.max(1, Math.ceil(task.catchUpWindowSeconds / 60))) : '',
    prompt: task.prompt,
  };
}

function toggleButtonClass(active: boolean): string {
  return cx(
    'inline-flex h-8 items-center rounded-md px-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:ring-offset-2 focus-visible:ring-offset-base',
    active
      ? 'bg-surface/55 text-primary'
      : 'text-secondary hover:bg-surface/45 hover:text-primary',
  );
}

function dayButtonClass(active: boolean): string {
  return cx(
    'inline-flex items-center justify-center rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:ring-offset-2 focus-visible:ring-offset-base',
    active
      ? 'border-border-default bg-surface/65 text-primary'
      : 'border-border-subtle bg-base/60 text-secondary hover:border-border-default hover:bg-surface/55 hover:text-primary',
  );
}

function InlineSelect({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="relative inline-flex min-w-0 items-center">
      <select {...props} className={cx(INLINE_SELECT_CLASS, className)}>
        {children}
      </select>
      <svg
        aria-hidden="true"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-2.5 text-dim/70"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}

function resolveCronExpression(state: TaskFormState): string {
  return state.cronEditor.mode === 'builder'
    ? buildCronFromEasyTaskSchedule(state.cronEditor.builder)
    : state.cronEditor.rawCron.trim();
}

function parseCatchUpWindowMinutes(value: string): number | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (!/^\d+$/.test(normalized)) {
    return Number.NaN;
  }

  const parsed = Number.parseInt(normalized, 10);
  return parsed > 0 ? parsed : Number.NaN;
}

function formatCatchUpWindowLabel(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) {
    return 'Disabled';
  }

  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours}h`;
  }

  return `${minutes}m`;
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

    const catchUpWindowMinutes = parseCatchUpWindowMinutes(state.catchUpWindowMinutes);
    if (Number.isNaN(catchUpWindowMinutes)) {
      return 'Catch-up window must be a positive number of minutes.';
    }
  } else if (!state.atValue.trim() || !fromDateTimeLocalValue(state.atValue)) {
    return 'Choose when this one-time task should run.';
  }

  if (state.threadMode === 'existing' && !state.threadConversationId.trim()) {
    return 'Choose an existing thread.';
  }

  if (state.targetType === 'conversation' && state.threadMode === 'none') {
    return 'Thread automations need a thread.';
  }

  return null;
}

function createTaskMutationPayload(state: TaskFormState) {
  const catchUpWindowMinutes = state.scheduleMode === 'cron'
    ? parseCatchUpWindowMinutes(state.catchUpWindowMinutes)
    : undefined;

  return {
    title: state.title.trim(),
    cron: state.scheduleMode === 'cron' ? resolveCronExpression(state) : null,
    at: state.scheduleMode === 'at' ? fromDateTimeLocalValue(state.atValue) : null,
    model: state.model.trim() || null,
    thinkingLevel: state.thinkingLevel.trim() || null,
    cwd: state.runIn === 'worktree' ? (state.projectPath.trim() || null) : null,
    catchUpWindowSeconds: typeof catchUpWindowMinutes === 'number' && !Number.isNaN(catchUpWindowMinutes) ? catchUpWindowMinutes * 60 : null,
    prompt: state.prompt,
    targetType: state.targetType,
    threadMode: state.threadMode,
    threadConversationId: state.threadMode === 'existing' ? (state.threadConversationId.trim() || null) : null,
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
    <div className="space-y-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-secondary">
      {lines.map((line, index) => {
        if (line.startsWith('## ') || line.startsWith('# ')) {
          return <p key={index} className="mt-2 text-[13px] font-semibold text-primary">{line.replace(/^#+\s/, '')}</p>;
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {value.mode === 'builder' ? (
          <>
            <InlineSelect
              value={value.builder.cadence}
              onChange={(event) => updateBuilder({ cadence: event.target.value as EasyTaskCadence })}
              className="min-w-[10rem]"
              name="cronCadence"
              aria-label="Recurring schedule pattern"
            >
              <option value="hourly">Every hour</option>
              <option value="interval">Every few hours</option>
              <option value="daily">Every day</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Specific weekdays</option>
              <option value="monthly">Day of month</option>
            </InlineSelect>

            {value.builder.cadence === 'hourly' && (
              <input
                type="number"
                min={0}
                max={59}
                value={value.builder.minute}
                onChange={(event) => updateBuilder({ minute: Number.parseInt(event.target.value || '0', 10) || 0 })}
                className={cx(INLINE_INPUT_CLASS, 'w-[5rem]')}
                name="cronMinute"
                inputMode="numeric"
                aria-label="Minute past the hour"
              />
            )}

            {value.builder.cadence === 'interval' && (
              <>
                <input
                  type="number"
                  min={1}
                  max={23}
                  value={value.builder.intervalHours}
                  onChange={(event) => updateBuilder({ intervalHours: Number.parseInt(event.target.value || '1', 10) || 1 })}
                  className={cx(INLINE_INPUT_CLASS, 'w-[5rem]')}
                  name="cronIntervalHours"
                  inputMode="numeric"
                  aria-label="Every N hours"
                />
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={value.builder.minute}
                  onChange={(event) => updateBuilder({ minute: Number.parseInt(event.target.value || '0', 10) || 0 })}
                  className={cx(INLINE_INPUT_CLASS, 'w-[5rem]')}
                  name="cronIntervalMinute"
                  inputMode="numeric"
                  aria-label="Minute past the hour"
                />
              </>
            )}

            {(value.builder.cadence === 'daily' || value.builder.cadence === 'weekdays' || value.builder.cadence === 'weekly' || value.builder.cadence === 'monthly') && (
              <input
                type="time"
                value={formatTimeInputValue(value.builder.hour, value.builder.minute)}
                onChange={(event) => handleTimeChange(event.target.value)}
                className={cx(INLINE_INPUT_CLASS, 'w-[8.5rem]')}
                name="cronTime"
                aria-label="Recurring schedule time"
              />
            )}

            {value.builder.cadence === 'monthly' && (
              <input
                type="number"
                min={1}
                max={31}
                value={value.builder.dayOfMonth}
                onChange={(event) => updateBuilder({ dayOfMonth: Number.parseInt(event.target.value || '1', 10) || 1 })}
                className={cx(INLINE_INPUT_CLASS, 'w-[5rem]')}
                name="cronDayOfMonth"
                inputMode="numeric"
                aria-label="Day of month"
              />
            )}
          </>
        ) : (
          <input
            value={value.rawCron}
            onChange={(event) => onChange({ ...value, rawCron: event.target.value })}
            className={cx(INLINE_INPUT_CLASS, 'w-full max-w-[18rem] font-mono')}
            placeholder="0 9 * * 1-5"
            name="cron"
            aria-label="Cron expression"
            autoComplete="off"
            spellCheck={false}
          />
        )}

      </div>

      {!value.supported && value.mode === 'raw' && (
        <p className="text-[12px] leading-relaxed text-secondary">
          This cron pattern is outside the simple editor. Switch back to Simple schedule in the menu if you want the builder.
        </p>
      )}

      {value.mode === 'builder' && value.builder.cadence === 'weekly' && (
        <div className="flex flex-wrap items-center gap-2">
          {WEEKDAY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => toggleWeekday(option.value)}
              className={dayButtonClass(value.builder.weekdays.includes(option.value))}
              aria-pressed={value.builder.weekdays.includes(option.value)}
            >
              {option.shortLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function summarizePathLabel(path: string): string {
  const normalized = normalizeConversationGroupCwd(path);
  if (!normalized) {
    return 'Select project';
  }

  if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalized;
  }

  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
}

function isFilesystemRootPath(path: string): boolean {
  const normalized = normalizeConversationGroupCwd(path);
  return normalized === '/' || /^[A-Za-z]:\/$/.test(normalized);
}

export function buildTaskProjectOptions(input: {
  projectPath?: string;
  defaultCwd?: string | null;
  savedWorkspacePaths?: string[] | null;
  sessions?: SessionMeta[] | null;
  projects?: ProjectRecord[] | null;
}): Array<{ label: string; path: string }> {
  const seen = new Set<string>();
  const orderedPaths: string[] = [];
  const projectTitlesByPath = new Map<string, string>();

  function addPath(candidate: string | null | undefined, options?: { title?: string; allowRoot?: boolean }) {
    const normalized = normalizeConversationGroupCwd(candidate);
    if (!normalized) {
      return;
    }

    if (!options?.allowRoot && isFilesystemRootPath(normalized)) {
      return;
    }

    const title = options?.title?.trim();
    if (title && !projectTitlesByPath.has(normalized)) {
      projectTitlesByPath.set(normalized, title);
    }

    if (seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    orderedPaths.push(normalized);
  }

  addPath(input.projectPath, { allowRoot: true });
  addPath(input.defaultCwd);

  for (const savedPath of input.savedWorkspacePaths ?? []) {
    addPath(savedPath);
  }

  for (const session of input.sessions ?? []) {
    if (session.remoteHostId || session.remoteConversationId) {
      continue;
    }
    addPath(session.cwd);
  }

  for (const project of input.projects ?? []) {
    addPath(project.repoRoot, { title: project.title });
  }

  const labelsByPath = buildConversationGroupLabels(orderedPaths);

  return orderedPaths.map((path) => ({
    label: projectTitlesByPath.get(path) ?? labelsByPath.get(path) ?? summarizePathLabel(path),
    path,
  }));
}

export function buildTaskExistingThreadOptions(input: {
  sessions?: SessionMeta[] | null;
  effectiveThreadCwd?: string | null;
}): Array<{ id: string; label: string; cwd?: string }> {
  const effectiveThreadCwd = normalizeConversationGroupCwd(input.effectiveThreadCwd);
  const entries = (input.sessions ?? [])
    .filter((session) => {
      if (session.remoteHostId || session.remoteConversationId) {
        return false;
      }

      const sessionCwd = normalizeConversationGroupCwd(session.cwd);
      return !effectiveThreadCwd || !sessionCwd || sessionCwd === effectiveThreadCwd;
    })
    .map((session) => ({
      id: session.id,
      label: session.title,
      cwd: session.cwd,
    }));

  return entries.sort((left, right) => left.label.localeCompare(right.label));
}

function formatTargetTypeLabel(targetType: TaskFormState['targetType'] | string | undefined): string {
  return targetType === 'conversation' ? 'Thread' : 'Job';
}

function formatThreadModeLabel(mode: TaskFormState['threadMode']): string {
  switch (mode) {
    case 'existing':
      return 'Existing thread';
    case 'none':
      return 'No thread';
    case 'dedicated':
    default:
      return 'Dedicated thread';
  }
}

function InlineSwitch({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className="group inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-1.5 text-[12px] font-medium text-secondary transition-colors hover:bg-surface/45 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:ring-offset-2 focus-visible:ring-offset-base"
    >
      <span
        aria-hidden="true"
        className={cx(
          'relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full border p-[1px] transition-all',
          checked
            ? 'border-accent/55 bg-accent/75 shadow-sm'
            : 'border-border-default bg-surface/40 group-hover:bg-surface/60',
        )}
      >
        <span className={cx('h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-[14px]' : 'translate-x-0')} />
      </span>
      <span className={cx('leading-none', checked && 'text-primary')}>{label}</span>
    </button>
  );
}

function TaskAdvancedMenu({
  value,
  modelOptions,
  existingThreadOptions,
  onChange,
}: {
  value: TaskFormState;
  modelOptions: Array<{ id: string }>;
  existingThreadOptions: Array<{ id: string; label: string; cwd?: string }>;
  onChange: (patch: Partial<TaskFormState>) => void;
}) {
  return (
    <div className="absolute top-full right-0 z-20 mt-2 w-[20rem] rounded-xl border border-border-default bg-surface/95 p-3 shadow-2xl backdrop-blur-md">
      <div className="space-y-3">
        <p className={FIELD_LABEL_CLASS}>More options</p>

        <div className="space-y-1.5">
          <span className={FIELD_LABEL_CLASS}>Target</span>
          <InlineSelect
            value={value.targetType}
            onChange={(event) => onChange({
              targetType: event.target.value as TaskFormState['targetType'],
              ...(event.target.value === 'conversation' && value.threadMode === 'none' ? { threadMode: 'dedicated' as const } : {}),
            })}
            className="w-full"
            name="targetType"
            aria-label="Automation target"
          >
            <option value="background-agent">Background job</option>
            <option value="conversation">Conversation thread</option>
          </InlineSelect>
        </div>

        {value.scheduleMode === 'cron' && (
          <>
            <div className="space-y-1.5">
              <span className={FIELD_LABEL_CLASS}>Schedule editor</span>
              <InlineSelect
                value={value.cronEditor.mode}
                onChange={(event) => onChange({ cronEditor: { ...value.cronEditor, mode: event.target.value as CronEditorState['mode'] } })}
                className="w-full"
                name="cronEditorMode"
                aria-label="Schedule editor mode"
              >
                <option value="builder">Simple schedule</option>
                <option value="raw">Raw cron</option>
              </InlineSelect>
            </div>

            <div className="space-y-1.5">
              <span className={FIELD_LABEL_CLASS}>Catch-up window</span>
              <input
                type="number"
                min={1}
                step={1}
                value={value.catchUpWindowMinutes}
                onChange={(event) => onChange({ catchUpWindowMinutes: event.target.value })}
                className={cx(INLINE_INPUT_CLASS, 'w-full')}
                name="catchUpWindowMinutes"
                inputMode="numeric"
                aria-label="Run if missed within minutes"
                placeholder="Disabled"
              />
              <p className={FIELD_HELP_CLASS}>Run once after wake if the latest missed slot was within this many minutes. Leave blank to skip missed runs.</p>
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <span className={FIELD_LABEL_CLASS}>Thread</span>
          <InlineSelect
            value={value.threadMode}
            onChange={(event) => onChange({
              threadMode: event.target.value as TaskFormState['threadMode'],
              ...(event.target.value !== 'existing' ? { threadConversationId: '' } : {}),
            })}
            className="w-full"
            name="threadMode"
            aria-label="Automation thread mode"
          >
            <option value="dedicated">Dedicated thread</option>
            <option value="existing">Existing thread</option>
            {value.targetType !== 'conversation' && <option value="none">No thread</option>}
          </InlineSelect>
          {value.threadMode === 'existing' && (
            <InlineSelect
              value={value.threadConversationId}
              onChange={(event) => onChange({ threadConversationId: event.target.value })}
              className="w-full"
              name="threadConversationId"
              aria-label="Existing automation thread"
            >
              <option value="">Choose thread</option>
              {existingThreadOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.label}</option>
              ))}
            </InlineSelect>
          )}
          {value.threadMode === 'existing' && existingThreadOptions.length === 0 && (
            <p className={FIELD_HELP_CLASS}>No saved threads match this working directory yet.</p>
          )}
        </div>

        {shouldShowTaskModelControls(value) && (
          <>
            <div className="space-y-1.5">
              <span className={FIELD_LABEL_CLASS}>Model</span>
              <InlineSelect
                value={value.model}
                onChange={(event) => onChange({ model: event.target.value })}
                className="w-full"
                name="model"
                aria-label="Automation model"
              >
                <option value="">Default</option>
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>{model.id}</option>
                ))}
              </InlineSelect>
            </div>

            <div className="space-y-1.5">
              <span className={FIELD_LABEL_CLASS}>Reasoning</span>
              <InlineSelect
                value={value.thinkingLevel}
                onChange={(event) => onChange({ thinkingLevel: event.target.value })}
                className="w-full"
                name="thinkingLevel"
                aria-label="Automation reasoning level"
              >
                {THINKING_LEVEL_OPTIONS.map((option) => (
                  <option key={option.value || 'unset'} value={option.value}>{option.label}</option>
                ))}
              </InlineSelect>
            </div>
          </>
        )}
      </div>
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
  const { projects, sessions } = useAppData();
  const validationError = useMemo(() => validateTaskForm(value, mode), [mode, value]);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const { data: cwdState } = useApi(async () => api.defaultCwd(), 'task-editor-default-cwd');
  const { data: modelState } = useApi(async () => api.models(), 'task-editor-models');
  const { data: savedWorkspacePaths } = useApi(
    async () => normalizeWorkspacePaths(await api.savedWorkspacePaths()),
    'task-editor-saved-workspaces',
  );

  useEffect(() => {
    const defaultPath = normalizeConversationGroupCwd(cwdState?.effectiveCwd);
    if (
      value.runIn === 'worktree'
      && !value.projectPath.trim()
      && defaultPath
      && !isFilesystemRootPath(defaultPath)
    ) {
      onChange({ projectPath: defaultPath });
    }
  }, [cwdState?.effectiveCwd, onChange, value.projectPath, value.runIn]);

  useEffect(() => {
    if (error) {
      setSubmitAttempted(true);
    }
  }, [error]);

  useEffect(() => {
    if (!moreMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (moreMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setMoreMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMoreMenuOpen(false);
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [moreMenuOpen]);

  const projectOptions = useMemo(() => buildTaskProjectOptions({
    projectPath: value.projectPath,
    defaultCwd: cwdState?.effectiveCwd,
    savedWorkspacePaths,
    sessions,
    projects,
  }), [cwdState?.effectiveCwd, projects, savedWorkspacePaths, sessions, value.projectPath]);

  const effectiveThreadCwd = value.runIn === 'worktree'
    ? normalizeConversationGroupCwd(value.projectPath)
    : normalizeConversationGroupCwd(cwdState?.effectiveCwd);
  const existingThreadOptions = useMemo(() => buildTaskExistingThreadOptions({
    sessions,
    effectiveThreadCwd,
  }), [effectiveThreadCwd, sessions]);
  const selectedExistingThread = existingThreadOptions.find((option) => option.id === value.threadConversationId);
  const thinkingLabel = THINKING_LEVEL_OPTIONS.find((option) => option.value === value.thinkingLevel)?.label ?? value.thinkingLevel;
  const advancedSummaryParts = [
    formatTargetTypeLabel(value.targetType),
    value.scheduleMode === 'cron' && value.catchUpWindowMinutes.trim()
      ? `catch up ${value.catchUpWindowMinutes.trim()}m`
      : null,
    value.threadMode === 'existing'
      ? (selectedExistingThread?.label ?? 'Existing thread')
      : (value.threadMode === 'none' ? 'No thread' : null),
    value.model.trim() ? value.model.trim().split('/').pop() ?? value.model.trim() : null,
    value.thinkingLevel.trim() ? thinkingLabel : null,
  ].filter((entry): entry is string => Boolean(entry));
  const advancedSummary = advancedSummaryParts.length > 0 ? advancedSummaryParts.join(' · ') : null;
  const visibleError = error ?? (submitAttempted ? validationError : null);

  useEffect(() => {
    if (value.threadMode !== 'existing' || !value.threadConversationId.trim()) {
      return;
    }

    if (existingThreadOptions.some((option) => option.id === value.threadConversationId)) {
      return;
    }

    onChange({ threadConversationId: '' });
  }, [existingThreadOptions, onChange, value.threadConversationId, value.threadMode]);

  return (
    <form
      className="flex h-full min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitAttempted(true);
        if (validationError) {
          return;
        }
        onSubmit();
      }}
    >
      <div className="min-h-0 flex-1 px-6 pb-2 pt-5">
        <div className="mx-auto flex h-full min-h-0 max-w-4xl flex-col">
          <div className="flex items-start justify-between gap-3 px-1">
            <input
              value={value.title}
              onChange={(event) => onChange({ title: event.target.value })}
              className={TITLE_INPUT_CLASS}
              placeholder="Automation title"
              name="title"
              aria-label="Automation title"
              autoComplete="off"
              autoFocus
            />
            <div ref={moreMenuRef} className="relative flex shrink-0 items-center gap-2">
              {advancedSummary && (
                <span className="max-w-[16rem] truncate text-[12px] text-secondary">{advancedSummary}</span>
              )}
              <button
                type="button"
                onClick={() => setMoreMenuOpen((current) => !current)}
                className={toggleButtonClass(moreMenuOpen)}
                aria-label="More automation options"
                aria-expanded={moreMenuOpen}
                aria-haspopup="dialog"
              >
                ⋯
              </button>
              {moreMenuOpen && (
                <TaskAdvancedMenu
                  value={value}
                  modelOptions={modelState?.models ?? []}
                  existingThreadOptions={existingThreadOptions}
                  onChange={onChange}
                />
              )}
            </div>
          </div>

          <MentionTextarea
            value={value.prompt}
            onValueChange={(prompt) => onChange({ prompt })}
            containerClassName="flex min-h-0 flex-1"
            className={PROMPT_INPUT_CLASS}
            placeholder="Add prompt…"
            name="prompt"
            aria-label="Prompt"
          />
        </div>
      </div>

      <div className="px-6 pb-4 pt-2">
        <div className="mx-auto max-w-4xl space-y-2">
          {visibleError ? (
            <p className="text-[12px] text-danger" aria-live="polite">{visibleError}</p>
          ) : null}

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:flex-nowrap lg:items-center lg:gap-4 xl:pr-4">
              <div className="flex min-w-0 flex-wrap items-center gap-3 lg:flex-nowrap">
                <InlineSwitch
                  checked={value.scheduleMode === 'at'}
                  label="One time"
                  onCheckedChange={(checked) => onChange({ scheduleMode: checked ? 'at' : 'cron' })}
                />
                {value.scheduleMode === 'cron' ? (
                  <div className="min-w-0 lg:flex-none">
                    <CronBuilderEditor value={value.cronEditor} onChange={(cronEditor) => onChange({ cronEditor })} />
                  </div>
                ) : (
                  <input
                    type="datetime-local"
                    value={value.atValue}
                    onChange={(event) => onChange({ atValue: event.target.value })}
                    className={cx(INLINE_INPUT_CLASS, 'w-full max-w-[18rem]')}
                    name="runAt"
                    aria-label="Run at"
                  />
                )}
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-3 lg:flex-nowrap">
                <InlineSwitch
                  checked={value.runIn === 'worktree'}
                  label="Worktree"
                  onCheckedChange={(checked) => onChange({
                    runIn: checked ? 'worktree' : 'local',
                    ...(checked ? {} : { projectPath: '' }),
                  })}
                />
                {value.runIn === 'worktree' ? (
                  <InlineSelect
                    value={value.projectPath.trim()}
                    onChange={(event) => onChange({ projectPath: event.target.value, runIn: 'worktree' })}
                    className="w-full min-w-[12rem] max-w-[20rem]"
                    name="projectPath"
                    aria-label="Automation project"
                  >
                    <option value="">Select project</option>
                    {projectOptions.map((entry) => (
                      <option key={entry.path} value={entry.path}>{entry.label}</option>
                    ))}
                  </InlineSelect>
                ) : (
                  <span className="text-[12px] text-secondary">Chat</span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-3 xl:self-end">
              <button type="button" onClick={onCancel} className="text-[13px] text-secondary transition-colors hover:text-primary">
                Cancel
              </button>
              <ToolbarButton type="submit" disabled={saving}>
                {saving ? (mode === 'create' ? 'Creating…' : 'Saving…') : (mode === 'create' ? 'Create' : 'Save')}
              </ToolbarButton>
            </div>
          </div>
        </div>
      </div>
    </form>
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
  const navigate = useNavigate();
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
          <div className="ui-detail-row">
            <span className="ui-detail-label">thread</span>
            <div className="min-w-0">
              <p className="ui-detail-value">{formatThreadModeLabel(taskDetail.threadMode)}</p>
              {taskDetail.threadTitle && <p className="ui-card-meta mt-0.5 break-all">{taskDetail.threadTitle}</p>}
              {taskDetail.threadConversationId && (
                <button
                  type="button"
                  onClick={() => navigate(`/conversations/${encodeURIComponent(taskDetail.threadConversationId)}`)}
                  className="mt-1 text-[11px] text-accent transition-colors hover:text-accent/80"
                >
                  Open thread →
                </button>
              )}
            </div>
          </div>
          {taskDetail.scheduleType === 'cron' && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">catch-up</span>
              <p className="ui-detail-value">{formatCatchUpWindowLabel(taskDetail.catchUpWindowSeconds)}</p>
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
