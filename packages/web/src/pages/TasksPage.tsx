import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { setConversationRunIdInSearch, getConversationRunIdFromSearch } from '../conversationRuns';
import { ScheduledTaskCreatePanel, ScheduledTaskPanel } from '../components/ScheduledTaskPanel';
import { ErrorState, LoadingState, ToolbarButton, cx } from '../components/ui';
import { useAppData, useSseConnection } from '../contexts';
import { useApi } from '../hooks';
import { getRunHeadline, getRunMoment, getRunTaskId, isRunInProgress, runNeedsAttention, type RunPresentationLookups } from '../runPresentation';
import { formatTaskSchedule } from '../taskSchedule';
import type { DurableRunRecord, ScheduledTaskSummary } from '../types';
import { timeAgo } from '../utils';

function statusDotClass(task: Pick<ScheduledTaskSummary, 'running' | 'enabled' | 'lastStatus'>) {
  if (task.running) return 'bg-accent animate-pulse';
  if (task.lastStatus === 'success') return 'bg-success';
  if (task.lastStatus === 'failure') return 'bg-danger';
  if (!task.enabled) return 'bg-border-default';
  return 'bg-border-default/50';
}

function statusText(task: Pick<ScheduledTaskSummary, 'running' | 'enabled' | 'lastStatus'>): { text: string; cls: string } {
  if (task.running) return { text: 'Running', cls: 'text-accent' };
  if (task.lastStatus === 'success') return { text: 'Active', cls: 'text-success' };
  if (task.lastStatus === 'failure') return { text: 'Needs attention', cls: 'text-danger' };
  if (!task.enabled) return { text: 'Disabled', cls: 'text-dim' };
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

const AUTOMATIONS_QUICK_LINKS = [
  {
    id: 'automations-overview',
    label: 'Overview',
    summary: 'Status, activity, and schedule coverage',
  },
  {
    id: 'automations-list',
    label: 'All automations',
    summary: 'Inspect prompts, schedules, and run history',
  },
] as const;

type AutomationsQuickLink = (typeof AUTOMATIONS_QUICK_LINKS)[number];
type AutomationsQuickLinkId = AutomationsQuickLink['id'];

function AutomationHero() {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7.5v4.5l3 1.5" />
        <path d="M16.5 4.5 18 3m-12 18L4.5 19.5" />
      </svg>
    </div>
  );
}

function AutomationsSection({
  id,
  label,
  description,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cx('scroll-mt-24 space-y-6', className)}>
      <div className="space-y-2">
        <h2 className="text-[28px] font-semibold tracking-[-0.035em] text-primary sm:text-[30px]">{label}</h2>
        {description ? <p className="max-w-3xl text-[13px] leading-6 text-secondary">{description}</p> : null}
      </div>
      <div className="border-t border-border-subtle/65 pt-6">{children}</div>
    </section>
  );
}

function AutomationsPanel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('grid gap-5 border-t border-border-subtle/70 py-6 first:border-t-0 first:pt-0 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:items-start lg:gap-8', className)}>
      <div className="min-w-0 space-y-2">
        <div className="space-y-1.5">
          <h3 className="text-[15px] font-medium tracking-tight text-primary">{title}</h3>
          {description ? <p className="max-w-sm text-[12px] leading-5 text-secondary">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 pt-0.5">{actions}</div> : null}
      </div>
      <div className="min-w-0 space-y-3.5">{children}</div>
    </section>
  );
}

function AutomationsTableOfContents({
  items,
  activeId,
  onNavigate,
}: {
  items: readonly AutomationsQuickLink[];
  activeId: AutomationsQuickLinkId;
  onNavigate: (sectionId: AutomationsQuickLinkId) => void;
}) {
  return (
    <aside className="hidden lg:block lg:sticky lg:top-8 lg:self-start">
      <nav aria-label="Automation sections" className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim/85">On this page</p>
        <div className="space-y-2">
          {items.map((item) => {
            const active = item.id === activeId;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(item.id);
                }}
                className={cx(
                  'block border-l py-1 pl-4 pr-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:ring-offset-2 focus-visible:ring-offset-base',
                  active ? 'border-accent text-primary' : 'border-border-subtle/60 text-secondary hover:border-border-default hover:text-primary',
                )}
                aria-current={active ? 'location' : undefined}
              >
                <span className="block text-[13px] font-medium">{item.label}</span>
                <span className={cx('mt-0.5 block text-[11px] leading-5', active ? 'text-primary/75' : 'text-dim')}>
                  {item.summary}
                </span>
              </a>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}

function AutomationOverviewStat({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">{label}</p>
      <p className="text-[30px] font-semibold tracking-[-0.04em] text-primary">{value}</p>
      <p className="text-[12px] leading-5 text-secondary">{meta}</p>
    </div>
  );
}

function AutomationListRow({ task }: { task: ScheduledTaskSummary }) {
  const { text, cls } = statusText(task);
  const scheduleLabel = task.cron || task.at ? formatTaskSchedule(task) : 'Manual';
  const modelLabel = task.model?.split('/').pop() ?? 'Default model';
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

function DetailMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-[14px]">
      <span className="text-secondary">{label}</span>
      <span className="max-w-[15rem] text-right text-primary">{value}</span>
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

  const detail = data;
  const effectiveSummary = summary ?? (detail ? {
    id: detail.id,
    title: detail.title,
    filePath: detail.filePath,
    scheduleType: detail.scheduleType,
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
  const lastRunLabel = effectiveSummary?.lastRunAt ? timeAgo(effectiveSummary.lastRunAt) : null;
  const lastSuccessLabel = effectiveSummary?.lastSuccessAt ? timeAgo(effectiveSummary.lastSuccessAt) : null;
  const threadModeLabel = formatThreadModeLabel(detail?.threadMode ?? 'dedicated');
  const selectedRunId = getConversationRunIdFromSearch(location.search);
  const runLookups = useMemo<RunPresentationLookups>(() => ({ tasks: effectiveSummary ? [effectiveSummary] : [], sessions }), [effectiveSummary, sessions]);
  const taskRuns = useMemo(
    () => sortAutomationRuns((runs?.runs ?? []).filter((run) => getRunTaskId(run) === effectiveSummary?.id)),
    [effectiveSummary?.id, runs?.runs],
  );

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
      await Promise.all([
        refetch({ resetLoading: false }),
        onRefreshTasks(),
      ]);
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
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border-subtle bg-base/94 px-6 py-4 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[12px] text-dim">
              <button type="button" onClick={onBack} className="transition-colors hover:text-primary">Automations</button>
              <span>›</span>
              <span className="truncate text-secondary">{title}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            <ToolbarButton onClick={() => { void handleRunNow(); }} disabled={runningNow || effectiveSummary.running} className="text-accent">
              {runningNow ? 'Running…' : '▷ Run now'}
            </ToolbarButton>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 overflow-y-auto px-8 py-8">
          <div className="mx-auto max-w-4xl space-y-8">
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-[13px]">
                <span className={`inline-flex items-center gap-2 ${status.cls}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(effectiveSummary)}`} />
                  {status.text}
                </span>
                <span className="text-dim">{scheduleLabel}</span>
              </div>
              <div>
                <h1 className="text-[46px] font-semibold tracking-[-0.04em] text-primary">{title}</h1>
                <p className="mt-3 max-w-3xl text-[16px] leading-7 text-secondary">{summarizePrompt(prompt) || 'No prompt yet.'}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 border-b border-border-subtle pb-3">
                <h2 className="text-[20px] font-semibold tracking-tight text-primary">Prompt</h2>
                {detail?.filePath && <span className="truncate text-[12px] text-dim">{detail.filePath.split('/').slice(-1)[0]}</span>}
              </div>
              {prompt.trim().length > 0 ? <PromptBody value={prompt} /> : <p className="text-[14px] text-secondary">No prompt configured.</p>}
            </div>

            <section className="space-y-4">
              <div className="flex items-center justify-between gap-4 border-b border-border-subtle pb-3">
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
                <p className="text-[14px] text-secondary">{selectedRunId ? 'Opening run details…' : 'No runs yet.'}</p>
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
          </div>
        </div>

        <aside className="border-t border-border-subtle px-6 py-8 xl:border-l xl:border-t-0">
          <div className="space-y-8 xl:sticky xl:top-[76px]">
            <section className="space-y-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-dim">Status</p>
              <div className="space-y-1">
                <DetailMetaRow label="State" value={status.text} />
                <DetailMetaRow label="Schedule" value={scheduleLabel} />
                <DetailMetaRow label="Last ran" value={lastRunLabel ?? '—'} />
                <DetailMetaRow label="Last success" value={lastSuccessLabel ?? '—'} />
                <DetailMetaRow label="Run history" value={taskRuns.length === 0 ? (selectedRunId ? 'Opening run details…' : 'No runs yet') : `${taskRuns.length} run${taskRuns.length === 1 ? '' : 's'}`} />
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-dim">Details</p>
              <div className="space-y-1">
                <DetailMetaRow label="Automation ID" value={effectiveSummary.id} />
                <DetailMetaRow label="Thread" value={threadModeLabel} />
                <DetailMetaRow label="Folder" value={detail?.cwd || effectiveSummary.cwd || 'Current workspace'} />
                <DetailMetaRow label="Model" value={detail?.model || effectiveSummary.model || 'Default'} />
                {detail?.thinkingLevel && <DetailMetaRow label="Reasoning" value={detail.thinkingLevel} />}
                {typeof detail?.timeoutSeconds === 'number' && <DetailMetaRow label="Timeout" value={`${detail.timeoutSeconds}s`} />}
                {detail?.threadTitle && <DetailMetaRow label="Thread title" value={detail.threadTitle} />}
                {typeof effectiveSummary.lastAttemptCount === 'number' && effectiveSummary.lastAttemptCount > 1 && (
                  <DetailMetaRow label="Attempts" value={String(effectiveSummary.lastAttemptCount)} />
                )}
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}

function AutomationsOverview({
  tasks,
  onCreate,
}: {
  tasks: ScheduledTaskSummary[];
  onCreate: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => sortAutomationRows(tasks), [tasks]);
  const runningCount = tasks.filter((task) => task.running).length;
  const attentionCount = tasks.filter((task) => task.lastStatus === 'failure').length;
  const enabledCount = tasks.filter((task) => task.enabled).length;
  const disabledCount = tasks.length - enabledCount;
  const [activeSectionId, setActiveSectionId] = useState<AutomationsQuickLinkId>(AUTOMATIONS_QUICK_LINKS[0].id);

  const pageMeta = useMemo(() => {
    if (tasks.length === 0) {
      return '0 enabled · ready for the first schedule';
    }

    const segments = [`${enabledCount} enabled`];
    if (runningCount > 0) {
      segments.push(`${runningCount} running`);
    }
    if (attentionCount > 0) {
      segments.push(`${attentionCount} need review`);
    } else {
      segments.push('all clear');
    }

    return segments.join(' · ');
  }, [attentionCount, enabledCount, runningCount, tasks.length]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const sections = AUTOMATIONS_QUICK_LINKS
      .map((item) => root.querySelector<HTMLElement>(`#${item.id}`))
      .filter((section): section is HTMLElement => Boolean(section));

    if (sections.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio);
        const nextId = visible[0]?.target.id as AutomationsQuickLinkId | undefined;
        if (nextId) {
          setActiveSectionId(nextId);
        }
      },
      {
        root,
        rootMargin: '-18% 0px -56% 0px',
        threshold: [0.15, 0.35, 0.6],
      },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const navigateToSection = useCallback((sectionId: AutomationsQuickLinkId) => {
    setActiveSectionId(sectionId);
    const section = scrollRef.current?.querySelector<HTMLElement>(`#${sectionId}`);
    section?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[86rem] px-4 py-8 sm:px-6 sm:py-10">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_13.5rem] lg:items-start xl:gap-14">
          <div className="min-w-0">
            <div className="mx-auto flex w-full max-w-[58rem] flex-col gap-12">
              <div className="space-y-6">
                <div className="flex justify-end">
                  <ToolbarButton
                    className="rounded-lg px-3 py-1.5 text-[12px] text-primary shadow-none"
                    onClick={onCreate}
                  >
                    + New automation
                  </ToolbarButton>
                </div>

                <div className="mx-auto flex max-w-[38rem] flex-col items-center text-center">
                  <AutomationHero />
                  <h1 className="ui-page-title mt-5 text-[32px] font-semibold tracking-[-0.04em] text-primary sm:text-[34px]">Automations</h1>
                  <p className="ui-page-meta mt-1.5 text-[12px]">{pageMeta}</p>
                  <p className="mt-4 text-[14px] leading-7 text-secondary">
                    Scheduled prompts, run history, and thread ownership in one place.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-12">
                <AutomationsSection
                  id="automations-overview"
                  label="Overview"
                  description="Status, activity, and schedule coverage across this workspace."
                >
                  <div className="space-y-0">
                    <AutomationsPanel
                      title="Status snapshot"
                      description="Quick read on what is running, healthy, disabled, or waiting for review."
                    >
                      <div className="grid gap-8 sm:grid-cols-2 xl:grid-cols-4">
                        <AutomationOverviewStat label="Automations" value={String(tasks.length)} meta="scheduled prompts in this workspace" />
                        <AutomationOverviewStat label="Running" value={String(runningCount)} meta="currently executing through the daemon" />
                        <AutomationOverviewStat label="Needs attention" value={String(attentionCount)} meta="last run failed or needs review" />
                        <AutomationOverviewStat label="Disabled" value={String(disabledCount)} meta={enabledCount === 0 ? 'no enabled schedules right now' : `${enabledCount} enabled right now`} />
                      </div>
                    </AutomationsPanel>
                  </div>
                </AutomationsSection>

                <AutomationsSection
                  id="automations-list"
                  label={tasks.length === 0 ? 'Get started' : 'All automations'}
                  description={tasks.length === 0
                    ? 'Create the first scheduled prompt for recurring work in this workspace.'
                    : 'Open one to inspect its prompt, schedule, and run history.'}
                >
                  <div className="space-y-0">
                    <AutomationsPanel
                      title={tasks.length === 0 ? 'No automations yet.' : 'Automation list'}
                      description={tasks.length === 0 ? 'Use New automation to create one.' : `${rows.length} total automation${rows.length === 1 ? '' : 's'} in this workspace.`}
                    >
                      {tasks.length === 0 ? (
                        <div className="max-w-xl space-y-3">
                          <p className="text-[14px] leading-6 text-secondary">Use New automation to create one.</p>
                          <div>
                            <ToolbarButton className="px-4 py-2 text-[13px]" onClick={onCreate}>New automation</ToolbarButton>
                          </div>
                        </div>
                      ) : (
                        <div className="border-t border-border-subtle/70">
                          {rows.map((task) => (
                            <AutomationListRow key={task.id} task={task} />
                          ))}
                        </div>
                      )}
                    </AutomationsPanel>
                  </div>
                </AutomationsSection>
              </div>
            </div>
          </div>

          <AutomationsTableOfContents
            items={AUTOMATIONS_QUICK_LINKS}
            activeId={activeSectionId}
            onNavigate={navigateToSection}
          />
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
