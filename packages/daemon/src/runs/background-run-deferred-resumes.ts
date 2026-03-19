import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import {
  activateDeferredResume,
  loadDeferredResumeState,
  saveDeferredResumeState,
  scheduleDeferredResume,
  type DeferredResumeRecord,
} from '@personal-agent/core';
import {
  markDeferredResumeConversationRunReady,
  scheduleDeferredResumeConversationRun,
} from './deferred-resume-conversations.js';
import {
  loadDurableRunCheckpoint,
  resolveDurableRunPaths,
  saveDurableRunCheckpoint,
  scanDurableRun,
  scanDurableRunsForRecovery,
  type DurableRunCheckpointFile,
  type DurableRunStatus,
  type ScannedDurableRun,
} from './store.js';

const SINGLE_RUN_LOG_TAIL_LINES = 60;
const BATCH_RUN_LOG_TAIL_LINES = 20;
const MAX_TASK_PROMPT_LENGTH = 2_000;
const MAX_COMMAND_LENGTH = 500;

type EligibleBackgroundRun = {
  run: ScannedDurableRun;
  sessionFile: string;
  surfacedDeferredResumeId?: string;
  taskPrompt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function trimText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function readCheckpointPayload(checkpoint: DurableRunCheckpointFile | undefined): Record<string, unknown> {
  return isRecord(checkpoint?.payload) ? checkpoint.payload : {};
}

function resolveEligibleBackgroundRun(run: ScannedDurableRun): EligibleBackgroundRun | undefined {
  if (run.manifest?.kind !== 'background-run') {
    return undefined;
  }

  const sessionFile = readOptionalString(run.manifest.source?.filePath);
  if (!sessionFile) {
    return undefined;
  }

  const payload = readCheckpointPayload(run.checkpoint);
  if (payload.resumeParentOnExit !== true) {
    return undefined;
  }

  const surfaced = isRecord(payload.backgroundRunResume)
    ? readOptionalString(payload.backgroundRunResume.deferredResumeId)
    : undefined;

  return {
    run,
    sessionFile,
    surfacedDeferredResumeId: surfaced,
    taskPrompt: trimText(readOptionalString(payload.taskPrompt), MAX_TASK_PROMPT_LENGTH),
  };
}

function isStoppedStatus(status: DurableRunStatus | undefined): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'interrupted';
}

function isActiveStatus(status: DurableRunStatus | undefined): boolean {
  return status === 'queued'
    || status === 'running'
    || status === 'recovering'
    || status === 'waiting';
}

function readRunLogTail(logPath: string, maxLines: number): string {
  if (!existsSync(logPath)) {
    return '';
  }

  try {
    return readFileSync(logPath, 'utf-8')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .slice(-maxLines)
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}

function describeRunCommand(run: ScannedDurableRun): string | undefined {
  const payload = readCheckpointPayload(run.checkpoint);
  const shellCommand = trimText(readOptionalString(payload.shellCommand), MAX_COMMAND_LENGTH);
  if (shellCommand) {
    return shellCommand;
  }

  const argv = Array.isArray(payload.argv)
    ? payload.argv.flatMap((value) => typeof value === 'string' && value.trim().length > 0 ? [value.trim()] : [])
    : [];

  if (argv.length === 0) {
    return undefined;
  }

  return trimText(argv.join(' '), MAX_COMMAND_LENGTH);
}

function sortRuns(runs: EligibleBackgroundRun[]): EligibleBackgroundRun[] {
  return [...runs].sort((left, right) => {
    const leftUpdatedAt = left.run.status?.updatedAt ?? left.run.manifest?.createdAt ?? '';
    const rightUpdatedAt = right.run.status?.updatedAt ?? right.run.manifest?.createdAt ?? '';
    const timestampCompare = leftUpdatedAt.localeCompare(rightUpdatedAt);
    if (timestampCompare !== 0) {
      return timestampCompare;
    }

    return left.run.runId.localeCompare(right.run.runId);
  });
}

function buildGenericSingleRunPrompt(run: EligibleBackgroundRun): string {
  const taskSlug = readOptionalString(run.run.manifest?.spec.taskSlug) ?? 'unknown';
  const status = run.run.status?.status ?? 'unknown';
  const logText = readRunLogTail(run.run.paths.outputLogPath, SINGLE_RUN_LOG_TAIL_LINES) || '(empty log)';
  const lines = [
    `Durable run ${run.run.runId} has finished.`,
    `taskSlug=${taskSlug}`,
    `status=${status}`,
    `log=${run.run.paths.outputLogPath}`,
  ];

  const command = describeRunCommand(run.run);
  if (command) {
    lines.push(`command=${command}`);
  }

  lines.push(
    '',
    'Recent log tail:',
    logText,
    '',
    'Use run get/logs if you need more detail. Then continue from this point.',
  );

  return lines.join('\n');
}

function buildGenericBatchPrompt(runs: EligibleBackgroundRun[]): string {
  const orderedRuns = sortRuns(runs);
  const lines = [
    'Durable runs have finished. Continue from this point.',
    '',
    'Completed runs:',
  ];

  for (const run of orderedRuns) {
    const taskSlug = readOptionalString(run.run.manifest?.spec.taskSlug) ?? 'unknown';
    const status = run.run.status?.status ?? 'unknown';
    const logText = readRunLogTail(run.run.paths.outputLogPath, BATCH_RUN_LOG_TAIL_LINES) || '(empty log)';

    lines.push(
      '',
      `Run ${run.run.runId}`,
      `taskSlug=${taskSlug}`,
      `status=${status}`,
      `log=${run.run.paths.outputLogPath}`,
    );

    const command = describeRunCommand(run.run);
    if (command) {
      lines.push(`command=${command}`);
    }

    lines.push('', 'Recent log tail:', logText);
  }

  lines.push(
    '',
    'Use run get/logs if you need more detail. Then continue from this point.',
  );

  return lines.join('\n');
}

function buildDelegateSingleRunPrompt(run: EligibleBackgroundRun): string {
  const taskSlug = readOptionalString(run.run.manifest?.spec.taskSlug) ?? 'unknown';
  const status = run.run.status?.status ?? 'unknown';
  const logText = readRunLogTail(run.run.paths.outputLogPath, SINGLE_RUN_LOG_TAIL_LINES) || '(empty log)';

  return [
    `Delegated run ${run.run.runId} has finished.`,
    `taskSlug=${taskSlug}`,
    `status=${status}`,
    `log=${run.run.paths.outputLogPath}`,
    '',
    'Original delegated task:',
    run.taskPrompt ?? '(task prompt unavailable)',
    '',
    'Recent log tail:',
    logText,
    '',
    'Use delegate get/logs if you need more detail. Then summarize the outcome for the user and continue with the next concrete step.',
  ].join('\n');
}

function buildDelegateBatchPrompt(runs: EligibleBackgroundRun[]): string {
  const orderedRuns = sortRuns(runs);
  const lines = [
    'Delegated runs have finished. Continue from this point.',
    '',
    'Completed delegated runs:',
  ];

  for (const run of orderedRuns) {
    const taskSlug = readOptionalString(run.run.manifest?.spec.taskSlug) ?? 'unknown';
    const status = run.run.status?.status ?? 'unknown';
    const logText = readRunLogTail(run.run.paths.outputLogPath, BATCH_RUN_LOG_TAIL_LINES) || '(empty log)';

    lines.push(
      '',
      `Run ${run.run.runId}`,
      `taskSlug=${taskSlug}`,
      `status=${status}`,
      `log=${run.run.paths.outputLogPath}`,
      '',
      'Original delegated task:',
      run.taskPrompt ?? '(task prompt unavailable)',
      '',
      'Recent log tail:',
      logText,
    );
  }

  lines.push(
    '',
    'Use delegate get/logs if you need more detail. Then summarize the combined outcome for the user and continue with the next concrete step.',
  );

  return lines.join('\n');
}

function buildBackgroundRunResumePrompt(runs: EligibleBackgroundRun[]): string {
  const orderedRuns = sortRuns(runs);
  const allDelegates = orderedRuns.every((run) => run.run.manifest?.source?.type === 'gateway-delegate');

  if (orderedRuns.length === 1) {
    return allDelegates
      ? buildDelegateSingleRunPrompt(orderedRuns[0] as EligibleBackgroundRun)
      : buildGenericSingleRunPrompt(orderedRuns[0] as EligibleBackgroundRun);
  }

  return allDelegates
    ? buildDelegateBatchPrompt(orderedRuns)
    : buildGenericBatchPrompt(orderedRuns);
}

function createBackgroundRunDeferredResumeId(sessionFile: string, runIds: string[]): string {
  const hash = createHash('sha1')
    .update(`${sessionFile}\n${runIds.sort().join('\n')}`)
    .digest('hex')
    .slice(0, 16);

  return `resume_run_${hash}`;
}

function toReadyDeferredResumeRecord(input: {
  sessionFile: string;
  id: string;
  prompt: string;
  now: string;
}): DeferredResumeRecord {
  return {
    id: input.id,
    sessionFile: input.sessionFile,
    prompt: input.prompt,
    dueAt: input.now,
    createdAt: input.now,
    attempts: 0,
    status: 'ready',
    readyAt: input.now,
  };
}

function markRunsSurfaced(runsRoot: string, runs: EligibleBackgroundRun[], deferredResumeId: string, surfacedAt: string): void {
  for (const run of runs) {
    const paths = resolveDurableRunPaths(runsRoot, run.run.runId);
    const checkpoint = loadDurableRunCheckpoint(paths.checkpointPath);
    const payload = readCheckpointPayload(checkpoint);

    saveDurableRunCheckpoint(paths.checkpointPath, {
      version: 1,
      runId: run.run.runId,
      updatedAt: surfacedAt,
      step: checkpoint?.step ?? run.run.status?.checkpointKey,
      cursor: checkpoint?.cursor,
      payload: {
        ...payload,
        backgroundRunResume: {
          deferredResumeId,
          surfacedAt,
        },
      },
    });
  }
}

export async function scheduleBackgroundRunDeferredResumeIfReady(input: {
  daemonRoot: string;
  runsRoot: string;
  triggerRunId: string;
  now?: Date;
}): Promise<{ deferredResumeId?: string; surfacedRunIds: string[] }> {
  const triggerRun = scanDurableRun(input.runsRoot, input.triggerRunId);
  const trigger = triggerRun ? resolveEligibleBackgroundRun(triggerRun) : undefined;
  if (!trigger) {
    return { surfacedRunIds: [] };
  }

  const eligibleRuns = scanDurableRunsForRecovery(input.runsRoot)
    .flatMap((run) => {
      const eligible = resolveEligibleBackgroundRun(run);
      if (!eligible || eligible.sessionFile !== trigger.sessionFile) {
        return [];
      }

      return [eligible];
    });

  const activeRuns = eligibleRuns.filter((run) => isActiveStatus(run.run.status?.status));
  if (activeRuns.length > 0) {
    return { surfacedRunIds: [] };
  }

  const stoppedRuns = eligibleRuns
    .filter((run) => isStoppedStatus(run.run.status?.status))
    .filter((run) => !run.surfacedDeferredResumeId);

  if (stoppedRuns.length === 0) {
    return { surfacedRunIds: [] };
  }

  const surfacedRunIds = stoppedRuns.map((run) => run.run.runId).sort();
  const now = new Date(input.now ?? Date.now());
  const nowIso = now.toISOString();
  const deferredResumeId = createBackgroundRunDeferredResumeId(trigger.sessionFile, surfacedRunIds);
  const prompt = buildBackgroundRunResumePrompt(stoppedRuns);
  const state = loadDeferredResumeState();
  const existing = state.resumes[deferredResumeId];

  if (!existing) {
    scheduleDeferredResume(state, {
      id: deferredResumeId,
      sessionFile: trigger.sessionFile,
      prompt,
      dueAt: nowIso,
      createdAt: nowIso,
      attempts: 0,
    });
  }

  const readyRecord = existing?.status === 'ready'
    ? {
      ...existing,
      prompt,
      sessionFile: trigger.sessionFile,
      dueAt: existing.dueAt,
      createdAt: existing.createdAt,
      readyAt: existing.readyAt ?? nowIso,
    }
    : (activateDeferredResume(state, { id: deferredResumeId, at: now })
      ?? toReadyDeferredResumeRecord({
        sessionFile: trigger.sessionFile,
        id: deferredResumeId,
        prompt,
        now: nowIso,
      }));

  state.resumes[deferredResumeId] = readyRecord;
  saveDeferredResumeState(state);

  await scheduleDeferredResumeConversationRun({
    daemonRoot: input.daemonRoot,
    deferredResumeId,
    sessionFile: readyRecord.sessionFile,
    prompt: readyRecord.prompt,
    dueAt: readyRecord.dueAt,
    createdAt: readyRecord.createdAt,
  });
  await markDeferredResumeConversationRunReady({
    daemonRoot: input.daemonRoot,
    deferredResumeId,
    sessionFile: readyRecord.sessionFile,
    prompt: readyRecord.prompt,
    dueAt: readyRecord.dueAt,
    createdAt: readyRecord.createdAt,
    readyAt: readyRecord.readyAt ?? nowIso,
  });

  markRunsSurfaced(input.runsRoot, stoppedRuns, deferredResumeId, nowIso);

  return {
    deferredResumeId,
    surfacedRunIds,
  };
}
