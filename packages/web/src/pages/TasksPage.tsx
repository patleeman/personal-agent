import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ScheduledTaskCreatePanel, ScheduledTaskPanel } from '../components/ScheduledTaskPanel';
import { ErrorState, LoadingState, ToolbarButton } from '../components/ui';
import { useAppData, useSseConnection } from '../contexts';
import { useApi } from '../hooks';
import { formatTaskSchedule } from '../taskSchedule';
import type { ScheduledTaskSummary } from '../types';
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
      style={{ background: 'rgb(0 0 0 / 0.52)', backdropFilter: 'blur(8px)' }}
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
          maxWidth: '1120px',
          height: 'min(700px, calc(100vh - 4.5rem))',
          background: 'rgb(var(--color-surface) / 0.96)',
          backdropFilter: 'blur(22px)',
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
      style={{ background: 'rgb(0 0 0 / 0.52)', backdropFilter: 'blur(8px)' }}
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
          maxWidth: '1120px',
          height: 'min(700px, calc(100vh - 4.5rem))',
          background: 'rgb(var(--color-surface) / 0.96)',
          backdropFilter: 'blur(22px)',
          overscrollBehavior: 'contain',
        }}
      >
        <ScheduledTaskPanel id={id} initialMode="edit" onClose={onClose} />
      </div>
    </div>
  );
}

function AutomationTableRow({ task }: { task: ScheduledTaskSummary }) {
  const { text, cls } = statusText(task);
  const scheduleLabel = task.cron || task.at ? formatTaskSchedule(task) : 'Manual';
  const modelLabel = task.model?.split('/').pop() ?? 'Default';
  const lastRunLabel = task.lastRunAt ? timeAgo(task.lastRunAt) : '—';
  const summary = summarizePrompt(task.prompt) || 'No prompt yet.';

  return (
    <tr className="border-t border-border-subtle/80 transition-colors hover:bg-surface/80">
      <td className="px-4 py-3 align-top">
        <Link to={`/automations/${encodeURIComponent(task.id)}`} className="block min-w-0">
          <p className="text-[14px] font-medium text-primary">{formatTaskName(task)}</p>
          <p className="mt-1 line-clamp-1 text-[12px] text-secondary">{summary}</p>
        </Link>
      </td>
      <td className="px-4 py-3 align-top text-[12px] text-secondary">{scheduleLabel}</td>
      <td className="px-4 py-3 align-top text-[12px] text-secondary">{lastRunLabel}</td>
      <td className="px-4 py-3 align-top text-[12px] text-secondary">{modelLabel}</td>
      <td className="px-4 py-3 align-top">
        <span className={`inline-flex items-center gap-2 text-[12px] ${cls}`}>
          <span className={`h-2 w-2 rounded-full ${statusDotClass(task)}`} />
          {text}
        </span>
      </td>
    </tr>
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
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
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
      navigate(`/runs/${encodeURIComponent(result.runId)}`);
    } catch (nextError) {
      console.error(nextError);
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
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-dim">Details</p>
              <div className="space-y-1">
                <DetailMetaRow label="Automation ID" value={effectiveSummary.id} />
                <DetailMetaRow label="Folder" value={detail?.cwd || effectiveSummary.cwd || 'Current workspace'} />
                <DetailMetaRow label="Model" value={detail?.model || effectiveSummary.model || 'Default'} />
                {typeof detail?.timeoutSeconds === 'number' && <DetailMetaRow label="Timeout" value={`${detail.timeoutSeconds}s`} />}
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
  const rows = useMemo(() => sortAutomationRows(tasks), [tasks]);

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex items-start justify-between gap-6">
          <div className="max-w-2xl space-y-2">
            <h1 className="text-[40px] font-semibold tracking-[-0.04em] text-primary">Automations</h1>
            <p className="text-[15px] leading-6 text-secondary">
              Scheduled prompts for recurring work.
            </p>
          </div>
          <ToolbarButton className="rounded-full px-4 py-2 text-[13px] text-primary" onClick={onCreate}>+ New automation</ToolbarButton>
        </div>

        {tasks.length === 0 ? (
          <div className="max-w-xl space-y-2 py-6">
            <h2 className="text-[22px] font-semibold tracking-tight text-primary">No automations yet.</h2>
            <p className="text-[14px] leading-6 text-secondary">Use New automation to create one.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[22px] border border-border-subtle bg-surface/35">
            <table className="min-w-[760px] w-full border-collapse">
              <thead>
                <tr className="border-b border-border-subtle bg-surface/35 text-left">
                  <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-dim">Automation</th>
                  <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-dim">Schedule</th>
                  <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-dim">Last run</th>
                  <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-dim">Model</th>
                  <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-dim">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((task) => (
                  <AutomationTableRow key={task.id} task={task} />
                ))}
              </tbody>
            </table>
          </div>
        )}
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
