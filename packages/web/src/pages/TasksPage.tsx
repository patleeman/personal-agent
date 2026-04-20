import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../client/api';
import { setConversationRunIdInSearch, getConversationRunIdFromSearch } from '../conversation/conversationRuns';
import { ensureConversationTabOpen } from '../session/sessionTabs';
import { ScheduledTaskCreatePanel, ScheduledTaskPanel } from '../components/ScheduledTaskPanel';
import { ErrorState, LoadingState, ToolbarButton, cx } from '../components/ui';
import { useAppData, useSseConnection } from '../app/contexts';
import { useApi } from '../hooks/useApi';
import { getRunHeadline, getRunMoment, getRunTaskId, isRunInProgress, runNeedsAttention, type RunPresentationLookups } from '../automation/runPresentation';
import { formatTaskSchedule } from '../automation/taskSchedule';
import type { DurableRunRecord, ScheduledTaskActivityEntry, ScheduledTaskSummary } from '../shared/types';
import { timeAgo } from '../shared/utils';

function statusDotClass(task: Pick<ScheduledTaskSummary, 'running' | 'enabled' | 'lastStatus'>) {
  if (task.running) return 'bg-accent animate-pulse';
  if (!task.enabled) return 'bg-border-default';
  if (task.lastStatus === 'failure') return 'bg-danger';
  if (task.lastStatus === 'success') return 'bg-success';
  return 'bg-border-default/50';
}

function statusText(task: Pick<ScheduledTaskSummary, 'running' | 'enabled' | 'lastStatus'>): { text: string; cls: string } {
  if (task.running) return { text: 'Running', cls: 'text-accent' };
  if (!task.enabled) return { text: 'Disabled', cls: 'text-dim' };
  if (task.lastStatus === 'failure') return { text: 'Needs attention', cls: 'text-danger' };
  if (task.lastStatus === 'success') return { text: 'Active', cls: 'text-success' };
  return { text: 'Scheduled', cls: 'text-secondary' };
}

function summarizePrompt(value: string): string {
  return value
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatTaskName(task: Pick<ScheduledTaskSummary, 'id' | 'title'>): string {
  return task.title?.trim() || task.id;
}

function automationTargetLabel(task: Pick<ScheduledTaskSummary, 'targetType'>): string {
  return task.targetType === 'conversation' ? 'Thread' : 'Job';
}

function formatThreadModeLabel(mode: 'dedicated' | 'existing' | 'none'): string {
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

function taskRowRank(task: Pick<ScheduledTaskSummary, 'running' | 'enabled' | 'lastStatus'>): number {
  if (task.running) return 0;
  if (task.lastStatus === 'failure') return 1;
  if (task.enabled) return 2;
  return 3;
}

function sortAutomationRows(tasks: ScheduledTaskSummary[]): ScheduledTaskSummary[] {
  return [...tasks].sort((left, right) => {
    const rankDiff = taskRowRank(left) - taskRowRank(right);
    if (rankDiff !== 0) {
      return rankDiff;
    }

    const leftLastRun = left.lastRunAt ? Date.parse(left.lastRunAt) : 0;
    const rightLastRun = right.lastRunAt ? Date.parse(right.lastRunAt) : 0;
    if (leftLastRun !== rightLastRun) {
      return rightLastRun - leftLastRun;
    }

    return formatTaskName(left).localeCompare(formatTaskName(right));
  });
}

function sortAutomationRuns(runs: DurableRunRecord[]): DurableRunRecord[] {
  return [...runs].sort((left, right) => {
    const leftAttention = runNeedsAttention(left) ? 1 : 0;
    const rightAttention = runNeedsAttention(right) ? 1 : 0;
    if (leftAttention !== rightAttention) {
      return rightAttention - leftAttention;
    }

    const leftActive = isRunInProgress(left) ? 1 : 0;
    const rightActive = isRunInProgress(right) ? 1 : 0;
    if (leftActive !== rightActive) {
      return rightActive - leftActive;
    }

    const leftAt = getRunMoment(left).at ?? '';
    const rightAt = getRunMoment(right).at ?? '';
    return rightAt.localeCompare(leftAt) || right.runId.localeCompare(left.runId);
  });
}

function automationRunStatus(run: DurableRunRecord): { text: string; cls: string } {
  const status = run.status?.status;
  if (status === 'running' || status === 'recovering' || status === 'queued' || status === 'waiting') {
    return { text: 'Running', cls: 'text-accent' };
  }
  if (status === 'completed') {
    return { text: runNeedsAttention(run) ? 'Needs review' : 'Completed', cls: runNeedsAttention(run) ? 'text-warning' : 'text-success' };
  }
  if (status === 'failed' || status === 'interrupted') {
    return { text: 'Failed', cls: 'text-danger' };
  }
  if (status === 'cancelled') {
    return { text: 'Cancelled', cls: 'text-dim' };
  }
  return { text: status ?? 'Unknown', cls: 'text-dim' };
}

function automationActivityStatus(entry: ScheduledTaskActivityEntry): { text: string; cls: string } {
  return entry.outcome === 'catch-up-started'
    ? { text: 'Catch-up started', cls: 'text-accent' }
    : { text: 'Skipped', cls: 'text-warning' };
}

function automationActivityHeadline(entry: ScheduledTaskActivityEntry): string {
  return entry.count === 1 ? 'Missed run' : `Missed ${entry.count} runs`;
}

function automationActivitySummary(entry: ScheduledTaskActivityEntry): string {
  if (entry.outcome === 'catch-up-started') {
    return entry.count === 1
      ? 'The daemon missed this slot while offline and started a catch-up run when it came back.'
      : 'The daemon missed these slots while offline and started one catch-up run for the latest slot when it came back.';
  }

  return entry.count === 1
    ? 'The daemon was offline, so this scheduled slot did not run.'
    : 'The daemon was offline, so these scheduled slots did not run.';
}

function CreateTaskModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.58)', backdropFilter: 'blur(10px)', alignItems: 'center', justifyContent: 'center', padding: '1.75rem' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
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
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.58)', backdropFilter: 'blur(10px)', alignItems: 'center', justifyContent: 'center', padding: '1.75rem' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
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

function AutomationsSection({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cx('scroll-mt-24 space-y-4', className)}>
      <h2 className="text-[28px] font-semibold tracking-[-0.035em] text-primary sm:text-[30px]">{label}</h2>
      {children}
    </section>
  );
}

function DeleteTaskModal({
  title,
  deleting,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  deleting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !deleting) {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleting, onClose]);

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.58)', backdropFilter: 'blur(10px)', alignItems: 'center', justifyContent: 'center', padding: '1.75rem' }}
      onMouseDown={(event) => {
        if (!deleting && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delete automation"
        className="ui-dialog-shell"
        style={{
          maxWidth: '440px',
          background: 'rgb(var(--color-surface) / 0.985)',
          backdropFilter: 'blur(28px)',
          boxShadow: '0 28px 80px rgb(0 0 0 / 0.35)',
        }}
      >
        <div className="space-y-4 px-6 py-6">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim">Delete automation</p>
            <h2 className="text-[24px] font-semibold tracking-tight text-primary">Delete “{title}”?</h2>
            <p className="text-[14px] leading-6 text-secondary">
              This removes the schedule from Automations. It will not undo past runs or existing thread history.
            </p>
          </div>

          {error ? <p className="text-[12px] text-danger" aria-live="polite">{error}</p> : null}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={deleting}
              className="text-[13px] text-secondary transition-colors hover:text-primary disabled:cursor-default disabled:opacity-50"
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

function AutomationListRow({ task }: { task: ScheduledTaskSummary }) {
  const { text, cls } = statusText(task);
  const scheduleLabel = task.cron || task.at ? formatTaskSchedule(task) : 'Manual';
  const targetLabel = automationTargetLabel(task);
  const modelLabel = task.targetType === 'conversation'
    ? (task.threadTitle ? `Thread · ${task.threadTitle}` : 'Conversation wakeup')
    : (task.model?.split('/').pop() ?? 'Default model');
  const lastRunLabel = task.lastRunAt ? `Last run ${timeAgo(task.lastRunAt)}` : 'Never run';
  const summary = summarizePrompt(task.prompt) || 'No prompt yet.';

  return (
    <Link
      to={`/automations/${encodeURIComponent(task.id)}`}
      className="group block border-t border-border-subtle py-5 first:border-t-0"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className={`inline-flex items-center gap-2 text-[12px] ${cls}`}>
              <span className={`h-2 w-2 rounded-full ${statusDotClass(task)}`} />
              {text}
            </span>
            <span className="text-[12px] text-secondary">{scheduleLabel}</span>
            <span className="text-[12px] text-secondary">{targetLabel}</span>
          </div>
          <p className="mt-2 break-words text-[18px] font-semibold tracking-tight text-primary transition-colors group-hover:text-accent">
            {formatTaskName(task)}
          </p>
          <p className="mt-1 max-w-3xl text-[14px] leading-6 text-secondary">{summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-secondary">
            <span>{lastRunLabel}</span>
            <span>{modelLabel}</span>
          </div>
        </div>
        <div className="shrink-0 text-[12px] text-accent transition-colors group-hover:text-primary">Open →</div>
      </div>
    </Link>
  );
}

interface AssociatedAutomationThread {
  conversationId: string;
  title: string;
  cwd?: string;
  lastActivityAt?: string;
  automationTitles: string[];
}

function AutomationThreadRow({ thread }: { thread: AssociatedAutomationThread }) {
  const automationCountLabel = `${thread.automationTitles.length} automation${thread.automationTitles.length === 1 ? '' : 's'}`;
  const automationSummary = thread.automationTitles.join(' · ');
  const lastActivityLabel = thread.lastActivityAt ? `Last active ${timeAgo(thread.lastActivityAt)}` : 'No activity yet';

  return (
    <Link
      to={`/conversations/${encodeURIComponent(thread.conversationId)}`}
      className="group block border-t border-border-subtle py-5 first:border-t-0"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-secondary">
            <span>{automationCountLabel}</span>
            <span>{lastActivityLabel}</span>
          </div>
          <p className="mt-2 break-words text-[18px] font-semibold tracking-tight text-primary transition-colors group-hover:text-accent">
            {thread.title}
          </p>
          <p className="mt-1 max-w-3xl break-words text-[14px] leading-6 text-secondary">{automationSummary}</p>
        </div>
        <div className="shrink-0 text-[12px] text-accent transition-colors group-hover:text-primary">Open →</div>
      </div>
    </Link>
  );
}

function PromptBody({ value }: { value: string }) {
  const lines = value.split('\n');

  return (
    <div className="space-y-3 text-[15px] leading-7 text-secondary whitespace-pre-wrap break-words">
      {lines.map((line, index) => {
        if (line.startsWith('## ') || line.startsWith('# ')) {
          return <p key={index} className="pt-2 text-[18px] font-semibold tracking-tight text-primary">{line.replace(/^#+\s/, '')}</p>;
        }
        if (line.trim() === '') {
          return <div key={index} className="h-2" />;
        }
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

function DetailMetaBlock({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">{label}</p>
      <p className="break-words text-[15px] leading-6 text-primary">{value}</p>
      {hint ? <p className="break-words text-[12px] leading-5 text-secondary">{hint}</p> : null}
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
  const location = useLocation();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const { runs, sessions } = useAppData();
  const { data, loading, error, refetch } = useApi(async () => {
    if (!id) {
      throw new Error('Task not found.');
    }
    return api.taskDetail(id);
  }, id);
  const [runningNow, setRunningNow] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    lastStatus: detail.lastStatus,
    lastRunAt: detail.lastRunAt,
  } satisfies ScheduledTaskSummary : null);

  const status = effectiveSummary ? statusText(effectiveSummary) : { text: 'Unknown', cls: 'text-dim' };
  const prompt = detail?.prompt ?? effectiveSummary?.prompt ?? '';
  const title = detail?.title ?? effectiveSummary?.title ?? id ?? 'Automation';
  const scheduleLabel = detail ? formatTaskSchedule(detail) : effectiveSummary ? formatTaskSchedule(effectiveSummary) : 'Manual';
  const targetLabel = automationTargetLabel(detail ?? effectiveSummary ?? { targetType: 'background-agent' });
  const lastRunLabel = effectiveSummary?.lastRunAt ? timeAgo(effectiveSummary.lastRunAt) : null;
  const lastSuccessLabel = effectiveSummary?.lastSuccessAt ? timeAgo(effectiveSummary.lastSuccessAt) : null;
  const threadModeLabel = formatThreadModeLabel(detail?.threadMode ?? 'dedicated');
  const selectedRunId = getConversationRunIdFromSearch(location.search);
  const runLookups = useMemo<RunPresentationLookups>(() => ({ tasks: effectiveSummary ? [effectiveSummary] : [], sessions }), [effectiveSummary, sessions]);
  const taskRuns = useMemo(
    () => sortAutomationRuns((runs?.runs ?? []).filter((run) => getRunTaskId(run) === effectiveSummary?.id)),
    [effectiveSummary?.id, runs?.runs],
  );
  const runHistoryLabel = taskRuns.length === 0
    ? (selectedRunId ? 'Opening run details…' : 'No runs yet')
    : `${taskRuns.length} run${taskRuns.length === 1 ? '' : 's'}`;
  const activityEntries = detail?.activity ?? [];
  const folderLabel = detail?.cwd || effectiveSummary?.cwd || 'Current workspace';
  const modelLabel = detail?.targetType === 'conversation'
    ? 'Not used for thread wakeups'
    : (detail?.model || effectiveSummary?.model || 'Default');
  const definitionLabel = detail?.filePath ? detail.filePath.split('/').slice(-1)[0] : null;

  const setSelectedRun = useCallback((runId: string | null) => {
    navigate({
      pathname: location.pathname,
      search: setConversationRunIdInSearch(location.search, runId),
    });
  }, [location.pathname, location.search, navigate]);

  async function handleRunNow() {
    if (!id || runningNow || effectiveSummary?.running) {
      return;
    }

    setRunningNow(true);
    try {
      const result = await api.runTaskNow(id);
      const [refreshedDetail] = await Promise.all([
        refetch({ resetLoading: false }),
        onRefreshTasks(),
      ]);

      const threadConversationId = refreshedDetail?.threadConversationId ?? detail?.threadConversationId;
      if (threadConversationId) {
        ensureConversationTabOpen(threadConversationId);
        navigate(`/conversations/${encodeURIComponent(threadConversationId)}`);
        return;
      }

      setSelectedRun(result.runId);
    } catch (nextError) {
      console.error(nextError);
    } finally {
      setRunningNow(false);
    }
  }

  async function handleToggleEnabled() {
    if (!id || toggling || !effectiveSummary) {
      return;
    }

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
    if (!id || deleting) {
      return;
    }

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
          <p className="text-[12px] uppercase tracking-[0.18em] text-dim">Automations</p>
          <h1 className="text-[36px] font-semibold tracking-tight text-primary">Automation not found</h1>
          <p className="text-[15px] leading-7 text-secondary">This automation may have been deleted or moved. Go back to the automation list and pick another one.</p>
          <ToolbarButton onClick={onBack}>Back to automations</ToolbarButton>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="sticky top-0 z-10 border-b border-border-subtle bg-base/94 px-6 py-4 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[960px] flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[12px] text-dim">
                <button type="button" onClick={onBack} className="transition-colors hover:text-primary">Automations</button>
                <span>›</span>
                <span className="truncate text-secondary">{title}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); void onRefreshTasks(); }}>
                ↻ Refresh
              </ToolbarButton>
              <ToolbarButton onClick={handleToggleEnabled} disabled={toggling || effectiveSummary.running}>
                {toggling ? '…' : effectiveSummary.enabled ? 'Disable' : 'Enable'}
              </ToolbarButton>
              {detail?.threadConversationId && (
                <ToolbarButton onClick={() => navigate(`/conversations/${encodeURIComponent(detail.threadConversationId)}`)}>
                  Open thread
                </ToolbarButton>
              )}
              <ToolbarButton onClick={onOpenEdit}>Edit</ToolbarButton>
              <ToolbarButton
                onClick={() => {
                  setDeleteError(null);
                  setDeleteModalOpen(true);
                }}
                disabled={deleting}
                className="text-danger hover:text-danger"
              >
                Delete
              </ToolbarButton>
              <ToolbarButton onClick={() => { void handleRunNow(); }} disabled={runningNow || effectiveSummary.running} className="text-accent">
                {runningNow ? 'Running…' : '▷ Run now'}
              </ToolbarButton>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
          <div className="mx-auto max-w-[960px] space-y-8">
            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 text-[13px]">
                <span className={`inline-flex items-center gap-2 ${status.cls}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(effectiveSummary)}`} />
                  {status.text}
                </span>
                <span className="text-dim">{scheduleLabel}</span>
                <span className="text-dim">{targetLabel}</span>
              </div>
              <div>
                <h1 className="text-[46px] font-semibold tracking-[-0.04em] text-primary">{title}</h1>
              </div>
            </section>

            <section className="grid gap-6 border-t border-border-subtle pt-6 sm:grid-cols-2 xl:grid-cols-3">
              <DetailMetaBlock label="State" value={status.text} hint={effectiveSummary.enabled ? scheduleLabel : 'schedule disabled'} />
              <DetailMetaBlock label="Target" value={targetLabel} hint={detail?.targetType === 'conversation' ? 'injects the prompt back into a thread' : 'runs the prompt as a background automation'} />
              <DetailMetaBlock label="Last ran" value={lastRunLabel ?? '—'} hint={lastRunLabel ? 'most recent attempt' : 'no runs yet'} />
              <DetailMetaBlock label="Last success" value={lastSuccessLabel ?? '—'} hint={lastSuccessLabel ? 'most recent successful run' : 'no successful runs yet'} />
              <DetailMetaBlock label="Run history" value={runHistoryLabel} hint={selectedRunId ? 'run details open below' : 'owned by this automation'} />
              <DetailMetaBlock label="Thread" value={threadModeLabel} hint={detail?.threadTitle ?? (detail?.threadConversationId ? 'open from the toolbar' : 'no attached thread')} />
              <DetailMetaBlock label="Model" value={modelLabel} hint={detail?.targetType === 'conversation' ? 'thread wakeups reuse the thread context instead' : (detail?.thinkingLevel ? `Reasoning: ${detail.thinkingLevel}` : 'uses default reasoning')} />
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-[20px] font-semibold tracking-tight text-primary">Configuration</h2>
                  <p className="mt-1 text-[13px] text-secondary">The bits that matter without shoving them into a skinny side rail.</p>
                </div>
                {definitionLabel && <span className="truncate text-[12px] text-dim">{definitionLabel}</span>}
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                <DetailMetaBlock label="Automation ID" value={effectiveSummary.id} />
                <DetailMetaBlock label="Folder" value={folderLabel} />
                {detail?.threadTitle && <DetailMetaBlock label="Thread title" value={detail.threadTitle} />}
                {detail?.scheduleType === 'cron' && <DetailMetaBlock label="Catch-up" value={formatCatchUpWindowLabel(detail.catchUpWindowSeconds)} hint={detail.catchUpWindowSeconds ? 'run once after wake if the last missed slot is still fresh' : 'skip missed runs while the daemon was offline'} />}
                {typeof detail?.timeoutSeconds === 'number' && <DetailMetaBlock label="Timeout" value={`${detail.timeoutSeconds}s`} />}
                {typeof effectiveSummary.lastAttemptCount === 'number' && effectiveSummary.lastAttemptCount > 1 && (
                  <DetailMetaBlock label="Attempts" value={String(effectiveSummary.lastAttemptCount)} hint="last run retries" />
                )}
                {detail?.filePath && <DetailMetaBlock label="Definition path" value={detail.filePath} />}
              </div>
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-[20px] font-semibold tracking-tight text-primary">Prompt</h2>
                {definitionLabel && <span className="truncate text-[12px] text-dim">{definitionLabel}</span>}
              </div>
              {prompt.trim().length > 0 ? <PromptBody value={prompt} /> : <p className="text-[14px] text-secondary">No prompt configured.</p>}
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-[20px] font-semibold tracking-tight text-primary">Runs</h2>
                  <p className="mt-1 text-[13px] text-secondary">This automation owns its run history.</p>
                </div>
                {selectedRunId && (
                  <ToolbarButton onClick={() => setSelectedRun(null)}>
                    Hide run details
                  </ToolbarButton>
                )}
              </div>

              {taskRuns.length === 0 ? (
                <p className="text-[14px] text-secondary">{runHistoryLabel}</p>
              ) : (
                <div className="space-y-2">
                  {taskRuns.slice(0, 8).map((run) => {
                    const headline = getRunHeadline(run, runLookups);
                    const runStatus = automationRunStatus(run);
                    const activityAt = getRunMoment(run).at;
                    const selected = selectedRunId === run.runId;

                    return (
                      <button
                        key={run.runId}
                        type="button"
                        onClick={() => setSelectedRun(selected ? null : run.runId)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left transition ${selected ? 'border-accent bg-surface' : 'border-border-subtle/80 hover:border-border-default hover:bg-surface/70'}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-[14px] font-medium text-primary">{headline.title}</p>
                              <span className={`text-[12px] ${runStatus.cls}`}>{runStatus.text}</span>
                            </div>
                            <p className="mt-1 text-[12px] text-secondary">{headline.summary}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-dim">
                              <span>{run.runId}</span>
                              {activityAt && <><span>·</span><span>{timeAgo(activityAt)}</span></>}
                              {runNeedsAttention(run) && <><span>·</span><span className="text-warning">needs review</span></>}
                            </div>
                          </div>
                          <span className="text-[12px] text-accent">{selected ? 'Hide' : 'Inspect'}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {detail && (
              <section className="space-y-4 border-t border-border-subtle pt-6">
                <div>
                  <h2 className="text-[20px] font-semibold tracking-tight text-primary">Activity</h2>
                  <p className="mt-1 text-[13px] text-secondary">Missed schedules and catch-up decisions for this automation.</p>
                </div>

                {activityEntries.length === 0 ? (
                  <p className="text-[14px] text-secondary">No schedule events yet.</p>
                ) : (
                  <div className="space-y-2">
                    {activityEntries.map((entry) => {
                      const statusMeta = automationActivityStatus(entry);

                      return (
                        <div key={entry.id} className="rounded-2xl border border-border-subtle/80 px-4 py-3">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-[14px] font-medium text-primary">{automationActivityHeadline(entry)}</p>
                                <span className={`text-[12px] ${statusMeta.cls}`}>{statusMeta.text}</span>
                              </div>
                              <p className="mt-1 text-[12px] text-secondary">{automationActivitySummary(entry)}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-dim">
                                <span>Detected {timeAgo(entry.createdAt)}</span>
                                <span>·</span>
                                <span>Latest slot {timeAgo(entry.lastScheduledAt)}</span>
                                {entry.count > 1 && <><span>·</span><span>First slot {timeAgo(entry.firstScheduledAt)}</span></>}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>

      {deleteModalOpen && (
        <DeleteTaskModal
          title={title}
          deleting={deleting}
          error={deleteError}
          onClose={() => {
            if (deleting) {
              return;
            }
            setDeleteModalOpen(false);
            setDeleteError(null);
          }}
          onConfirm={() => { void handleDelete(); }}
        />
      )}
    </>
  );
}

function AutomationsOverview({
  tasks,
  onCreate,
}: {
  tasks: ScheduledTaskSummary[];
  onCreate: () => void;
}) {
  const { sessions } = useAppData();
  const rows = useMemo(() => sortAutomationRows(tasks), [tasks]);
  const runningCount = tasks.filter((task) => task.running).length;
  const attentionCount = tasks.filter((task) => task.lastStatus === 'failure').length;
  const enabledCount = tasks.filter((task) => task.enabled).length;

  const pageMeta = useMemo(() => {
    if (tasks.length === 0) {
      return 'No automation jobs yet.';
    }

    const segments = [`${enabledCount} enabled`];
    if (runningCount > 0) {
      segments.push(`${runningCount} running`);
    }
    if (attentionCount > 0) {
      segments.push(`${attentionCount} need review`);
    }

    return segments.join(' · ');
  }, [attentionCount, enabledCount, runningCount, tasks.length]);

  const associatedThreads = useMemo(() => {
    const sessionsById = new Map((sessions ?? []).map((session) => [session.id, session] as const));
    const tasksById = new Map(rows.map((task) => [task.id, task] as const));
    const byConversationId = new Map<string, {
      conversationId: string;
      title: string;
      cwd?: string;
      lastActivityAt?: string;
      automationTitles: string[];
    }>();

    function upsertThread(conversationId: string, input: {
      title?: string;
      cwd?: string;
      lastActivityAt?: string;
      automationTitle?: string;
    }) {
      const existing = byConversationId.get(conversationId);
      if (!existing) {
        byConversationId.set(conversationId, {
          conversationId,
          title: input.title?.trim() || conversationId,
          cwd: input.cwd,
          lastActivityAt: input.lastActivityAt,
          automationTitles: input.automationTitle ? [input.automationTitle] : [],
        });
        return;
      }

      if ((!existing.title || existing.title === conversationId) && input.title?.trim()) {
        existing.title = input.title.trim();
      }
      if (!existing.cwd && input.cwd) {
        existing.cwd = input.cwd;
      }
      if (input.lastActivityAt && (!existing.lastActivityAt || input.lastActivityAt > existing.lastActivityAt)) {
        existing.lastActivityAt = input.lastActivityAt;
      }
      if (input.automationTitle && !existing.automationTitles.includes(input.automationTitle)) {
        existing.automationTitles.push(input.automationTitle);
      }
    }

    rows.forEach((task) => {
      if (!task.threadConversationId) {
        return;
      }

      const session = sessionsById.get(task.threadConversationId);
      upsertThread(task.threadConversationId, {
        title: session?.title || task.threadTitle || formatTaskName(task),
        cwd: session?.cwd || task.cwd,
        lastActivityAt: session?.lastActivityAt || session?.timestamp,
        automationTitle: formatTaskName(task),
      });
    });

    (sessions ?? []).forEach((session) => {
      if (!session.automationTaskId && !session.automationTitle) {
        return;
      }

      const linkedTask = session.automationTaskId ? tasksById.get(session.automationTaskId) : undefined;
      upsertThread(session.id, {
        title: session.title,
        cwd: session.cwd,
        lastActivityAt: session.lastActivityAt || session.timestamp,
        automationTitle: linkedTask ? formatTaskName(linkedTask) : session.automationTitle,
      });
    });

    return Array.from(byConversationId.values())
      .map((thread) => ({
        ...thread,
        automationTitles: [...thread.automationTitles].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => {
        const leftActivity = left.lastActivityAt ?? '';
        const rightActivity = right.lastActivityAt ?? '';
        return rightActivity.localeCompare(leftActivity) || left.title.localeCompare(right.title);
      }) satisfies AssociatedAutomationThread[];
  }, [rows, sessions]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[72rem] px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim">Automations</p>
            <div className="space-y-1">
              <h1 className="text-[32px] font-semibold tracking-[-0.04em] text-primary sm:text-[34px]">Automations</h1>
              <p className="text-[13px] text-secondary">{pageMeta}</p>
            </div>
          </div>
          <ToolbarButton
            className="rounded-lg px-3 py-1.5 text-[12px] text-primary shadow-none"
            onClick={onCreate}
          >
            + New automation
          </ToolbarButton>
        </div>

        <div className="mt-10 space-y-12">
          <AutomationsSection id="automation-jobs" label="Jobs">
            {tasks.length === 0 ? (
              <div className="space-y-4 border-t border-border-subtle/65 pt-6">
                <p className="max-w-xl text-[14px] leading-6 text-secondary">No jobs yet.</p>
                <ToolbarButton className="px-4 py-2 text-[13px]" onClick={onCreate}>New automation</ToolbarButton>
              </div>
            ) : (
              <div className="border-t border-border-subtle/70">
                {rows.map((task) => (
                  <AutomationListRow key={task.id} task={task} />
                ))}
              </div>
            )}
          </AutomationsSection>

          <AutomationsSection id="automation-threads" label="Threads">
            {associatedThreads.length === 0 ? (
              <div className="border-t border-border-subtle/65 pt-6">
                <p className="max-w-xl text-[14px] leading-6 text-secondary">No associated threads yet.</p>
              </div>
            ) : (
              <div className="border-t border-border-subtle/70">
                {associatedThreads.map((thread) => (
                  <AutomationThreadRow key={thread.conversationId} thread={thread} />
                ))}
              </div>
            )}
          </AutomationsSection>
        </div>
      </div>
    </div>
  );
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
    try {
      const next = await api.tasks();
      setTasks(next);
      setRefreshError(null);
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRefreshError(message);
      return null;
    }
  }, [setTasks]);

  const query = new URLSearchParams(location.search);
  const showingCreateForm = query.get('new') === '1';
  const showingEditForm = Boolean(selectedId) && query.get('edit') === '1';

  const setComposerMode = useCallback((mode: 'new' | 'edit' | null) => {
    const nextSearch = new URLSearchParams(location.search);
    nextSearch.delete('new');
    nextSearch.delete('edit');

    if (mode === 'new') {
      nextSearch.set('new', '1');
    } else if (mode === 'edit') {
      nextSearch.set('edit', '1');
    }

    const nextSearchString = nextSearch.toString();
    navigate({
      pathname: location.pathname,
      search: nextSearchString ? `?${nextSearchString}` : '',
    });
  }, [location.pathname, location.search, navigate]);

  return (
    <div className="flex h-full flex-col">
      {isLoading && <LoadingState label="Loading automations…" className="px-8 py-12" />}
      {visibleError && <ErrorState message={`Failed to load automations: ${visibleError}`} className="px-8 py-12" />}
      {!isLoading && !visibleError && tasks && (
        selectedId
          ? <AutomationDetailView summary={selectedTask} onBack={() => navigate('/automations')} onOpenEdit={() => setComposerMode('edit')} onRefreshTasks={() => refreshTasks()} />
          : <AutomationsOverview tasks={tasks} onCreate={() => setComposerMode('new')} />
      )}

      {showingCreateForm && <CreateTaskModal onClose={() => setComposerMode(null)} />}
      {showingEditForm && selectedId && <EditTaskModal id={selectedId} onClose={() => setComposerMode(null)} />}
    </div>
  );
}
