/**
 * Task service
 *
 * Shared helpers for task routes, extracted from index.ts.
 */

import {
  resolveScheduledTaskForProfile,
  type TaskRuntimeEntry,
} from './scheduledTasks.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for task service');
};

export function setTaskServiceProfileGetter(getCurrentProfile: () => string): void {
  getCurrentProfileFn = getCurrentProfile;
}

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

export function findCurrentProfileTask(taskId: string) {
  try {
    return resolveScheduledTaskForProfile(getCurrentProfileFn(), taskId);
  } catch (error) {
    if (error instanceof Error && error.message === `Task not found: ${taskId}`) {
      return undefined;
    }
    throw error;
  }
}
