/**
 * Retention policy for completed runs.
 *
 * Completed runs older than 30 days are eligible for cleanup.
 */

import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import {
  loadDurableRunStatus,
  listDurableRunIds,
} from './store.js';

const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Check if a run is eligible for retention cleanup.
 */
export function isRetentionEligible(runsRoot: string, runId: string): boolean {
  const statusPath = join(runsRoot, runId, 'status.json');
  const status = loadDurableRunStatus(statusPath);

  if (!status) {
    return false;
  }

  // Only clean up terminal runs
  const terminalStatuses = ['completed', 'failed', 'cancelled'];
  if (!terminalStatuses.includes(status.status)) {
    return false;
  }

  // Check if completedAt exists and is older than retention period
  const completedAt = status.completedAt;
  if (!completedAt) {
    return false;
  }

  const completedMs = new Date(completedAt).getTime();
  const nowMs = Date.now();
  const ageMs = nowMs - completedMs;

  return ageMs > RETENTION_MS;
}

/**
 * Get runs eligible for retention cleanup.
 */
export function getRetentionEligibleRuns(runsRoot: string): string[] {
  if (!existsSync(runsRoot)) {
    return [];
  }

  return listDurableRunIds(runsRoot)
    .filter((runId) => isRetentionEligible(runsRoot, runId));
}

/**
 * Clean up runs eligible for retention.
 * Returns the number of runs cleaned up.
 */
export function cleanupRetentionEligibleRuns(runsRoot: string): number {
  const eligible = getRetentionEligibleRuns(runsRoot);
  let cleaned = 0;

  for (const runId of eligible) {
    const runPath = join(runsRoot, runId);
    try {
      rmSync(runPath, { recursive: true, force: true });
      cleaned++;
    } catch {
      // Ignore cleanup errors
    }
  }

  return cleaned;
}

/**
 * Get retention configuration.
 */
export function getRetentionConfig(): { retentionDays: number; retentionMs: number } {
  return {
    retentionDays: RETENTION_DAYS,
    retentionMs: RETENTION_MS,
  };
}
