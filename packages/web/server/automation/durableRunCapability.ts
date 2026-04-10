import {
  markDurableRunAttentionRead,
  markDurableRunAttentionUnread,
} from '@personal-agent/core';
import {
  cancelDurableRun,
  clearDurableRunsListCache,
  getDurableRun,
  getDurableRunLog,
  listDurableRuns,
} from './durableRuns.js';
import { getDurableRunAttentionSignature } from './durableRunAttention.js';
import { invalidateAppTopics } from '../shared/appEvents.js';

export class DurableRunCapabilityInputError extends Error {}

export async function listDurableRunsCapability() {
  return listDurableRuns();
}

export async function readDurableRunCapability(runId: string) {
  const normalizedRunId = runId.trim();
  if (!normalizedRunId) {
    throw new DurableRunCapabilityInputError('runId required');
  }

  const result = await getDurableRun(normalizedRunId);
  if (!result) {
    throw new Error('Run not found');
  }

  return result;
}

export async function readDurableRunLogCapability(input: {
  runId: string;
  tail?: number;
}) {
  const normalizedRunId = input.runId.trim();
  if (!normalizedRunId) {
    throw new DurableRunCapabilityInputError('runId required');
  }

  const tail = Number.isInteger(input.tail) && (input.tail as number) > 0
    ? input.tail as number
    : 120;
  const result = await getDurableRunLog(normalizedRunId, tail);
  if (!result) {
    throw new Error('Run not found');
  }

  return result;
}

export async function cancelDurableRunCapability(runId: string) {
  const normalizedRunId = runId.trim();
  if (!normalizedRunId) {
    throw new DurableRunCapabilityInputError('runId required');
  }

  return cancelDurableRun(normalizedRunId);
}

export async function markDurableRunAttentionCapability(input: {
  runId: string;
  read?: boolean;
}) {
  const normalizedRunId = input.runId.trim();
  if (!normalizedRunId) {
    throw new DurableRunCapabilityInputError('runId required');
  }

  const result = await getDurableRun(normalizedRunId);
  if (!result) {
    throw new Error('Run not found');
  }

  const attentionSignature = getDurableRunAttentionSignature(result.run);
  if (input.read === false) {
    markDurableRunAttentionUnread({ runId: normalizedRunId });
  } else if (attentionSignature) {
    markDurableRunAttentionRead({ runId: normalizedRunId, attentionSignature });
  }

  clearDurableRunsListCache();
  invalidateAppTopics('runs');
  return { ok: true as const };
}
