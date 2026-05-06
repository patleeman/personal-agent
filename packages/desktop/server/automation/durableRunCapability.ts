import { markDurableRunAttentionRead, markDurableRunAttentionUnread } from '@personal-agent/core';

import { invalidateAppTopics } from '../shared/appEvents.js';
import { persistAppTelemetryEvent } from '../traces/appTelemetry.js';
import { getDurableRunAttentionSignature } from './durableRunAttention.js';
import { cancelDurableRun, clearDurableRunsListCache, getDurableRun, getDurableRunLog, listDurableRuns } from './durableRuns.js';

export class DurableRunCapabilityInputError extends Error {}

export async function listDurableRunsCapability() {
  const startedAt = process.hrtime.bigint();
  const result = await listDurableRuns();
  persistAppTelemetryEvent({
    source: 'server',
    category: 'durable_run',
    name: 'list',
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    count: result.runs.length,
    metadata: { runsRoot: result.runsRoot, summary: result.summary },
  });
  return result;
}

export async function readDurableRunCapability(runId: string) {
  const startedAt = process.hrtime.bigint();
  const normalizedRunId = runId.trim();
  if (!normalizedRunId) {
    throw new DurableRunCapabilityInputError('runId required');
  }

  const result = await getDurableRun(normalizedRunId);
  if (!result) {
    persistAppTelemetryEvent({ source: 'server', category: 'durable_run', name: 'read_missing', runId: normalizedRunId });
    throw new Error('Run not found');
  }

  persistAppTelemetryEvent({
    source: 'server',
    category: 'durable_run',
    name: 'read',
    runId: normalizedRunId,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    metadata: { status: result.run.status, recoveryAction: result.run.recoveryAction },
  });

  return result;
}

export async function readDurableRunLogCapability(input: { runId: string; tail?: number }) {
  const startedAt = process.hrtime.bigint();
  const normalizedRunId = input.runId.trim();
  if (!normalizedRunId) {
    throw new DurableRunCapabilityInputError('runId required');
  }

  const tail =
    typeof input.tail === 'number' && Number.isSafeInteger(input.tail) && input.tail > 0 ? Math.min(1000, input.tail as number) : 120;
  const result = await getDurableRunLog(normalizedRunId, tail);
  if (!result) {
    persistAppTelemetryEvent({ source: 'server', category: 'durable_run', name: 'log_missing', runId: normalizedRunId });
    throw new Error('Run not found');
  }

  persistAppTelemetryEvent({
    source: 'server',
    category: 'durable_run',
    name: 'read_log',
    runId: normalizedRunId,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    count: tail,
    metadata: { bytes: result.log.length, path: result.path },
  });

  return result;
}

export async function cancelDurableRunCapability(runId: string) {
  const startedAt = process.hrtime.bigint();
  const normalizedRunId = runId.trim();
  if (!normalizedRunId) {
    throw new DurableRunCapabilityInputError('runId required');
  }

  const result = await cancelDurableRun(normalizedRunId);
  persistAppTelemetryEvent({
    source: 'server',
    category: 'durable_run',
    name: 'cancel',
    runId: normalizedRunId,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    status: result.cancelled ? 200 : 409,
    metadata: { reason: result.reason },
  });
  return result;
}

export async function markDurableRunAttentionCapability(input: { runId: string; read?: boolean }) {
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
