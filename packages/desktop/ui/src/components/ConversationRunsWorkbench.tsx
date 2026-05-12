import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAppEvents } from '../app/contexts';
import {
  getRunConnections,
  getRunHeadline,
  getRunMoment,
  getRunTargetCommand,
  getRunTargetModel,
  getRunTargetProfile,
  getRunTargetPrompt,
  getRunWorkingDirectory,
  listConnectedConversationBackgroundRuns,
  runNeedsAttention,
  type RunPresentationLookups,
} from '../automation/runPresentation';
import { api } from '../client/api';
import { useDurableRunStream } from '../hooks/useDurableRunStream';
import type { DurableRunListResult, DurableRunRecord } from '../shared/types';
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

function statusTone(run: DurableRunRecord): string {
  const status = run.status?.status;
  if (status === 'failed' || status === 'interrupted') return 'text-danger';
  if (status === 'completed') return 'text-success';
  if (status === 'cancelled') return 'text-dim';
  if (status === 'recovering' || runNeedsAttention(run)) return 'text-warning';
  if (status === 'queued' || status === 'waiting' || status === 'running') return 'text-accent';
  return 'text-secondary';
}

function statusLabel(run: DurableRunRecord): string {
  return run.status?.status ?? 'unknown';
}

function runSortTimestamp(run: DurableRunRecord): string {
  return getRunMoment(run).at ?? run.manifest?.createdAt ?? '';
}

function isShellRun(run: DurableRunRecord): boolean {
  return run.manifest?.kind === 'raw-shell' || Boolean(getRunTargetCommand(run));
}

function terminalStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'interrupted';
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

export function ConversationRunsRailContent({
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
  const connectedRuns = useConversationRunList(conversationId, runs, lookups);
  const grouped = useMemo(() => {
    const groups: Record<RunGroup, DurableRunRecord[]> = { command: [], subagent: [] };
    for (const run of connectedRuns) {
      const group: RunGroup = isShellRun(run) ? 'command' : 'subagent';
      groups[group].push(run);
    }
    for (const key of Object.keys(groups) as RunGroup[]) {
      groups[key].sort((a, b) => runSortTimestamp(b).localeCompare(runSortTimestamp(a)));
    }
    return groups;
  }, [connectedRuns]);

  const orderedGroups: RunGroup[] = ['command', 'subagent'];
  const hasRuns = connectedRuns.length > 0;

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
                    {items.map((run) => {
                      const headline = getRunHeadline(run, lookups);
                      const selected = run.runId === activeRunId;
                      const moment = getRunMoment(run);
                      return (
                        <button
                          key={run.runId}
                          type="button"
                          onClick={() => onOpenRun(run.runId)}
                          className={cx(
                            'flex w-full min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20',
                            selected ? 'bg-elevated/80 text-primary' : 'text-secondary hover:bg-elevated/60 hover:text-primary',
                          )}
                          title={headline.title}
                        >
                          <span className={cx('mt-0.5 shrink-0 font-mono text-[10px]', config.tone)}>{config.icon}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium text-primary">{headline.title}</span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-dim">
                              <span className={cx('shrink-0', statusTone(run))}>{statusLabel(run)}</span>
                            </span>
                          </span>
                          <span className="shrink-0 text-[10px] text-dim">{timeAgo(moment.at)}</span>
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

export function ConversationRunWorkbenchPane({
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
      .runs()
      .then((result) => {
        if (cancelled) return;
        const first = listConnectedConversationBackgroundRuns({ conversationId, runs: result, lookups })[0]?.runId ?? null;
        setFallbackRunId(first);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [conversationId, fallbackRunId, lookups, runId, versions.runs]);

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
  const { detail, log, loading, error, reconnect } = useDurableRunStream(runId, 360);

  if (loading && !detail) return <LoadingState label="Loading background work…" className="justify-center h-full" />;
  if (error && !detail) return <ErrorState message={error} className="px-4 py-4" />;
  if (!detail) return <div className="px-5 py-5 text-[12px] text-dim">Background work not found.</div>;

  const run = detail.run;
  const shell = isShellRun(run);

  if (shell) {
    return <ShellRunDetail run={run} log={log} error={error} reconnect={reconnect} lookups={lookups} />;
  }

  return <AgentRunDetail run={run} log={log} error={error} reconnect={reconnect} lookups={lookups} />;
}

function ShellRunDetail({
  run,
  log,
  error,
  reconnect,
  lookups,
}: {
  run: DurableRunRecord;
  log: { path: string; log: string } | null;
  error: string | null;
  reconnect: () => void;
  lookups: RunPresentationLookups;
}) {
  const [cancelling, setCancelling] = useState(false);
  const outputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const node = outputRef.current;
      if (node) node.scrollTo({ top: node.scrollHeight });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [log?.log]);

  const headline = getRunHeadline(run, lookups);
  const command = getRunTargetCommand(run);
  const cwd = getRunWorkingDirectory(run);
  const canCancel = !terminalStatus(run.status?.status);
  const running = run.status?.status === 'queued' || run.status?.status === 'waiting' || run.status?.status === 'running';

  async function cancelRun() {
    if (!canCancel || cancelling) return;
    setCancelling(true);
    try {
      await api.cancelDurableRun(run.runId);
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
                ›_ Background command
              </span>
              <span className={cx('font-medium', statusTone(run))}>{statusLabel(run)}</span>
            </div>
            <h2 className="mt-1 truncate text-[17px] font-semibold text-primary" title={headline.title}>
              {headline.title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {canCancel ? (
              <button
                type="button"
                className="ui-toolbar-button text-[11px] text-danger"
                disabled={cancelling}
                onClick={() => void cancelRun()}
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
          <Meta label="Command" value={command ?? headline.title} mono />
          <Meta label="cwd" value={cwd ?? '—'} mono />
          <Meta
            label="Exit"
            value={
              run.status?.status === 'completed'
                ? '0'
                : run.status?.status === 'failed'
                  ? 'non-zero'
                  : run.status?.status === 'cancelled'
                    ? '—'
                    : 'running…'
            }
          />
        </div>

        {error && <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">{error}</div>}

        <div className="mt-4 min-h-[420px]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-black/35">
            <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-dim">
              <span>Terminal output</span>
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

function AgentRunDetail({
  run,
  log,
  error,
  reconnect,
  lookups,
}: {
  run: DurableRunRecord;
  log: { path: string; log: string } | null;
  error: string | null;
  reconnect: () => void;
  lookups: RunPresentationLookups;
}) {
  const [cancelling, setCancelling] = useState(false);
  const outputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const node = outputRef.current;
      if (node) node.scrollTo({ top: node.scrollHeight });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [log?.log]);

  const headline = getRunHeadline(run, lookups);
  const prompt = getRunTargetPrompt(run);
  const command = getRunTargetCommand(run);
  const cwd = getRunWorkingDirectory(run);
  const model = getRunTargetModel(run);
  const profile = getRunTargetProfile(run);
  const connections = getRunConnections(run, lookups).filter((connection) => connection.label !== 'Source file');
  const transcript = connections.find((connection) => connection.label === 'Conversation transcript' && connection.to);
  const related = connections.filter((connection) => connection.key !== transcript?.key);
  const canCancel = !terminalStatus(run.status?.status) && run.manifest?.kind === 'background-run';
  const resultSummary = typeof run.result?.summary === 'string' ? run.result.summary : undefined;
  const running = run.status?.status === 'queued' || run.status?.status === 'waiting' || run.status?.status === 'running';

  async function cancelRun() {
    if (!canCancel || cancelling) return;
    setCancelling(true);
    try {
      await api.cancelDurableRun(run.runId);
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
              <span className="inline-flex items-center gap-1 rounded-md border border-accent/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                ✦ Subagent
              </span>
              <span className={cx('font-medium', statusTone(run))}>{statusLabel(run)}</span>
              {model ? <span className="truncate text-dim">{model}</span> : null}
            </div>
            <h2 className="mt-1 truncate text-[17px] font-semibold text-primary" title={headline.title}>
              {headline.title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {transcript ? (
              <Link to={transcript.to!} className="ui-toolbar-button text-[11px]">
                Open transcript
              </Link>
            ) : null}
            {canCancel ? (
              <button
                type="button"
                className="ui-toolbar-button text-[11px] text-danger"
                disabled={cancelling}
                onClick={() => void cancelRun()}
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
        <div className="grid gap-3 border-b border-border-subtle pb-4 text-[12px] md:grid-cols-2 xl:grid-cols-4">
          <Meta label="Prompt / Command" value={prompt ?? command ?? headline.title} mono={Boolean(command)} />
          <Meta label="cwd" value={cwd ?? '—'} mono />
          <Meta label="Runtime" value={profile ?? model ?? '—'} />
          <Meta label="Result" value={resultSummary ?? run.status?.lastError ?? statusLabel(run)} />
        </div>

        <Related connections={related} />

        {error && <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">{error}</div>}

        {transcript ? (
          <div className="mt-4">
            <div className="min-h-[340px] rounded-lg border border-border-subtle bg-elevated/30 p-4">
              <p className="ui-section-label">Subagent transcript</p>
              <p className="mt-3 text-[13px] leading-6 text-secondary">
                This run produced a conversation transcript. Open it to inspect the full subagent work, messages, tool calls, and final
                answer.
              </p>
              <Link to={transcript.to!} className="mt-4 inline-flex ui-toolbar-button text-[12px] text-accent">
                Open transcript →
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-4 min-h-[420px]">
            <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-black/35">
              <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-dim">
                <span>Subagent output</span>
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
        )}
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

function Related({ connections }: { connections: ReturnType<typeof getRunConnections> }) {
  const relatedConnections = connections.filter(
    (connection) =>
      connection.label === 'Automation' || connection.label === 'Conversation' || connection.label === 'Conversation to reopen',
  );

  if (relatedConnections.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 min-w-0 rounded-lg border border-border-subtle bg-elevated/20 p-3">
      <p className="ui-section-label">Related</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {relatedConnections.map((connection) =>
          connection.to ? (
            <Link key={connection.key} to={connection.to} className="text-[12px] text-accent hover:underline">
              {connection.label}: {connection.value}
            </Link>
          ) : (
            <div key={connection.key} className="text-[12px] text-secondary">
              <span className="text-dim">{connection.label}:</span>
              {connection.value}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
