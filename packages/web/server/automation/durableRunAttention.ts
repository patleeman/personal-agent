import { loadDurableRunAttentionState, type DurableRunAttentionStateDocument } from '@personal-agent/core';
import type { ScannedDurableRun } from '@personal-agent/daemon';

interface DurableRunAttentionCandidate extends Pick<ScannedDurableRun, 'runId' | 'status' | 'problems' | 'recoveryAction'> {
  remoteExecution?: {
    importStatus?: 'not_ready' | 'ready' | 'imported' | 'failed' | null;
    importedAt?: string;
    importError?: string;
  };
}

export function durableRunNeedsAttention(run: DurableRunAttentionCandidate): boolean {
  const status = run.status?.status;
  const importStatus = run.remoteExecution?.importStatus ?? null;

  return run.problems.length > 0
    || run.recoveryAction === 'resume'
    || run.recoveryAction === 'rerun'
    || run.recoveryAction === 'attention'
    || run.recoveryAction === 'invalid'
    || status === 'failed'
    || status === 'interrupted'
    || status === 'recovering'
    || importStatus === 'ready'
    || importStatus === 'failed';
}

export function getDurableRunAttentionSignature(run: DurableRunAttentionCandidate): string | null {
  if (!durableRunNeedsAttention(run)) {
    return null;
  }

  return JSON.stringify({
    recoveryAction: run.recoveryAction,
    status: run.status?.status ?? null,
    activeAttempt: run.status?.activeAttempt ?? null,
    updatedAt: run.status?.updatedAt ?? null,
    completedAt: run.status?.completedAt ?? null,
    importStatus: run.remoteExecution?.importStatus ?? null,
    importedAt: run.remoteExecution?.importedAt ?? null,
    importError: run.remoteExecution?.importError ?? null,
    problems: [...run.problems],
  });
}

export function decorateDurableRunAttention<T extends DurableRunAttentionCandidate>(
  run: T,
  state: DurableRunAttentionStateDocument = loadDurableRunAttentionState(),
): T & {
  attentionDismissed: boolean;
  attentionSignature: string | null;
} {
  const attentionSignature = getDurableRunAttentionSignature(run);
  const attentionDismissed = attentionSignature !== null
    && state.runs[run.runId]?.attentionSignature === attentionSignature;

  return {
    ...run,
    attentionDismissed,
    attentionSignature,
  };
}

export function decorateDurableRunsAttention<T extends DurableRunAttentionCandidate>(
  runs: T[],
  state: DurableRunAttentionStateDocument = loadDurableRunAttentionState(),
): Array<T & {
  attentionDismissed: boolean;
  attentionSignature: string | null;
}> {
  return runs.map((run) => decorateDurableRunAttention(run, state));
}
