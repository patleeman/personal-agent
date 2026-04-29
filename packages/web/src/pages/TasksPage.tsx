import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../client/api';
import { ensureConversationTabOpen } from '../session/sessionTabs';
import { ScheduledTaskCreatePanel, ScheduledTaskPanel } from '../components/ScheduledTaskPanel';
import { AppPageIntro, AppPageLayout, ErrorState, LoadingState, ToolbarButton } from '../components/ui';
import { useAppData, useSseConnection } from '../app/contexts';
import { useApi } from '../hooks/useApi';
import { getRunMoment, getRunTaskId, isRunInProgress, runNeedsAttention } from '../automation/runPresentation';
import { formatTaskNextRunCountdown, formatTaskSchedule, getNextTaskRunAt } from '../automation/taskSchedule';
import type { DurableRunRecord, ScheduledTaskDetail, ScheduledTaskSummary } from '../shared/types';
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
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second
    && date.getUTCMilliseconds() === millisecond;
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
    return runNeedsAttention(run)
      ? { text: 'Needs review', cls: 'text-warning' }
      : { text: 'Completed', cls: 'text-success' };
  }
  if (status === 'failed' || status === 'interrupted') return { text: 'Failed', cls: 'text-danger' };
  if (status === 'cancelled') return { text: 'Cancelled', cls: 'text-dim' };
  return { text: status ?? 'Unknown', cls: 'text-dim' };
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
      style={{ background: 'rgb(0 0 0 / 0.58)', backdropFilter: 'blur(10px)', alignItems: 'center', justifyContent: 'center', padding: '1.75rem' }}
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
      style={{ background: 'rgb(0 0 0 / 0.58)', backdropFilter: 'blur(10px)', alignItems: 'center', justifyContent: 'center', padding: '1.75rem' }}
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
      style={{ background: 'rgb(0 0 0 / 0.58)', backdropFilter: 'blur(10px)', alignItems: 'center', justifyContent: 'center', padding: '1.75rem' }}
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
            <p className="text-[14px] leading-6 text-secondary">This removes the schedule. Past runs and existing thread history stay put.</p>
          </div>
          {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} disabled={deleting} className="text-[13px] text-secondary transition-colors hover:text-primary disabled:opacity-50">
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
      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 border-t border-border-subtle py-6 text-primary transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-base"
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
      <div className="shrink-0 text-right text-[14px] text-secondary">{schedule}</div>
    </Link>
  );
}

function AutomationsOverview({
  tasks,
  onCreate,
}: {
  tasks: ScheduledTaskSummary[];
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
      <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="space-y-14">
        <AppPageIntro
          title="Automations"
          summary={pageMeta}
          actions={(
            <ToolbarButton className="rounded-lg px-3 py-1.5 text-[12px] text-primary shadow-none" onClick={onCreate}>
              + New automation
            </ToolbarButton>
          )}
        />

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
          return <p key={index} className="pt-2 text-[16px] font-semibold tracking-tight text-primary">{line.replace(/^#+\s/, '')}</p>;
        }
        if (line.trim() === '') return <div key={index} className="h-1" />;
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

function DetailLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-5">
      <dt className="text-[12px] text-dim">{label}</dt>
      <dd className="min-w-0 break-words text-[14px] text-secondary">{children}</dd>
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
  const effectiveSummary = summary ?? (detail ? {
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
  } satisfies ScheduledTaskSummary : null);

  const title = detail?.title ?? effectiveSummary?.title ?? id ?? 'Automation';
  const status = effectiveSummary ? statusText(effectiveSummary) : { text: 'Unknown', cls: 'text-dim' };
  const scheduleLabel = effectiveSummary ? formatScheduleLabel(effectiveSummary) : 'Manual';
  const targetLabel = effectiveSummary ? formatTargetLabel(effectiveSummary) : 'Job';
  const projectLabel = effectiveSummary ? formatProjectLabel(effectiveSummary) : 'local';
  const nextRunAt = effectiveSummary ? getNextTaskRunAt(effectiveSummary, nowMs) : null;
  const nextRunLabel = nextRunAt ? formatTaskNextRunCountdown(nextRunAt, nowMs) : '—';
  const prompt = detail?.prompt ?? effectiveSummary?.prompt ?? '';
  const taskRuns = useMemo(
    () => sortAutomationRuns((runs?.runs ?? []).filter((run) => getRunTaskId(run) === effectiveSummary?.id)),
    [effectiveSummary?.id, runs?.runs],
  );

  async function handleRunNow() {
    if (!id || runningNow || effectiveSummary?.running) return;

    setRunningNow(true);
    try {
      await api.runTaskNow(id);
      const [refreshedDetail] = await Promise.all([
        refetch({ resetLoading: false }),
        onRefreshTasks(),
      ]);

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
      await Promise.all([
        refetch({ resetLoading: false }),
        onRefreshTasks(),
      ]);
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
        <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="max-w-4xl space-y-8">
          <div className="space-y-5">
            <button type="button" onClick={onBack} className="text-[13px] text-secondary transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-base">
              ← Automations
            </button>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`h-3 w-3 shrink-0 rounded-full border ${statusDotClass(effectiveSummary)}`} aria-hidden="true" />
                  <h1 className="break-words text-[36px] font-semibold tracking-tight text-primary sm:text-[42px]">{title}</h1>
                </div>
                <p className="text-[14px] text-secondary">
                  <span className={status.cls}>{status.text}</span>
                  <span className="mx-2 text-dim">·</span>
                  <span>{projectLabel}</span>
                  <span className="mx-2 text-dim">·</span>
                  <span>{scheduleLabel}</span>
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); void onRefreshTasks(); }}>Refresh</ToolbarButton>
                <ToolbarButton onClick={onOpenEdit}>Edit</ToolbarButton>
                <ToolbarButton onClick={handleToggleEnabled} disabled={toggling || effectiveSummary.running}>
                  {toggling ? '…' : effectiveSummary.enabled ? 'Disable' : 'Enable'}
                </ToolbarButton>
                <ToolbarButton onClick={() => { void handleRunNow(); }} disabled={runningNow || effectiveSummary.running} className="text-accent">
                  {runningNow ? 'Running…' : 'Run now'}
                </ToolbarButton>
              </div>
            </div>
          </div>

          <DetailSection title="Prompt">
            {prompt.trim().length > 0 ? <PromptBody value={prompt} /> : <p className="text-[14px] text-secondary">No prompt configured.</p>}
          </DetailSection>

          <DetailSection title="Details">
            <dl className="divide-y divide-border-subtle">
              <DetailLine label="Schedule">{scheduleLabel}</DetailLine>
              <DetailLine label="Next run">{nextRunLabel}</DetailLine>
              <DetailLine label="Target">{targetLabel}</DetailLine>
              <DetailLine label="Thread">{detail?.threadTitle ?? formatThreadModeLabel(detail?.threadMode)}</DetailLine>
              <DetailLine label="Model">{detail?.model ?? effectiveSummary.model ?? 'Default'}</DetailLine>
            </dl>
          </DetailSection>

          <DetailSection title="Executions">
            {taskRuns.length === 0 ? (
              <p className="text-[14px] text-secondary">No executions yet.</p>
            ) : (
              <div className="divide-y divide-border-subtle border-t border-border-subtle">
                {taskRuns.slice(0, 6).map((run) => {
                  const runStatus = runStatusText(run);
                  const moment = getRunMoment(run);
                  return (
                    <div key={run.runId} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium text-primary">{run.runId}</p>
                        <p className="mt-1 text-[12px] text-secondary">{moment.at ? timeAgo(moment.at) : 'No timestamp'}</p>
                      </div>
                      <p className={`text-[13px] ${runStatus.cls}`}>{runStatus.text}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </DetailSection>

          <div className="border-t border-border-subtle pt-5">
            <button type="button" onClick={() => setDeleteModalOpen(true)} className="text-[13px] text-danger transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/25 focus-visible:ring-offset-2 focus-visible:ring-offset-base">
              Delete automation
            </button>
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
          onConfirm={() => { void handleDelete(); }}
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
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const isLoading = tasks === null && (sseStatus === 'connecting' || sseStatus === 'reconnecting');
  const visibleError = tasks === null && sseStatus === 'offline'
    ? refreshError ?? 'Live updates are offline. Use refresh to load the latest automations.'
    : refreshError;
  const selectedTask = tasks?.find((task) => task.id === selectedId) ?? null;

  const refreshTasks = useCallback(async () => {
    setRefreshError(null);
    try {
      await refreshTaskSnapshot(setTasks);
    } catch (nextError) {
      setRefreshError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [setTasks]);

  useEffect(() => {
    if (tasks === null && sseStatus === 'offline') {
      void refreshTasks();
    }
  }, [refreshTasks, sseStatus, tasks]);

  const params = new URLSearchParams(location.search);
  const composerMode = selectedId && params.get('edit') === '1'
    ? 'edit'
    : params.get('new') === '1'
      ? 'create'
      : null;

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
      {tasks && (
        selectedId
          ? <AutomationDetailView summary={selectedTask} onBack={() => navigate('/automations')} onOpenEdit={() => navigate(`/automations/${encodeURIComponent(selectedId)}?edit=1`)} onRefreshTasks={() => refreshTasks()} />
          : <AutomationsOverview tasks={tasks} onCreate={() => navigate('/automations?new=1')} />
      )}
      {composerMode === 'create' && <CreateTaskModal onClose={closeComposer} />}
      {composerMode === 'edit' && selectedId && <EditTaskModal id={selectedId} onClose={closeComposer} />}
    </div>
  );
}
