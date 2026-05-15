import { useEffect, useMemo, useRef, useState } from 'react';

import { useAppEvents } from '../app/contexts';
import { listConnectedConversationBackgroundRuns, type RunPresentationLookups } from '../automation/runPresentation';
import { api } from '../client/api';
import { useExecutionStream } from '../hooks/useExecutionStream';
import type { ConversationExecutionsResult, DurableRunListResult, ExecutionRecord } from '../shared/types';
import { cx, ErrorState, LoadingState } from './ui';

function timeAgo(iso: string | undefined): string {
  if (!iso) return '';
  const elapsed = Date.now() - Date.parse(iso);
  if (!Number.isFinite(elapsed)) return '';
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function executionStatusTone(execution: ExecutionRecord): string {
  const status = execution.status;
  if (status === 'failed' || status === 'interrupted') return 'text-danger';
  if (status === 'completed') return 'text-success';
  if (status === 'cancelled') return 'text-dim';
  if (execution.attention?.required) return 'text-warning';
  if (status === 'queued' || status === 'waiting' || status === 'running') return 'text-accent';
  return 'text-secondary';
}

function executionSortTimestamp(execution: ExecutionRecord): string {
  return execution.updatedAt ?? execution.startedAt ?? execution.createdAt ?? '';
}

export function useConversationRunList(
  conversationId: string | null | undefined,
  runs: DurableRunListResult | null,
  lookups: RunPresentationLookups,
) {
  return useMemo(() => {
    if (!conversationId) return [];
    return listConnectedConversationBackgroundRuns({ conversationId, runs, lookups });
  }, [conversationId, lookups, runs]);
}

type RunGroup = 'command' | 'subagent';

const RUN_GROUP_CONFIG: Record<RunGroup, { label: string; icon: string; tone: string }> = {
  command: { label: 'Background commands', icon: '›_', tone: 'text-accent/70' },
  subagent: { label: 'Subagents', icon: '✦', tone: 'text-accent' },
};

export function ConversationBackgroundWorkRailContent({
  conversationId,
  runs,
  activeRunId,
  lookups,
  onOpenRun,
}: {
  conversationId: string | null;
  runs: DurableRunListResult | null;
  activeRunId: string | null;
  lookups: RunPresentationLookups;
  onOpenRun: (runId: string) => void;
}) {
  void runs;
  void lookups;
  const { versions } = useAppEvents();
  const [conversationExecutions, setConversationExecutions] = useState<ConversationExecutionsResult | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setConversationExecutions(null);
      return;
    }
    let cancelled = false;
    api
      .conversationExecutions(conversationId)
      .then((result: ConversationExecutionsResult) => {
        if (!cancelled) setConversationExecutions(result);
      })
      .catch(() => {
        if (!cancelled) setConversationExecutions(null);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, versions.executions]);

  const connectedExecutions = conversationExecutions?.primary ?? [];
  const grouped = useMemo(() => {
    const groups: Record<RunGroup, ExecutionRecord[]> = { command: [], subagent: [] };
    for (const execution of connectedExecutions) {
      const group: RunGroup = execution.kind === 'background-command' ? 'command' : 'subagent';
      groups[group].push(execution);
    }
    for (const key of Object.keys(groups) as RunGroup[]) {
      groups[key].sort((a, b) => executionSortTimestamp(b).localeCompare(executionSortTimestamp(a)));
    }
    return groups;
  }, [connectedExecutions]);

  const orderedGroups: RunGroup[] = ['command', 'subagent'];
  const hasRuns = connectedExecutions.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 px-3 py-2">
        <p className="ui-section-label">Background work</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {!hasRuns ? (
          <div className="px-3 py-4 text-[12px] text-dim">No background commands or subagents for this conversation.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {orderedGroups.map((group) => {
              const items = grouped[group];
              if (items.length === 0) return null;
              const config = RUN_GROUP_CONFIG[group];
              return (
                <div key={group}>
                  <div className="flex items-center gap-2 px-1.5 py-1.5">
                    <span className={cx('font-mono text-[10px]', config.tone)}>{config.icon}</span>
                    <span className="ui-section-label">{config.label}</span>
                    <span className="text-[9px] text-dim">{items.length}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {items.map((execution) => {
                      const selected = execution.id === activeRunId;
                      const moment = execution.updatedAt ?? execution.startedAt ?? execution.createdAt;
                      return (
                        <button
                          key={execution.id}
                          type="button"
                          onClick={() => onOpenRun(execution.id)}
                          className={cx(
                            'flex w-full min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20',
                            selected ? 'bg-elevated/80 text-primary' : 'text-secondary hover:bg-elevated/60 hover:text-primary',
                          )}
                          title={execution.title}
                        >
                          <span className={cx('mt-0.5 shrink-0 font-mono text-[10px]', config.tone)}>{config.icon}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium text-primary">{execution.title}</span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-dim">
                              <span className={cx('shrink-0', executionStatusTone(execution))}>{execution.status}</span>
                            </span>
                          </span>
                          <span className="shrink-0 text-[10px] text-dim">{timeAgo(moment)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConversationBackgroundWorkWorkbenchPane({
  conversationId,
  runId,
  lookups,
}: {
  conversationId: string | null;
  runId: string | null;
  lookups: RunPresentationLookups;
}) {
  const { versions } = useAppEvents();
  const [fallbackRunId, setFallbackRunId] = useState<string | null>(null);
  const resolvedRunId = runId ?? fallbackRunId;

  useEffect(() => {
    if (runId || fallbackRunId || !conversationId) return;
    let cancelled = false;
    api
      .conversationExecutions(conversationId)
      .then((result: ConversationExecutionsResult) => {
        if (cancelled) return;
        setFallbackRunId(result.primary[0]?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [conversationId, fallbackRunId, runId, versions.executions]);

  if (!resolvedRunId) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center select-text">
        <div className="max-w-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-steel/80">Background work</p>
          <h2 className="mt-2 text-lg font-semibold text-primary text-balance">Select background work</h2>
          <p className="mt-2 text-[13px] leading-6 text-secondary">
            Pick a background command or subagent from the rail or conversation shelf.
          </p>
        </div>
      </div>
    );
  }

  return <RunDetail runId={resolvedRunId} lookups={lookups} />;
}

function RunDetail({ runId, lookups }: { runId: string; lookups: RunPresentationLookups }) {
  void lookups;
  const { detail, log, loading, error, reconnect } = useExecutionStream(runId, 360);
  const [cancelling, setCancelling] = useState(false);
  const outputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const node = outputRef.current;
      if (node) node.scrollTo({ top: node.scrollHeight });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [log?.log]);

  if (loading && !detail) return <LoadingState label="Loading background work…" className="justify-center h-full" />;
  if (error && !detail) return <ErrorState message={error} className="px-4 py-4" />;
  if (!detail) return <div className="px-5 py-5 text-[12px] text-dim">Background work not found.</div>;

  const execution = detail.execution;
  const isCommand = execution.kind === 'background-command';
  const running = execution.status === 'queued' || execution.status === 'waiting' || execution.status === 'running';
  const canCancel = execution.capabilities.canCancel;

  async function cancelExecution() {
    if (!canCancel || cancelling) return;
    setCancelling(true);
    try {
      await api.cancelExecution(execution.id);
      reconnect();
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-base">
      <div className="shrink-0 border-b border-border-subtle bg-base/95 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-secondary">
              <span
                className={cx(
                  'inline-flex items-center gap-1 rounded-md border border-accent/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent/70',
                )}
              >
                {isCommand ? '›_ Background command' : '✦ Subagent'}
              </span>
              <span className={cx('font-medium', executionStatusTone(execution))}>{execution.status}</span>
            </div>
            <h2 className="mt-1 truncate text-[17px] font-semibold text-primary" title={execution.title}>
              {execution.title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {canCancel ? (
              <button
                type="button"
                className="ui-toolbar-button text-[11px] text-danger"
                disabled={cancelling}
                onClick={() => void cancelExecution()}
              >
                {cancelling ? 'Cancelling…' : 'Cancel'}
              </button>
            ) : null}
            <button type="button" className="ui-toolbar-button text-[11px]" onClick={reconnect}>
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <div className="grid gap-3 border-b border-border-subtle pb-4 text-[12px] md:grid-cols-2 xl:grid-cols-3">
          {execution.command ? <Meta label="Command" value={execution.command} mono /> : null}
          {execution.prompt ? <Meta label="Prompt" value={execution.prompt} /> : null}
          <Meta label="cwd" value={execution.cwd ?? '—'} mono />
          {execution.model ? <Meta label="Model" value={execution.model} mono /> : null}
          <Meta label="Status" value={execution.status} />
        </div>

        {error && <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">{error}</div>}

        <div className="mt-4 min-h-[420px]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-black/35">
            <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-dim">
              <span>{isCommand ? 'Terminal output' : 'Execution output'}</span>
              <div className="flex items-center gap-2">
                {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
                <span className="truncate font-mono normal-case tracking-normal">{log?.path?.split('/').pop() ?? 'output.log'}</span>
              </div>
            </div>
            <div ref={outputRef} className="min-h-0 flex-1 overflow-auto px-3 py-3">
              {log?.log ? (
                <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-primary">{log.log}</pre>
              ) : (
                <p className="text-[12px] italic text-dim">No output yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-[0.14em] text-dim">{label}</p>
      <p className={cx('mt-1 truncate text-[12px] text-primary', mono && 'font-mono')} title={value}>
        {value}
      </p>
    </div>
  );
}
