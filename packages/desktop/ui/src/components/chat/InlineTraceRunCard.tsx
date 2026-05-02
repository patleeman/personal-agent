import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { useAppData } from '../../app/contexts';
import {
  getRunHeadline,
  getRunTargetCommand,
  getRunTargetModel,
  getRunTargetProfile,
  getRunTargetPrompt,
  getRunTaskSlug,
  getRunTimeline,
  getRunWorkingDirectory,
  isRunActive,
  type RunPresentationLookups,
} from '../../automation/runPresentation';
import { timeAgo } from '../../shared/utils';
import { cx, Pill } from '../ui';
import { INLINE_RUN_LOG_TAIL_LINES, INLINE_RUN_POLL_INTERVAL_MS, usePolledDurableRunSnapshot } from './linkedRunPolling.js';
import { resolveLinkedRunRecord } from './linkedRunResolution.js';
import type { LinkedRunPresentation } from './linkedRuns.js';
import { describeInlineRunStatus, inferStatusFromLinkedRunDetail } from './linkedRunStatus.js';

function InlineRunMetadataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[auto,minmax(0,1fr)] items-start gap-2">
      <span className="text-[10px] uppercase tracking-[0.12em] text-dim">{label}</span>
      <span className="break-words text-[11px] text-primary">{value}</span>
    </div>
  );
}

export function InlineTraceRunCard({ run, expanded, onToggle }: { run: LinkedRunPresentation; expanded: boolean; onToggle: () => void }) {
  const { tasks, sessions, runs } = useAppData();
  const runLookups = useMemo<RunPresentationLookups>(() => ({ tasks, sessions }), [tasks, sessions]);
  const resolvedRunRecord = useMemo(() => resolveLinkedRunRecord(run, runs?.runs, runLookups), [run, runLookups, runs?.runs]);
  const resolvedRunId = resolvedRunRecord?.runId ?? run.runId;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (!expanded) {
      setIsVisible(true);
      return;
    }

    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsVisible(Boolean(entry?.isIntersecting));
      },
      {
        threshold: [0, 0.01, 0.2],
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded]);

  const snapshotRunId = expanded ? resolvedRunId : null;
  const pollEnabled = Boolean(snapshotRunId) && isVisible;
  const snapshot = usePolledDurableRunSnapshot(snapshotRunId, pollEnabled, {
    tail: INLINE_RUN_LOG_TAIL_LINES,
    pollIntervalMs: INLINE_RUN_POLL_INTERVAL_MS,
  });
  const detailRun = snapshot.detail?.run ?? resolvedRunRecord ?? null;
  const headline = detailRun
    ? getRunHeadline(detailRun, runLookups)
    : {
        title: run.title,
        summary: run.detail ?? 'Linked run',
      };
  const status = describeInlineRunStatus(detailRun?.status?.status ?? inferStatusFromLinkedRunDetail(run.detail));
  const runStreaming = isRunActive(detailRun);
  const outputLabel = detailRun?.manifest?.kind === 'raw-shell' ? 'Terminal output' : 'Run output';
  const outputPathLabel = snapshot.log?.path?.split('/').filter(Boolean).pop() ?? 'output.log';
  const hasOutput = Boolean(snapshot.log?.log && snapshot.log.log.length > 0);
  const emptyOutputLabel = runStreaming ? 'Waiting for output…' : '(empty)';
  const taskSlug = detailRun ? getRunTaskSlug(detailRun) : null;
  const targetPrompt = detailRun ? getRunTargetPrompt(detailRun) : null;
  const targetCommand = detailRun ? getRunTargetCommand(detailRun) : null;
  const targetCwd = detailRun ? getRunWorkingDirectory(detailRun) : null;
  const targetModel = detailRun ? getRunTargetModel(detailRun) : null;
  const targetProfile = detailRun ? getRunTargetProfile(detailRun) : null;
  const timeline = detailRun ? getRunTimeline(detailRun) : [];
  const runIsShell = detailRun?.manifest?.kind === 'raw-shell' || Boolean(targetCommand);
  const latestTimelinePoint = timeline.at(-1);
  const resolvedFromMention = resolvedRunId !== run.runId;

  return (
    <div ref={cardRef} className="rounded-lg border border-border-subtle/70 bg-elevated/35 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full px-2.5 py-2 text-left hover:bg-elevated/70 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {detailRun && (
                <span
                  className={cx(
                    'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[8px] uppercase tracking-wider',
                    runIsShell ? 'border-accent/20 text-accent/70 font-mono' : 'border-accent/20 text-accent',
                  )}
                >
                  {runIsShell ? '›_ Shell' : '✦ Agent'}
                </span>
              )}
              <Pill tone={status.tone}>{status.text}</Pill>
              <span className="truncate text-[12px] font-medium text-primary">{headline.title}</span>
            </div>
            <p className="mt-1 truncate text-[11px] text-secondary">{headline.summary || run.detail || run.runId}</p>
          </div>
          <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-dim">{expanded ? 'hide' : 'show'}</span>
        </div>
      </button>

      {expanded && (
        <div className="space-y-2.5 border-t border-border-subtle/70 bg-base/30 px-2.5 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-dim">
            <span className={pollEnabled ? 'text-accent' : 'text-dim'}>
              {pollEnabled ? 'Polling live log' : 'Polling paused (off-screen)'}
            </span>
            {snapshot.refreshing && <span>· refreshing…</span>}
            {resolvedFromMention && (
              <>
                <span className="opacity-40">·</span>
                <span className="font-mono text-dim/80" title={`${run.runId} → ${resolvedRunId}`}>
                  {resolvedRunId}
                </span>
              </>
            )}
            {latestTimelinePoint?.at && (
              <>
                <span className="opacity-40">·</span>
                <span>
                  {latestTimelinePoint.label} {timeAgo(latestTimelinePoint.at)}
                </span>
              </>
            )}
          </div>

          {snapshot.loading && !detailRun && <p className="text-[11px] text-dim animate-pulse">Loading run…</p>}

          {snapshot.error && !detailRun && <p className="text-[11px] text-danger/85">{snapshot.error}</p>}

          {(detailRun || snapshot.log) && (
            <div className="rounded-md border border-border-subtle/70 bg-elevated/40 overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle/60 px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] text-dim">
                <span className={cx('h-2 w-2 rounded-full', runStreaming ? 'bg-accent animate-pulse' : 'bg-border-default')} />
                <span>{outputLabel}</span>
                <span className="min-w-0 truncate font-mono normal-case tracking-normal text-dim/80">{outputPathLabel}</span>
              </div>
              <div className="max-h-56 overflow-auto px-2 py-2">
                {hasOutput ? (
                  <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-primary">
                    {snapshot.log?.log}
                  </pre>
                ) : (
                  <p className="text-[11px] italic leading-relaxed text-dim">{emptyOutputLabel}</p>
                )}
              </div>
            </div>
          )}

          {detailRun && (
            <details className="ui-disclosure">
              <summary className="ui-disclosure-summary">
                <span>Details</span>
                <span className="ui-disclosure-meta">Command and runtime metadata</span>
              </summary>
              <div className="ui-disclosure-body">
                <div className="space-y-2.5">
                  {taskSlug && <InlineRunMetadataRow label="Task" value={taskSlug} />}
                  {targetPrompt && (
                    <InlineRunMetadataRow label="Prompt" value={<span className="whitespace-pre-wrap break-words">{targetPrompt}</span>} />
                  )}
                  {targetCommand && <InlineRunMetadataRow label="Command" value={<span className="font-mono">{targetCommand}</span>} />}
                  {targetCwd && <InlineRunMetadataRow label="Working dir" value={<span className="font-mono">{targetCwd}</span>} />}
                  {targetModel && <InlineRunMetadataRow label="Model" value={targetModel} />}
                  {targetProfile && <InlineRunMetadataRow label="Profile" value={targetProfile} />}
                  <InlineRunMetadataRow label="Run" value={detailRun.manifest?.kind ?? 'unknown'} />
                  <InlineRunMetadataRow label="Source" value={detailRun.manifest?.source?.type ?? 'unknown'} />
                  <InlineRunMetadataRow label="Attempt" value={String(detailRun.status?.activeAttempt ?? 0)} />
                  {detailRun.checkpoint?.step && <InlineRunMetadataRow label="Checkpoint" value={detailRun.checkpoint.step} />}
                  {snapshot.log?.path && (
                    <InlineRunMetadataRow label="Log" value={<span className="font-mono">{snapshot.log.path}</span>} />
                  )}
                </div>

                {(detailRun.status?.lastError || detailRun.problems.length > 0) && (
                  <div className="mt-3 space-y-2 border-t border-border-subtle/60 pt-2.5">
                    {detailRun.status?.lastError && (
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-dim">Last error</p>
                        <p className="whitespace-pre-wrap break-words text-[11px] text-danger/90">{detailRun.status.lastError}</p>
                      </div>
                    )}
                    {detailRun.problems.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-dim">Problems</p>
                        <div className="space-y-1 text-[11px] text-danger/90">
                          {detailRun.problems.map((problem) => (
                            <p key={problem}>• {problem}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </details>
          )}

          {snapshot.error && detailRun && <p className="text-[11px] text-warning">{snapshot.error}</p>}
        </div>
      )}
    </div>
  );
}
