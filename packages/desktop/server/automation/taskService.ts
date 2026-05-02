/**
 * Task service
 *
 * Shared helpers for task routes, extracted from index.ts.
 */

import {
  resolveScheduledTaskForProfile,
  type TaskRuntimeEntry,
} from './scheduledTasks.js';

export function readRequiredTaskId(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error('taskId is required.');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(normalized)) {
    throw new Error('taskId must use only letters, numbers, hyphens, or underscores.');
  }
  return normalized;
}

export function findTaskForProfile(profile: string, taskId: string) {
  try {
    return resolveScheduledTaskForProfile(profile, taskId);
  } catch (error) {
    if (error instanceof Error && error.message === `Task not found: ${taskId}`) {
      return undefined;
    }
    throw error;
  }
}
