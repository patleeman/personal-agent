/**
 * Loop state machine for iterating agents.
 *
 * A "looping caller" is an agent that continuously schedules its own next iteration.
 * Each completion schedules the next iteration until the agent decides to stop.
 */

import { join } from 'path';
import {
  loadDurableRunManifest,
  loadDurableRunStatus,
  saveDurableRunStatus,
  createInitialDurableRunStatus,
  listDurableRunIds,
} from './store.js';
import {
  parseDelayToMs,
  type LoopOptions,
} from './schedule-run.js';

const MAX_LOOP_RETRY_ATTEMPTS = 100;

export type LoopState = 'idle' | 'running' | 'scheduling' | 'waiting';

/**
 * Derive loop state from child run statuses.
 * The loop is:
 * - `idle` if no children or all children are terminal
 * - `running` if any child is running/recovering
 * - `waiting` if any child is queued/waiting
 * - `scheduling` if there's a child in scheduling state (orphan from crash)
 */
export function deriveLoopState(runsRoot: string, loopRunId: string): LoopState {
  const children = listDurableRunIds(runsRoot)
    .filter((id) => {
      const manifest = loadDurableRunManifest(join(runsRoot, id, 'manifest.json'));
      return manifest?.parentId === loopRunId;
    })
    .map((id) => ({
      id,
      manifest: loadDurableRunManifest(join(runsRoot, id, 'manifest.json')),
      status: loadDurableRunStatus(join(runsRoot, id, 'status.json')),
    }));

  if (children.length === 0) {
    return 'idle';
  }

  const statuses = children.map((c) => c.status?.status ?? 'unknown');

  // Note: 'scheduling' status is transient and won't persist.
  // We detect orphans by checking if we have multiple waiting children.
  // We detect orphans by checking if we have multiple waiting children.
  const waitingCount = statuses.filter((s) => s === 'queued' || s === 'waiting').length;

  // Running takes precedence
  const hasRunning = statuses.some((s) => s === 'running' || s === 'recovering');
  if (hasRunning) {
    return 'running';
  }

  // Waiting means there's a next iteration scheduled
  if (waitingCount > 0) {
    return 'waiting';
  }

  // All children are terminal
  return 'idle';
}

/**
 * Check if an iteration should execute or be skipped.
 *
 * Returns 'execute' if:
 * - Loop state is 'waiting' (successor is scheduled, we should fire)
 *
 * Returns 'skip' if:
 * - Loop state is 'idle' (no loop active)
 * - Loop state is 'running' (another iteration is already running)
 * - Loop state is 'scheduling' (orphan from crash, skip as stale)
 */
export function shouldExecuteIteration(runsRoot: string, iterationRunId: string): 'execute' | 'skip' {
  const manifest = loadDurableRunManifest(join(runsRoot, iterationRunId, 'manifest.json'));
  if (!manifest) {
    return 'skip';
  }

  const parentId = manifest.parentId;
  if (!parentId) {
    // No parent, this is a root loop run
    const state = deriveLoopState(runsRoot, iterationRunId);
    return state === 'idle' ? 'execute' : 'skip';
  }

  // This is an iteration of a loop
  const loopState = deriveLoopState(runsRoot, parentId);
  return loopState === 'waiting' ? 'execute' : 'skip';
}

/**
 * Mark a run as in scheduling state (transitioning to waiting).
 * This prevents race conditions when scheduling the next iteration.
 */
export function markRunAsScheduling(runsRoot: string, runId: string): void {
  const statusPath = join(runsRoot, runId, 'status.json');
  const current = loadDurableRunStatus(statusPath);

  if (!current) {
    return;
  }

  saveDurableRunStatus(statusPath, createInitialDurableRunStatus({
    runId,
    status: 'waiting',
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
    activeAttempt: current.activeAttempt,
    startedAt: current.startedAt,
    completedAt: current.completedAt,
    checkpointKey: 'scheduling',
    lastError: current.lastError,
  }));
}

/**
 * Compute backoff delay for retries.
 */
export function computeBackoffDelay(
  attempt: number,
  backoff: 'linear' | 'exponential',
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  let delay: number;

  if (backoff === 'linear') {
    delay = baseDelayMs * attempt;
  } else {
    delay = baseDelayMs * Math.pow(2, attempt - 1);
  }

  return Math.min(delay, maxDelayMs);
}

/**
 * Check if an iteration should retry based on loop options.
 */
export function shouldRetry(
  options: LoopOptions,
  attempt: number,
): { retry: boolean; delayMs?: number } {
  if (!options.retry) {
    return { retry: false };
  }

  const maxAttempts = Number.isSafeInteger(options.retry.attempts) && (options.retry.attempts as number) > 0
    ? Math.min(MAX_LOOP_RETRY_ATTEMPTS, options.retry.attempts as number)
    : 3;
  if (attempt >= maxAttempts) {
    return { retry: false };
  }

  const backoff = options.retry.backoff ?? 'exponential';
  const maxDelay = parseDelayToMs(options.retry.maxDelay ?? '10m') ?? 10 * 60 * 1000;
  const baseDelay = parseDelayToMs(options.delay ?? '1h') ?? 60 * 60 * 1000;

  const delayMs = computeBackoffDelay(attempt, backoff, baseDelay / 10, maxDelay);

  return { retry: true, delayMs };
}

/**
 * Check if a loop has exceeded max iterations.
 */
export function hasExceededMaxIterations(runsRoot: string, loopRunId: string, maxIterations?: number): boolean {
  if (!Number.isSafeInteger(maxIterations) || (maxIterations as number) <= 0) {
    return false;
  }

  const completedIterations = listDurableRunIds(runsRoot)
    .filter((id) => {
      const manifest = loadDurableRunManifest(join(runsRoot, id, 'manifest.json'));
      return manifest?.parentId === loopRunId;
    })
    .filter((id) => {
      const status = loadDurableRunStatus(join(runsRoot, id, 'status.json'));
      return status?.status === 'completed';
    }).length;

  return completedIterations >= (maxIterations as number);
}
