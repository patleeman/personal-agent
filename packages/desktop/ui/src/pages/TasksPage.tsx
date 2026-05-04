import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import { useAppData, useSseConnection } from '../app/contexts';
import { getRunMoment, getRunTaskId, isRunInProgress, runNeedsAttention } from '../automation/runPresentation';
import { formatTaskNextRunCountdown, formatTaskSchedule, getNextTaskRunAt, getPreviousTaskRunAt } from '../automation/taskSchedule';
import { api } from '../client/api';
import { ScheduledTaskCreatePanel, ScheduledTaskPanel } from '../components/ScheduledTaskPanel';
import { AppPageIntro, AppPageLayout, ErrorState, LoadingState, ToolbarButton } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { ensureConversationTabOpen } from '../session/sessionTabs';
import type { DurableRunRecord, ScheduledTaskDetail, ScheduledTaskSchedulerHealth, ScheduledTaskSummary } from '../shared/types';
import { timeAgo } from '../shared/utils';

function isFailedTaskStatus(status: string | undefined): boolean {
  return status === 'failed' || status === 'failure';
}

function formatTaskName(task: Pick<ScheduledTaskSummary, 'id' | 'title'>): string {
  return task.title?.trim() || task.id;
}

function formatProjectLabel(task: Pick<ScheduledTaskSummary, 'cwd'>): string {
  const cwd = task.cwd?.trim();
  if (!cwd) return 'local';
  const parts = cwd.split('/').filter(Boolean);
  return parts.at(-1) ?? cwd;
}

function capitalizeFirst(value: string): string {
  return value.length > 0 ? `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}` : value;
}

function formatScheduleLabel(task: Pick<ScheduledTaskSummary, 'cron' | 'at' | 'scheduleType'>): string {
  if (!task.cron && !task.at) return 'Manual';
  return capitalizeFirst(formatTaskSchedule(task));
}

function formatTargetLabel(task: Pick<ScheduledTaskSummary, 'targetType'>): string {
  return task.targetType === 'conversation' ? 'Thread' : 'Job';
}

function formatThreadModeLabel(mode: ScheduledTaskDetail['threadMode'] | undefined): string {
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

function useAutomationClock(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return nowMs;
}

function statusDotClass(task: Pick<ScheduledTaskSummary, 'running' | 'enabled' | 'lastStatus'>): string {
  if (task.running) return 'border-accent bg-accent/25 shadow-[0_0_0_3px_rgb(var(--color-accent)/0.14)]';
  if (!task.enabled) return 'border-border-default bg-transparent';
  if (isFailedTaskStatus(task.lastStatus)) return 'border-danger bg-danger/20';
  if (task.lastStatus === 'success') return 'border-success bg-success/20';
  return 'border-secondary/70 bg-transparent';
}

function statusText(task: Pick<ScheduledTaskSummary, 'running' | 'enabled' | 'lastStatus'>): { text: string; cls: string } {
  if (task.running) return { text: 'Running', cls: 'text-accent' };
  if (!task.enabled) return { text: 'Disabled', cls: 'text-dim' };
  if (isFailedTaskStatus(task.lastStatus)) return { text: 'Needs attention', cls: 'text-danger' };
  if (task.lastStatus === 'success') return { text: 'Active', cls: 'text-success' };
  return { text: 'Scheduled', cls: 'text-secondary' };
}

function taskRowRank(task: Pick<ScheduledTaskSummary, 'running' | 'enabled' | 'lastStatus'>): number {
  if (task.running) return 0;
  if (isFailedTaskStatus(task.lastStatus)) return 1;
  if (task.enabled) return 2;
  return 3;
}

function parseSortableTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const normalized = value.trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/);
  if (!match || !hasValidIsoDateParts(match)) return 0;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasValidIsoDateParts(match: RegExpMatchArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = match[7] ? Number(match[7].slice(0, 3).padEnd(3, '0')) : 0;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second &&
    date.getUTCMilliseconds() === millisecond
  );
}

export function sortAutomationRows(tasks: ScheduledTaskSummary[]): ScheduledTaskSummary[] {
  return [...tasks].sort((left, right) => {
    const rankDiff = taskRowRank(left) - taskRowRank(right);
    if (rankDiff !== 0) return rankDiff;

    const leftLastRun = parseSortableTimestamp(left.lastRunAt);
    const rightLastRun = parseSortableTimestamp(right.lastRunAt);
    if (leftLastRun !== rightLastRun) return rightLastRun - leftLastRun;

    return formatTaskName(left).localeCompare(formatTaskName(right));
  });
}

function sortAutomationRuns(runs: DurableRunRecord[]): DurableRunRecord[] {
  return [...runs].sort((left, right) => {
    const leftAttention = runNeedsAttention(left) ? 1 : 0;
    const rightAttention = runNeedsAttention(right) ? 1 : 0;
    if (leftAttention !== rightAttention) return rightAttention - leftAttention;

    const leftActive = isRunInProgress(left) ? 1 : 0;
    const rightActive = isRunInProgress(right) ? 1 : 0;
    if (leftActive !== rightActive) return rightActive - leftActive;

    const leftAt = getRunMoment(left).at ?? '';
    const rightAt = getRunMoment(right).at ?? '';
    return rightAt.localeCompare(leftAt) || right.runId.localeCompare(left.runId);
  });
}

function runStatusText(run: DurableRunRecord): { text: string; cls: string } {
  const status = run.status?.status;
  if (status === 'running' || status === 'recovering' || status === 'queued' || status === 'waiting') {
    return { text: 'Running', cls: 'text-accent' };
  }
  if (status === 'completed') {
    return runNeedsAttention(run) ? { text: 'Needs review', cls: 'text-warning' } : { text: 'Completed', cls: 'text-success' };
  }
  if (status === 'failed' || status === 'interrupted') return { text: 'Failed', cls: 'text-danger' };
  if (status === 'cancelled') return { text: 'Cancelled', cls: 'text-dim' };
  return { text: status ?? 'Unknown', cls: 'text-dim' };
}

function formatRunDuration(run: DurableRunRecord): string {
  const startedAt = run.status?.startedAt ?? run.status?.createdAt;
  const completedAt = run.status?.completedAt ?? run.status?.updatedAt;
  if (!startedAt || !completedAt) return '—';

  const startedMs = Date.parse(startedAt);
  const completedMs = Date.parse(completedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs) || completedMs < startedMs) return '—';

  const totalSeconds = Math.max(0, Math.round((completedMs - startedMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

function runResultText(run: DurableRunRecord): string {
  if (run.status?.lastError) return run.status.lastError;
  if (run.problems.length > 0) return run.problems[0] ?? 'Needs attention';
  if (run.status?.status === 'completed') return 'Completed';
  if (run.status?.status === 'cancelled') return 'Superseded or cancelled';
  return run.status?.status ?? 'Unknown';
}

function formatSeconds(value: number | undefined): string {
  if (!value || value <= 0) return 'None';
  if (value % 60 === 0) return `${value / 60}m`;
  return `${value}s`;
}

function formatScheduleTypeLabel(task: Pick<ScheduledTaskSummary, 'cron' | 'at' | 'scheduleType'> | null | undefined): string {
  if (task?.cron) return 'Cron';
  if (task?.at || task?.scheduleType === 'at') return 'Once';
  return capitalizeFirst(task?.scheduleType || 'Manual');
}

function formatTaskActivity(entry: NonNullable<ScheduledTaskDetail['activity']>[number]): string {
  if (entry.kind === 'run-failed') {
    return `Run failed before execution · ${entry.message}`;
  }

  const range = entry.count === 1 ? entry.firstScheduledAt : `${entry.firstScheduledAt} → ${entry.lastScheduledAt}`;
  const outcome = entry.outcome === 'catch-up-started' ? 'Caught up' : 'Skipped';
  return `${outcome} ${entry.count} scheduled ${entry.count === 1 ? 'run' : 'runs'} · ${range}`;
}

function schedulerHealthText(health: ScheduledTaskSchedulerHealth | null | undefined): { text: string; cls: string } {
  if (!health?.lastEvaluatedAt) {
    return { text: 'Scheduler has not checked automations yet.', cls: 'border-warning/30 bg-warning/10 text-warning' };
  }

  if (health.status === 'stale') {
    return { text: `Scheduler stale. Last checked ${timeAgo(health.lastEvaluatedAt)}.`, cls: 'border-danger/35 bg-danger/10 text-danger' };
  }

  return {
    text: `Scheduler healthy. Last checked ${timeAgo(health.lastEvaluatedAt)}.`,
    cls: 'border-border-subtle bg-surface/35 text-secondary',
  };
}

function formatExpectedActual(input: {
  expectedAt: Date | null;
  lastRunAt?: string;
  lastStatus?: string;
  activity?: ScheduledTaskDetail['activity'];
}): string {
  if (!input.expectedAt) {
    return 'No expected run yet.';
  }

  const expectedMs = input.expectedAt.getTime();
  const lastRunMs = input.lastRunAt ? Date.parse(input.lastRunAt) : Number.NaN;
  const latestActivity = input.activity?.[0];
  const activityMs = latestActivity?.kind === 'missed' ? Date.parse(latestActivity.lastScheduledAt) : Number.NaN;
  const expectedLabel = timeAgo(input.expectedAt.toISOString());

  if (Number.isFinite(activityMs) && activityMs >= expectedMs) {
    return `Expected ${expectedLabel}; ${latestActivity?.outcome === 'catch-up-started' ? 'catch-up started' : 'skipped'}.`;
  }

  if (Number.isFinite(lastRunMs) && lastRunMs >= expectedMs) {
    return `Expected ${expectedLabel}; ${isFailedTaskStatus(input.lastStatus) ? 'failed' : 'ran'}.`;
  }

  return `Expected ${expectedLabel}; no recorded run yet.`;
}

function getRunLogsPath(run: DurableRunRecord): string | undefined {
  return run.paths.outputLogPath || run.paths.root;
}

function CreateTaskModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="ui-overlay-backdrop"
      style={{
        background: 'rgb(0 0 0 / 0.58)',
        backdropFilter: 'blur(10px)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.75rem',
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create automation"
        className="ui-dialog-shell"
        style={{
          maxWidth: '960px',
          height: 'min(760px, calc(100vh - 5rem))',
          background: 'rgb(var(--color-surface) / 0.985)',
          backdropFilter: 'blur(28px)',
          boxShadow: '0 28px 80px rgb(0 0 0 / 0.35)',
          overscrollBehavior: 'contain',
        }}
      >
        <ScheduledTaskCreatePanel onCancel={onClose} />
      </div>
    </div>
  );
}

function EditTaskModal({ id, onClose }: { id: string; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="ui-overlay-backdrop"
      style={{
        background: 'rgb(0 0 0 / 0.58)',
        backdropFilter: 'blur(10px)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.75rem',
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit automation"
        className="ui-dialog-shell"
        style={{
          maxWidth: '960px',
          height: 'min(760px, calc(100vh - 5rem))',
          background: 'rgb(var(--color-surface) / 0.985)',
          backdropFilter: 'blur(28px)',
          boxShadow: '0 28px 80px rgb(0 0 0 / 0.35)',
          overscrollBehavior: 'contain',
        }}
      >
        <ScheduledTaskPanel id={id} initialMode="edit" onClose={onClose} />
      </div>
    </div>
  );
}

function DeleteTaskModal({
  title,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="ui-overlay-backdrop"
      style={{
        background: 'rgb(0 0 0 / 0.58)',
        backdropFilter: 'blur(10px)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.75rem',
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delete automation"
        className="w-full max-w-md rounded-2xl border border-border-default bg-surface p-5 shadow-2xl"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim">Delete automation</p>
            <h2 className="text-[20px] font-semibold tracking-tight text-primary">Delete {title}?</h2>
            <p className="text-[14px] leading-6 text-secondary">
              This removes the schedule. Past runs and existing thread history stay put.
            </p>
          </div>
          {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={deleting}
              className="text-[13px] text-secondary transition-colors hover:text-primary disabled:opacity-50"
            >
              Cancel
            </button>
            <ToolbarButton onClick={onConfirm} disabled={deleting} className="text-danger hover:text-danger">
              {deleting ? 'Deleting…' : 'Delete'}
            </ToolbarButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function CurrentAutomationRow({ task }: { task: ScheduledTaskSummary }) {
  const status = statusText(task);
  const schedule = formatScheduleLabel(task);
  const project = formatProjectLabel(task);
  const title = formatTaskName(task);

  return (
    <Link
      to={`/automations/${encodeURIComponent(task.id)}`}
      className="group grid gap-3 border-t border-border-subtle py-5 text-primary transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-base sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className={`h-3 w-3 shrink-0 rounded-full border ${statusDotClass(task)}`} aria-hidden="true" />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="truncate text-[15px] font-semibold text-primary group-hover:text-accent">{title}</span>
            <span className="truncate text-[14px] text-secondary">{project}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-secondary">
            <span className={status.cls}>{status.text}</span>
            <span>{formatTargetLabel(task)}</span>
            {task.lastRunAt && <span>Last run {timeAgo(task.lastRunAt)}</span>}
          </div>
        </div>
      </div>
      <div className="text-[13px] text-secondary sm:shrink-0 sm:text-right sm:text-[14px]">{schedule}</div>
    </Link>
  );
}

function AutomationsOverview({
  tasks,
  schedulerHealth,
  onCreate,
}: {
  tasks: ScheduledTaskSummary[];
  schedulerHealth?: ScheduledTaskSchedulerHealth | null;
  onCreate: () => void;
}) {
  const rows = useMemo(() => sortAutomationRows(tasks), [tasks]);
  const enabledCount = tasks.filter((task) => task.enabled).length;
  const attentionCount = tasks.filter((task) => isFailedTaskStatus(task.lastStatus)).length;
  const runningCount = tasks.filter((task) => task.running).length;

  const pageMeta = useMemo(() => {
    if (tasks.length === 0) return undefined;
    const segments = [`${enabledCount} enabled`];
    if (runningCount > 0) segments.push(`${runningCount} running`);
    if (attentionCount > 0) segments.push(`${attentionCount} need review`);
    return segments.join(' · ');
  }, [attentionCount, enabledCount, runningCount, tasks.length]);

  return (
    <div className="h-full overflow-y-auto">
      <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="space-y-10">
        <AppPageIntro
          title="Automations"
          summary={pageMeta}
          actions={
            <ToolbarButton className="rounded-lg px-3 py-1.5 text-[12px] text-primary shadow-none" onClick={onCreate}>
              + New automation
            </ToolbarButton>
          }
        />

        {schedulerHealth && (
          <div className={`max-w-4xl border px-4 py-3 text-[13px] leading-6 ${schedulerHealthText(schedulerHealth).cls}`}>
            {schedulerHealthText(schedulerHealth).text}
          </div>
        )}

        <section className="max-w-4xl">
          <h2 className="text-[18px] font-semibold tracking-tight text-primary">Current</h2>
          <div className="mt-3 border-t border-border-subtle">
            {rows.length === 0 ? (
              <div className="py-6 text-[14px] text-secondary">No automations yet.</div>
            ) : (
              rows.map((task) => <CurrentAutomationRow key={task.id} task={task} />)
            )}
          </div>
        </section>
      </AppPageLayout>
    </div>
  );
}

function PromptBody({ value }: { value: string }) {
  const lines = value.split('\n');

  return (
    <div className="space-y-3 whitespace-pre-wrap break-words text-[14px] leading-7 text-secondary">
      {lines.map((line, index) => {
        if (line.startsWith('## ') || line.startsWith('# ')) {
          return (
            <p key={index} className="pt-2 text-[16px] font-semibold tracking-tight text-primary">
              {line.replace(/^#+\s/, '')}
            </p>
          );
        }
        if (line.trim() === '') return <div key={index} className="h-1" />;
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border-subtle pt-5">
      <h2 className="text-[15px] font-semibold text-primary">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SummaryCell({ label, value, className = '' }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className="min-w-0 border-t border-border-subtle py-4 first:border-t-0 sm:border-t sm:[&:nth-child(-n+2)]:border-t-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">{label}</div>
      <div className={`mt-2 break-words text-[14px] leading-5 text-primary ${className}`}>{value}</div>
    </div>
  );
}

function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border-subtle py-5 first:border-t-0 first:pt-0">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-primary">{title}</h2>
      <dl className="mt-3 divide-y divide-border-subtle">{children}</dl>
    </section>
  );
}

function RailLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-4 py-2.5">
      <dt className="text-[13px] text-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-[13px] text-primary">{children}</dd>
    </div>
  );
}

function AutomationDetailView({
  summary,
  onBack,
  onOpenEdit,
  onRefreshTasks,
}: {
  summary: ScheduledTaskSummary | null;
  onBack: () => void;
  onOpenEdit: () => void;
  onRefreshTasks: () => void;
}) {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const { runs } = useAppData();
  const { data, loading, error, refetch } = useApi(async () => {
    if (!id) throw new Error('Task not found.');
    return api.taskDetail(id);
  }, id);
  const [runningNow, setRunningNow] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const nowMs = useAutomationClock();

  const detail = data;
  const effectiveSummary =
    summary ??
    (detail
      ? ({
          id: detail.id,
          title: detail.title,
          filePath: detail.filePath,
          scheduleType: detail.scheduleType,
          targetType: detail.targetType,
          running: detail.running,
          enabled: detail.enabled,
          cron: detail.cron,
          at: detail.at,
          prompt: detail.prompt,
          model: detail.model,
          cwd: detail.cwd,
          threadConversationId: detail.threadConversationId,
          threadTitle: detail.threadTitle,
          lastStatus: detail.lastStatus,
          lastRunAt: detail.lastRunAt,
          lastSuccessAt: detail.lastSuccessAt,
        } satisfies ScheduledTaskSummary)
      : null);

  const title = detail?.title ?? effectiveSummary?.title ?? id ?? 'Automation';
  const status = effectiveSummary ? statusText(effectiveSummary) : { text: 'Unknown', cls: 'text-dim' };
  const scheduleLabel = effectiveSummary ? formatScheduleLabel(effectiveSummary) : 'Manual';
  const targetLabel = effectiveSummary ? formatTargetLabel(effectiveSummary) : 'Job';
  const projectLabel = effectiveSummary ? formatProjectLabel(effectiveSummary) : 'local';
  const nextRunAt = effectiveSummary ? getNextTaskRunAt(effectiveSummary, nowMs) : null;
  const expectedRunAt = effectiveSummary ? getPreviousTaskRunAt(effectiveSummary, nowMs) : null;
  const nextRunLabel = nextRunAt ? formatTaskNextRunCountdown(nextRunAt, nowMs) : '—';
  const expectedActualLabel = formatExpectedActual({
    expectedAt: expectedRunAt,
    lastRunAt: effectiveSummary?.lastRunAt,
    lastStatus: effectiveSummary?.lastStatus,
    activity: detail?.activity,
  });
  const prompt = detail?.prompt ?? effectiveSummary?.prompt ?? '';
  const taskRuns = useMemo(
    () => sortAutomationRuns((runs?.runs ?? []).filter((run) => getRunTaskId(run) === effectiveSummary?.id)),
    [effectiveSummary?.id, runs?.runs],
  );
  const latestRun = taskRuns[0];
  const latestRunStatus = latestRun ? runStatusText(latestRun) : null;
  const latestRunMoment = latestRun ? getRunMoment(latestRun) : null;
  const latestRunFailed = latestRun
    ? runNeedsAttention(latestRun) || latestRun.status?.status === 'failed' || latestRun.status?.status === 'interrupted'
    : isFailedTaskStatus(effectiveSummary?.lastStatus);
  const lastRunLabel = effectiveSummary?.lastRunAt
    ? `${isFailedTaskStatus(effectiveSummary.lastStatus) ? 'Failed' : 'Ran'} ${timeAgo(effectiveSummary.lastRunAt)}`
    : '—';
  const modelLabel = detail?.model ?? effectiveSummary?.model ?? 'Default';
  const threadLabel = detail?.threadTitle ?? effectiveSummary?.threadTitle ?? formatThreadModeLabel(detail?.threadMode);
  const timeoutLabel = formatSeconds(detail?.timeoutSeconds);
  const catchUpLabel = formatSeconds(detail?.catchUpWindowSeconds ?? effectiveSummary?.catchUpWindowSeconds);
  const scheduleTypeLabel = formatScheduleTypeLabel(effectiveSummary);

  async function handleCopyPrompt() {
    if (!prompt.trim()) return;
    try {
      await navigator.clipboard?.writeText(prompt);
    } catch (nextError) {
      console.error(nextError);
    }
  }

  async function handleRunNow() {
    if (!id || runningNow || effectiveSummary?.running) return;

    setRunningNow(true);
    try {
      await api.runTaskNow(id);
      const [refreshedDetail] = await Promise.all([refetch({ resetLoading: false }), onRefreshTasks()]);

      const threadConversationId = refreshedDetail?.threadConversationId ?? detail?.threadConversationId;
      if (threadConversationId) {
        ensureConversationTabOpen(threadConversationId);
        navigate(`/conversations/${encodeURIComponent(threadConversationId)}`);
      }
    } catch (nextError) {
      console.error(nextError);
    } finally {
      setRunningNow(false);
    }
  }

  async function handleToggleEnabled() {
    if (!id || toggling || !effectiveSummary) return;

    setToggling(true);
    try {
      await api.setTaskEnabled(id, !effectiveSummary.enabled);
      await Promise.all([refetch({ resetLoading: false }), onRefreshTasks()]);
    } catch (nextError) {
      console.error(nextError);
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    if (!id || deleting) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteTask(id);
      await onRefreshTasks();
      navigate('/automations');
    } catch (nextError) {
      setDeleteError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setDeleting(false);
    }
  }

  if (loading && !detail && !effectiveSummary) {
    return <LoadingState label="Loading automation…" className="px-8 py-12" />;
  }

  if (error && !detail && !effectiveSummary) {
    return <ErrorState message={`Failed to load automation: ${error}`} className="px-8 py-12" />;
  }

  if (!effectiveSummary) {
    return (
      <div className="px-8 py-12">
        <div className="max-w-xl space-y-4">
          <h1 className="text-[32px] font-semibold tracking-tight text-primary">Automation not found</h1>
          <p className="text-[15px] leading-7 text-secondary">This automation may have been deleted or moved.</p>
          <ToolbarButton onClick={onBack}>Back to Automations</ToolbarButton>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="h-full overflow-y-auto">
        <AppPageLayout shellClassName="max-w-[56rem]" contentClassName="space-y-7">
          <div className="space-y-5">
            <button
              type="button"
              onClick={onBack}
              className="text-[13px] text-secondary transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-base"
            >
              ← Automations
            </button>

            <div className="flex flex-col gap-4">
              <div className="min-w-0 space-y-2">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`h-3 w-3 shrink-0 rounded-full border ${statusDotClass(effectiveSummary)}`} aria-hidden="true" />
                  <h1 className="break-words text-pretty text-[28px] font-semibold leading-[1.08] tracking-tight text-primary sm:text-[32px]">
                    {title}
                  </h1>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-1 text-[13px] leading-5 text-secondary sm:text-[14px]">
                  <span className={status.cls}>{status.text}</span>
                  <span className="text-dim">·</span>
                  <span>{projectLabel}</span>
                  <span className="text-dim">·</span>
                  <span>{threadLabel}</span>
                  <span className="text-dim">·</span>
                  <span>{scheduleLabel}</span>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <ToolbarButton
                  onClick={() => {
                    void refetch({ resetLoading: false });
                    void onRefreshTasks();
                  }}
                >
                  Refresh
                </ToolbarButton>
                <ToolbarButton onClick={onOpenEdit}>Edit</ToolbarButton>
                <ToolbarButton onClick={handleToggleEnabled} disabled={toggling || effectiveSummary.running}>
                  {toggling ? '…' : effectiveSummary.enabled ? 'Disable' : 'Enable'}
                </ToolbarButton>
                <ToolbarButton
                  onClick={() => {
                    void handleRunNow();
                  }}
                  disabled={runningNow || effectiveSummary.running}
                  className="text-accent"
                >
                  {runningNow ? 'Running…' : 'Run now'}
                </ToolbarButton>
              </div>
            </div>
          </div>

          <div className="grid gap-7">
            <div className="min-w-0 space-y-7">
              <section className="grid gap-x-6 border-y border-border-subtle sm:grid-cols-2">
                <SummaryCell
                  label="Last run"
                  value={lastRunLabel}
                  className={isFailedTaskStatus(effectiveSummary.lastStatus) ? 'text-danger' : ''}
                />
                <SummaryCell label="Next run" value={nextRunLabel} />
                <SummaryCell label="Expected vs actual" value={expectedActualLabel} />
                <SummaryCell label="Schedule" value={scheduleLabel} />
                <SummaryCell label="Target" value={targetLabel} />
                <SummaryCell label="Model" value={modelLabel} />
              </section>

              {latestRunFailed && (
                <section className="border border-danger/35 border-l-danger bg-danger/10 px-5 py-4">
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="min-w-0 space-y-2">
                      <h2 className="text-[16px] font-semibold tracking-tight text-danger">Latest execution failed</h2>
                      <p className="max-w-3xl text-[14px] leading-6 text-primary">
                        {latestRun ? runResultText(latestRun) : 'The latest run failed. Inspect logs to see what needs attention.'}
                      </p>
                      <p className="text-[12px] text-secondary">
                        {latestRunMoment?.at ? `Started ${timeAgo(latestRunMoment.at)}` : 'No start timestamp'}
                        <span className="mx-2 text-dim">·</span>
                        Duration {latestRun ? formatRunDuration(latestRun) : '—'}
                        {latestRunStatus && (
                          <>
                            <span className="mx-2 text-dim">·</span>
                            <span className={latestRunStatus.cls}>{latestRunStatus.text}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
                      <ToolbarButton
                        className="text-danger"
                        onClick={() => {
                          if (latestRun) window.open(getRunLogsPath(latestRun), '_blank');
                        }}
                        disabled={!latestRun}
                      >
                        Inspect logs
                      </ToolbarButton>
                      <ToolbarButton
                        onClick={() => {
                          void handleRunNow();
                        }}
                        disabled={runningNow || effectiveSummary.running}
                      >
                        Rerun
                      </ToolbarButton>
                    </div>
                  </div>
                </section>
              )}

              <DetailSection title="Prompt">
                <div className="mb-3 flex justify-end gap-5 text-[13px] text-secondary">
                  <button
                    type="button"
                    onClick={() => {
                      void handleCopyPrompt();
                    }}
                    className="transition-colors hover:text-primary"
                  >
                    Copy
                  </button>
                  <button type="button" onClick={onOpenEdit} className="transition-colors hover:text-primary">
                    Edit
                  </button>
                </div>
                <div className="rounded-lg border border-border-subtle bg-surface/35 px-4 py-3 font-mono text-[13px] leading-6 text-secondary">
                  {prompt.trim().length > 0 ? <PromptBody value={prompt} /> : <p>No prompt configured.</p>}
                </div>
              </DetailSection>

              <DetailSection title="Executions">
                {taskRuns.length === 0 ? (
                  <p className="text-[14px] text-secondary">No executions yet.</p>
                ) : (
                  <div>
                    <div className="space-y-3">
                      {taskRuns.slice(0, 6).map((run) => {
                        const runStatus = runStatusText(run);
                        const moment = getRunMoment(run);
                        const isBad = runStatus.cls === 'text-danger';
                        return (
                          <div key={run.runId} className="border-t border-border-subtle py-3 text-[13px]">
                            <div className="flex min-w-0 items-center justify-between gap-3">
                              <div className={`flex min-w-0 items-center gap-2 ${runStatus.cls}`}>
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    isBad ? 'bg-danger' : runStatus.cls === 'text-success' ? 'bg-success' : 'bg-secondary'
                                  }`}
                                  aria-hidden="true"
                                />
                                <span className="truncate">{runStatus.text}</span>
                              </div>
                              <div className="flex shrink-0 gap-3 text-accent">
                                <button
                                  type="button"
                                  onClick={() => window.open(getRunLogsPath(run), '_blank')}
                                  className="hover:text-primary"
                                >
                                  Logs
                                </button>
                                {isBad && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void handleRunNow();
                                    }}
                                    className="hover:text-primary"
                                  >
                                    Rerun
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="mt-2 truncate font-mono text-[12px] text-dim">{run.runId}</p>
                            <p className="mt-1 text-secondary">
                              {moment.at ? timeAgo(moment.at) : 'No start timestamp'} · {formatRunDuration(run)} · {runResultText(run)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </DetailSection>

              {detail?.activity && detail.activity.length > 0 && (
                <DetailSection title="Scheduler activity">
                  <div className="space-y-3">
                    {detail.activity.slice(0, 5).map((entry) => (
                      <div key={entry.id} className="grid gap-1 text-[13px] leading-6 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-start">
                        <p className={entry.kind === 'run-failed' || entry.outcome === 'skipped' ? 'text-danger' : 'text-secondary'}>
                          {formatTaskActivity(entry)}
                        </p>
                        <p className="text-left text-[12px] text-dim sm:text-right">{timeAgo(entry.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                </DetailSection>
              )}
            </div>

            <aside className="border-t border-border-subtle pt-1">
              <RailSection title="Schedule">
                <RailLine label="Type">{scheduleTypeLabel}</RailLine>
                <RailLine label="Time">{scheduleLabel}</RailLine>
                <RailLine label="Next run">{nextRunLabel}</RailLine>
                <RailLine label="Catch-up window">{catchUpLabel}</RailLine>
              </RailSection>
              <RailSection title="Delivery">
                <RailLine label="Target">{targetLabel}</RailLine>
                <RailLine label="Thread">{threadLabel}</RailLine>
                <RailLine label="Owner">{projectLabel}</RailLine>
              </RailSection>
              <RailSection title="Runtime">
                <RailLine label="Model">{modelLabel}</RailLine>
                <RailLine label="Timeout">{timeoutLabel}</RailLine>
                <RailLine label="Scheduler">{detail?.schedulerLastEvaluatedAt ? timeAgo(detail.schedulerLastEvaluatedAt) : '—'}</RailLine>
                <RailLine label="Retries">{effectiveSummary.lastAttemptCount ?? 0}</RailLine>
              </RailSection>
              <RailSection title="Alerts">
                <RailLine label="Notifications">{effectiveSummary.enabled ? 'On failure' : 'Disabled'}</RailLine>
                <RailLine label="Last notification">
                  {isFailedTaskStatus(effectiveSummary.lastStatus) && effectiveSummary.lastRunAt
                    ? timeAgo(effectiveSummary.lastRunAt)
                    : '—'}
                </RailLine>
              </RailSection>
              <RailSection title="Danger zone">
                <button
                  type="button"
                  onClick={() => setDeleteModalOpen(true)}
                  className="mt-2 text-[13px] text-danger transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/25 focus-visible:ring-offset-2 focus-visible:ring-offset-base"
                >
                  Delete automation
                </button>
              </RailSection>
            </aside>
          </div>
        </AppPageLayout>
      </div>

      {deleteModalOpen && (
        <DeleteTaskModal
          title={title}
          deleting={deleting}
          error={deleteError}
          onCancel={() => {
            if (!deleting) setDeleteModalOpen(false);
          }}
          onConfirm={() => {
            void handleDelete();
          }}
        />
      )}
    </>
  );
}

async function refreshTaskSnapshot(setTasks: (tasks: ScheduledTaskSummary[]) => void) {
  const tasks = await api.tasks();
  setTasks(tasks);
  return tasks;
}

export function TasksPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: selectedId } = useParams<{ id?: string }>();
  const { tasks, setTasks } = useAppData();
  const { status: sseStatus } = useSseConnection();
  const { data: schedulerHealth, refetch: refetchSchedulerHealth } = useApi(() => api.taskSchedulerHealth(), 'task-scheduler-health');
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const isLoading = tasks === null && (sseStatus === 'connecting' || sseStatus === 'reconnecting');
  const visibleError =
    tasks === null && sseStatus === 'offline'
      ? (refreshError ?? 'Live updates are offline. Use refresh to load the latest automations.')
      : refreshError;
  const selectedTask = tasks?.find((task) => task.id === selectedId) ?? null;

  const refreshTasks = useCallback(async () => {
    setRefreshError(null);
    try {
      await Promise.all([refreshTaskSnapshot(setTasks), refetchSchedulerHealth({ resetLoading: false })]);
    } catch (nextError) {
      setRefreshError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [refetchSchedulerHealth, setTasks]);

  useEffect(() => {
    if (tasks === null && sseStatus === 'offline') {
      void refreshTasks();
    }
  }, [refreshTasks, sseStatus, tasks]);

  const params = new URLSearchParams(location.search);
  const composerMode = selectedId && params.get('edit') === '1' ? 'edit' : params.get('new') === '1' ? 'create' : null;

  function closeComposer() {
    if (selectedId) {
      navigate(`/automations/${encodeURIComponent(selectedId)}`);
    } else {
      navigate('/automations');
    }
  }

  return (
    <div className="flex h-full flex-col">
      {isLoading && <LoadingState label="Loading automations…" className="px-8 py-12" />}
      {visibleError && <ErrorState message={`Failed to load automations: ${visibleError}`} className="px-8 py-12" />}
      {tasks &&
        (selectedId ? (
          <AutomationDetailView
            summary={selectedTask}
            onBack={() => navigate('/automations')}
            onOpenEdit={() => navigate(`/automations/${encodeURIComponent(selectedId)}?edit=1`)}
            onRefreshTasks={() => refreshTasks()}
          />
        ) : (
          <AutomationsOverview tasks={tasks} schedulerHealth={schedulerHealth} onCreate={() => navigate('/automations?new=1')} />
        ))}
      {composerMode === 'create' && <CreateTaskModal onClose={closeComposer} />}
      {composerMode === 'edit' && selectedId && <EditTaskModal id={selectedId} onClose={closeComposer} />}
    </div>
  );
}
