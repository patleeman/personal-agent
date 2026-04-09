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

function taskAccentIcon(task: Pick<ScheduledTaskSummary, 'running' | 'enabled' | 'lastStatus'>): string {
  if (task.running) return '◔';
  if (task.lastStatus === 'failure') return '⚠';
  if (!task.enabled) return '○';
  if (task.lastStatus === 'success') return '✦';
  return '◌';
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

function formatTaskMeta(task: Pick<ScheduledTaskSummary, 'cron' | 'at' | 'model' | 'lastRunAt'>): string[] {
  const parts: string[] = [];
  if (task.cron || task.at) {
    parts.push(formatTaskSchedule(task));
  }
  if (task.model) {
    parts.push(task.model.split('/').pop() ?? task.model);
  }
  if (task.lastRunAt) {
    parts.push(`Last run ${timeAgo(task.lastRunAt)}`);
  }
  return parts;
}

interface AutomationSection {
  id: string;
  label: string;
  items: ScheduledTaskSummary[];
}

function buildAutomationSections(tasks: ScheduledTaskSummary[]): AutomationSection[] {
  const needsAttention = tasks.filter((task) => task.running || task.lastStatus === 'failure');
  const disabled = tasks.filter((task) => !task.enabled);
  const current = tasks.filter((task) => !needsAttention.includes(task) && !disabled.includes(task));

  return [
    { id: 'current', label: 'Current', items: current },
    { id: 'needs-attention', label: 'Needs attention', items: needsAttention },
    { id: 'disabled', label: 'Disabled', items: disabled },
  ].filter((section) => section.items.length > 0);
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
          maxWidth: '980px',
          height: 'min(760px, calc(100vh - 4rem))',
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
          maxWidth: '980px',
          height: 'min(760px, calc(100vh - 4rem))',
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

function AutomationCard({ task }: { task: ScheduledTaskSummary }) {
  const { text, cls } = statusText(task);
  const meta = formatTaskMeta(task);
  const summary = summarizePrompt(task.prompt) || 'No prompt yet.';

  return (
    <Link
      to={`/automations/${encodeURIComponent(task.id)}`}
      className="group flex min-h-[172px] flex-col rounded-[26px] border border-border-subtle bg-surface/72 px-5 py-4 transition-colors hover:border-border-default hover:bg-surface"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-elevated text-[16px] text-primary">
          <span aria-hidden="true">{taskAccentIcon(task)}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className={`inline-flex items-center gap-2 ${cls}`}>
            <span className={`h-2 w-2 rounded-full ${statusDotClass(task)}`} />
            {text}
          </span>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <h3 className="text-[19px] font-semibold tracking-tight text-primary">{formatTaskName(task)}</h3>
        <p className="line-clamp-4 max-w-[34rem] text-[14px] leading-6 text-secondary">{summary}</p>
      </div>

      {meta.length > 0 && (
        <div className="mt-auto pt-6 text-[12px] text-dim">
          {meta.join(' · ')}
        </div>
      )}
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
  const sections = useMemo(() => buildAutomationSections(tasks), [tasks]);

  function jumpToSection(sectionId: string) {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-6xl space-y-10">
        <div className="flex items-start justify-between gap-6">
          <div className="max-w-3xl space-y-3">
            <h1 className="text-[48px] font-semibold tracking-[-0.045em] text-primary">Automations</h1>
            <p className="text-[17px] leading-7 text-secondary">
              Automate recurring work with scheduled prompts. Keep lightweight status checks, reports, and repo maintenance in one place.
            </p>
          </div>
          <ToolbarButton className="rounded-full px-4 py-2 text-[13px] text-primary" onClick={onCreate}>+ New automation</ToolbarButton>
        </div>

        {tasks.length === 0 ? (
          <div className="max-w-2xl space-y-4 py-10">
            <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-dim">No automations yet</p>
            <h2 className="text-[32px] font-semibold tracking-tight text-primary">Create the first scheduled workflow.</h2>
            <p className="text-[15px] leading-7 text-secondary">Start with a title, a prompt, a working directory, and a schedule. You can run it now or let it fire on its own.</p>
            <ToolbarButton onClick={onCreate}>Create automation</ToolbarButton>
          </div>
        ) : (
          <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
            <nav className="space-y-3 lg:sticky lg:top-8">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => jumpToSection(section.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-[14px] text-secondary transition-colors hover:bg-surface hover:text-primary"
                >
                  <span>{section.label}</span>
                  <span className="text-[12px] text-dim">{section.items.length}</span>
                </button>
              ))}
            </nav>

            <div className="space-y-12">
              {sections.map((section) => (
                <section key={section.id} id={section.id} className="space-y-4 scroll-mt-8">
                  <div className="flex items-end justify-between gap-4 border-b border-border-subtle pb-3">
                    <h2 className="text-[24px] font-semibold tracking-tight text-primary">{section.label}</h2>
                    <p className="text-[12px] text-dim">{section.items.length} automation{section.items.length === 1 ? '' : 's'}</p>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {section.items.map((task) => (
                      <AutomationCard key={task.id} task={task} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
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
