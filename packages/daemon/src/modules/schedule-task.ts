/**
 * Bridge between scheduleRun() and task execution.
 *
 * This module shows how to use the unified scheduleRun() for task scheduling
 * while delegating execution to the existing tasks-runner.
 */

import {
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
} from '../runs/store.js';
import {
  scheduleRun,
  type ScheduleRunInput,
  type TriggerAt,
  type TriggerCron,
  type TriggerNow,
} from '../runs/schedule-run.js';
import type { ParsedTaskDefinition } from './tasks-parser.js';

/**
 * Convert a ParsedTaskDefinition to a ScheduleRunInput.
 */
export function taskToScheduleInput(
  task: ParsedTaskDefinition,
  options?: {
    profile?: string;
    model?: string;
  },
): ScheduleRunInput {
  // Build the trigger based on task schedule
  let trigger: TriggerNow | TriggerAt | TriggerCron;

  if (task.schedule?.type === 'cron') {
    trigger = { type: 'cron', expression: task.schedule.expression };
  } else if (task.schedule?.type === 'at') {
    trigger = { type: 'at', at: new Date(task.schedule.at) };
  } else {
    trigger = { type: 'now' };
  }

  return {
    trigger,
    target: {
      type: 'agent',
      prompt: task.prompt,
      profile: options?.profile ?? task.profile,
      model: options?.model ?? task.modelRef,
    },
    source: {
      type: 'task',
      id: task.id,
      filePath: task.filePath,
    },
    metadata: {
      taskId: task.id,
      taskFilePath: task.filePath,
      timeoutSeconds: task.timeoutSeconds,
    },
  };
}

/**
 * Schedule a task using the unified scheduleRun().
 * Returns the created run ID.
 */
export async function scheduleTask(
  daemonRoot: string,
  task: ParsedTaskDefinition,
  options?: {
    profile?: string;
    model?: string;
  },
): Promise<{ runId: string; runsRoot: string }> {
  const input = taskToScheduleInput(task, options);
  const result = await scheduleRun(daemonRoot, input);

  return {
    runId: result.runId,
    runsRoot: resolveDurableRunsRoot(daemonRoot),
  };
}

/**
 * Get the paths for a scheduled task run.
 */
export function getTaskRunPaths(
  daemonRoot: string,
  runId: string,
) {
  const runsRoot = resolveDurableRunsRoot(daemonRoot);
  return resolveDurableRunPaths(runsRoot, runId);
}
