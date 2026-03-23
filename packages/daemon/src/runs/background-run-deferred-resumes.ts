import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
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

export interface BackgroundRunResultSummary {
  id: string;
  sessionFile: string;
  prompt: string;
  surfacedAt: string;
  runIds: string[];
}

type EligibleBackgroundRun = {
  run: ScannedDurableRun;
  sessionFile: string;
  surfacedBatchId?: string;
  surfacedAt?: string;
  deliveredAt?: string;
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
    ? payload.backgroundRunResume
    : undefined;

  return {
    run,
    sessionFile,
    surfacedBatchId: readOptionalString(surfaced?.batchId),
    surfacedAt: readOptionalString(surfaced?.surfacedAt),
    deliveredAt: readOptionalString(surfaced?.deliveredAt),
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
  const agent = isRecord(payload.agent) ? payload.agent : undefined;
  const agentPrompt = trimText(readOptionalString(agent?.prompt), MAX_COMMAND_LENGTH);
  if (agentPrompt) {
    return agentPrompt;
  }

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

function buildBackgroundRunResultPrompt(runs: EligibleBackgroundRun[]): string {
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

function createBackgroundRunResultBatchId(sessionFile: string, runIds: string[]): string {
  const hash = createHash('sha1')
    .update(`${sessionFile}\n${runIds.sort().join('\n')}`)
    .digest('hex')
    .slice(0, 16);

  return `result_run_${hash}`;
}

function markRunsSurfaced(runsRoot: string, runs: EligibleBackgroundRun[], batchId: string, surfacedAt: string): void {
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
          batchId,
          surfacedAt,
        },
      },
    });
  }
}

function collectBackgroundRunResultBatches(input: {
  runsRoot: string;
  sessionFile: string;
}): Map<string, EligibleBackgroundRun[]> {
  const batches = new Map<string, EligibleBackgroundRun[]>();

  for (const run of scanDurableRunsForRecovery(input.runsRoot)) {
    const eligible = resolveEligibleBackgroundRun(run);
    if (!eligible || eligible.sessionFile !== input.sessionFile) {
      continue;
    }

    if (!eligible.surfacedBatchId || eligible.deliveredAt || !isStoppedStatus(eligible.run.status?.status)) {
      continue;
    }

    const existing = batches.get(eligible.surfacedBatchId);
    if (existing) {
      existing.push(eligible);
      continue;
    }

    batches.set(eligible.surfacedBatchId, [eligible]);
  }

  return batches;
}

export function listPendingBackgroundRunResults(input: {
  runsRoot: string;
  sessionFile: string;
}): BackgroundRunResultSummary[] {
  return Array.from(collectBackgroundRunResultBatches(input).entries())
    .map(([batchId, runs]) => ({
      id: batchId,
      sessionFile: input.sessionFile,
      prompt: buildBackgroundRunResultPrompt(runs),
      surfacedAt: runs
        .map((run) => run.surfacedAt)
        .filter((value): value is string => typeof value === 'string')
        .sort()[0] ?? '',
      runIds: runs.map((run) => run.run.runId).sort(),
    }))
    .sort((left, right) => {
      const surfacedCompare = left.surfacedAt.localeCompare(right.surfacedAt);
      if (surfacedCompare !== 0) {
        return surfacedCompare;
      }

      return left.id.localeCompare(right.id);
    });
}

export function markBackgroundRunResultsDelivered(input: {
  runsRoot: string;
  sessionFile: string;
  resultIds: string[];
  deliveredAt?: string;
}): string[] {
  const resultIds = Array.from(new Set(
    input.resultIds
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  ));
  if (resultIds.length === 0) {
    return [];
  }

  const targetIds = new Set(resultIds);
  const deliveredAt = new Date(input.deliveredAt ?? Date.now()).toISOString();
  const marked = new Set<string>();

  for (const run of scanDurableRunsForRecovery(input.runsRoot)) {
    const eligible = resolveEligibleBackgroundRun(run);
    if (!eligible || eligible.sessionFile !== input.sessionFile || !eligible.surfacedBatchId || !targetIds.has(eligible.surfacedBatchId)) {
      continue;
    }

    const paths = resolveDurableRunPaths(input.runsRoot, run.runId);
    const checkpoint = loadDurableRunCheckpoint(paths.checkpointPath);
    const payload = readCheckpointPayload(checkpoint);
    const marker = isRecord(payload.backgroundRunResume) ? payload.backgroundRunResume : undefined;
    const surfacedAt = readOptionalString(marker?.surfacedAt);
    if (!surfacedAt) {
      continue;
    }

    saveDurableRunCheckpoint(paths.checkpointPath, {
      version: 1,
      runId: run.runId,
      updatedAt: deliveredAt,
      step: checkpoint?.step ?? run.status?.checkpointKey,
      cursor: checkpoint?.cursor,
      payload: {
        ...payload,
        backgroundRunResume: {
          batchId: eligible.surfacedBatchId,
          surfacedAt,
          deliveredAt,
        },
      },
    });
    marked.add(eligible.surfacedBatchId);
  }

  return Array.from(marked).sort();
}

export async function surfaceBackgroundRunResultsIfReady(input: {
  runsRoot: string;
  triggerRunId: string;
  now?: Date;
}): Promise<{ resultId?: string; surfacedRunIds: string[] }> {
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
    .filter((run) => !run.surfacedBatchId);

  if (stoppedRuns.length === 0) {
    return { surfacedRunIds: [] };
  }

  const surfacedRunIds = stoppedRuns.map((run) => run.run.runId).sort();
  const surfacedAt = new Date(input.now ?? Date.now()).toISOString();
  const resultId = createBackgroundRunResultBatchId(trigger.sessionFile, surfacedRunIds);
  markRunsSurfaced(input.runsRoot, stoppedRuns, resultId, surfacedAt);

  return {
    resultId,
    surfacedRunIds,
  };
}
