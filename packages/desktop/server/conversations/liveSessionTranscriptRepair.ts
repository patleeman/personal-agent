import type { SessionManager } from '@mariozechner/pi-coding-agent';

import { resolveTranscriptTailRecoveryPlan, type TranscriptTailRecoveryReason } from './liveSessionRecovery.js';

export interface LiveSessionTranscriptRepairHost {
  session: {
    sessionManager: unknown;
    state: { messages: unknown[] };
  };
  currentTurnError?: string | null;
}

export function repairLiveSessionTranscriptTail<TEntry extends LiveSessionTranscriptRepairHost>(
  entry: TEntry,
  callbacks: {
    broadcastSnapshot: (entry: TEntry) => void;
    clearContextUsageTimer: (entry: TEntry) => void;
    broadcastContextUsage: (entry: TEntry, force?: boolean) => void;
    publishSessionMetaChanged: () => void;
  },
): {
  recoverable: boolean;
  repaired: boolean;
  reason: TranscriptTailRecoveryReason | null;
  summary?: string;
} {
  const sessionManager = entry.session.sessionManager as
    | Partial<Pick<SessionManager, 'getBranch' | 'getEntry' | 'branch' | 'branchWithSummary' | 'resetLeaf' | 'buildSessionContext'>>
    | undefined;
  if (!sessionManager || typeof sessionManager.getBranch !== 'function' || typeof sessionManager.getEntry !== 'function') {
    return {
      recoverable: false,
      repaired: false,
      reason: null,
    };
  }

  const plan = resolveTranscriptTailRecoveryPlan(sessionManager as Pick<SessionManager, 'getBranch' | 'getEntry'>);
  if (!plan) {
    return {
      recoverable: false,
      repaired: false,
      reason: null,
    };
  }

  if (
    typeof sessionManager.resetLeaf !== 'function' ||
    typeof sessionManager.buildSessionContext !== 'function' ||
    (plan.targetEntryId !== null && typeof sessionManager.branch !== 'function' && typeof sessionManager.branchWithSummary !== 'function')
  ) {
    return {
      recoverable: true,
      repaired: false,
      reason: plan.reason,
      summary: plan.summary,
    };
  }

  if (plan.targetEntryId === null) {
    sessionManager.resetLeaf();
  } else if (typeof sessionManager.branchWithSummary === 'function') {
    sessionManager.branchWithSummary(plan.targetEntryId, plan.summary, plan.details);
  } else if (typeof sessionManager.branch === 'function') {
    sessionManager.branch(plan.targetEntryId);
  }

  entry.session.state.messages = sessionManager.buildSessionContext().messages;
  entry.currentTurnError = null;
  callbacks.broadcastSnapshot(entry);
  callbacks.clearContextUsageTimer(entry);
  callbacks.broadcastContextUsage(entry, true);
  callbacks.publishSessionMetaChanged();

  return {
    recoverable: true,
    repaired: true,
    reason: plan.reason,
    summary: plan.summary,
  };
}
