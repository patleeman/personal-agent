/**
 * Retention policy for completed runs.
 *
 * Completed runs older than 30 days are eligible for cleanup.
 */

import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import {
  deleteDurableRunRecords,
  loadDurableRunStatus,
  listDurableRunIds,
  resolveDurableRunPaths,
} from './store.js';

const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

function parseIsoTimestamp(value: string): number | undefined {
  const match = value.match(ISO_TIMESTAMP_PATTERN);
  if (!match || !hasValidIsoDateParts(match)) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasValidIsoDateParts(match: RegExpMatchArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number(match[7]);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second
    && date.getUTCMilliseconds() === millisecond;
}

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

  const completedMs = parseIsoTimestamp(completedAt);
  if (completedMs === undefined) {
    return false;
  }
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
    const runPath = resolveDurableRunPaths(runsRoot, runId).root;
    try {
      rmSync(runPath, { recursive: true, force: true });
      deleteDurableRunRecords(runsRoot, [runId]);
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
