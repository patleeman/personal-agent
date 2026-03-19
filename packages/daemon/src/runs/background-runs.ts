import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { buildBackgroundAgentArgv, type BackgroundRunAgentSpec } from '../background-run-agent.js';
import {
  appendDurableRunEvent,
  createDurableRunManifest,
  createInitialDurableRunStatus,
  loadDurableRunCheckpoint,
  loadDurableRunManifest,
  loadDurableRunStatus,
  resolveDurableRunPaths,
  saveDurableRunCheckpoint,
  saveDurableRunManifest,
  saveDurableRunStatus,
  type DurableRunPaths,
} from './store.js';

export type BackgroundRunNotificationMode = 'none' | 'message' | 'resume';

export interface BackgroundRunNotificationSpec {
  gateway: 'telegram';
  destinationId: string;
  messageThreadId?: number;
  mode: BackgroundRunNotificationMode;
  resumeConversationId?: string;
}

export interface StartBackgroundRunInput {
  taskSlug: string;
  cwd: string;
  argv?: string[];
  shellCommand?: string;
  agent?: BackgroundRunAgentSpec;
  source?: {
    type: string;
    id?: string;
    filePath?: string;
  };
  notification?: BackgroundRunNotificationSpec;
  manifestMetadata?: Record<string, unknown>;
  checkpointPayload?: Record<string, unknown>;
  createdAt?: string;
}

export interface StartBackgroundRunRecord {
  runId: string;
  paths: DurableRunPaths;
  argv?: string[];
  shellCommand?: string;
}

export interface FinalizeBackgroundRunInput {
  runId: string;
  runPaths: DurableRunPaths;
  taskSlug: string;
  cwd: string;
  startedAt: string;
  endedAt: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  cancelled: boolean;
  error?: string;
}

function sanitizeIdSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 48);

  return sanitized.length > 0 ? sanitized : fallback;
}

function toTimestampKey(value: string): string {
  return value.replace(/[:.]/g, '-');
}

function normalizeArgv(argv: string[] | undefined): string[] | undefined {
  if (!argv || argv.length === 0) {
    return undefined;
  }

  const normalized = argv
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeShellCommand(command: string | undefined): string | undefined {
  if (!command) {
    return undefined;
  }

  const trimmed = command.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeAgentSpec(spec: BackgroundRunAgentSpec | undefined): BackgroundRunAgentSpec | undefined {
  if (!spec) {
    return undefined;
  }

  const prompt = spec.prompt.trim();
  if (prompt.length === 0) {
    throw new Error('Background agent run prompt must be non-empty.');
  }

  const profile = spec.profile?.trim();
  const model = spec.model?.trim();

  return {
    prompt,
    ...(profile ? { profile } : {}),
    ...(model ? { model } : {}),
    ...(spec.noSession === true ? { noSession: true } : {}),
  };
}

function ensureCommandSpec(input: StartBackgroundRunInput): {
  argv?: string[];
  shellCommand?: string;
  agent?: BackgroundRunAgentSpec;
} {
  const argv = normalizeArgv(input.argv);
  const shellCommand = normalizeShellCommand(input.shellCommand);
  const agent = normalizeAgentSpec(input.agent);
  const definedSpecs = [argv ? 'argv' : null, shellCommand ? 'shellCommand' : null, agent ? 'agent' : null]
    .filter((value): value is 'argv' | 'shellCommand' | 'agent' => value !== null);

  if (definedSpecs.length > 1) {
    throw new Error('Background run must use exactly one of argv, shellCommand, or agent.');
  }

  if (!agent && !argv && !shellCommand) {
    throw new Error('Background run must include argv, shellCommand, or agent.');
  }

  return {
    ...(agent ? { agent, argv: buildBackgroundAgentArgv(agent) } : {}),
    ...(argv ? { argv } : {}),
    ...(shellCommand ? { shellCommand } : {}),
  };
}

function appendOutputLog(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, text, 'utf-8');
}

export function createBackgroundRunId(taskSlug: string, createdAt: string): string {
  const nonce = Math.random().toString(16).slice(2, 10);

  return [
    'run',
    sanitizeIdSegment(taskSlug, 'background'),
    toTimestampKey(createdAt),
    nonce,
  ].join('-');
}

export async function createBackgroundRunRecord(
  runsRoot: string,
  input: StartBackgroundRunInput,
): Promise<StartBackgroundRunRecord> {
  const createdAt = new Date(input.createdAt ?? Date.now()).toISOString();
  const runId = createBackgroundRunId(input.taskSlug, createdAt);
  const paths = resolveDurableRunPaths(runsRoot, runId);
  const { argv, shellCommand, agent } = ensureCommandSpec(input);

  mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  writeFileSync(paths.outputLogPath, '', 'utf-8');

  saveDurableRunManifest(paths.manifestPath, createDurableRunManifest({
    id: runId,
    kind: 'background-run',
    resumePolicy: 'manual',
    createdAt,
    spec: {
      taskSlug: input.taskSlug,
      cwd: input.cwd,
      ...(argv ? { argv } : {}),
      ...(shellCommand ? { shellCommand } : {}),
      ...(agent ? { agent } : {}),
      ...(input.notification ? { notification: input.notification } : {}),
    },
    source: input.source
      ? {
        type: input.source.type,
        ...(input.source.id ? { id: input.source.id } : {}),
        ...(input.source.filePath ? { filePath: input.source.filePath } : {}),
      }
      : {
        type: 'background-run',
        id: input.taskSlug,
      },
  }));

  saveDurableRunStatus(paths.statusPath, createInitialDurableRunStatus({
    runId,
    status: 'queued',
    createdAt,
    updatedAt: createdAt,
    activeAttempt: 0,
    checkpointKey: 'queued',
  }));

  saveDurableRunCheckpoint(paths.checkpointPath, {
    version: 1,
    runId,
    updatedAt: createdAt,
    step: 'queued',
    payload: {
      ...(input.checkpointPayload ?? {}),
      taskSlug: input.taskSlug,
      cwd: input.cwd,
      ...(argv ? { argv } : {}),
      ...(shellCommand ? { shellCommand } : {}),
      ...(agent ? { agent } : {}),
    },
  });

  await appendDurableRunEvent(paths.eventsPath, {
    version: 1,
    runId,
    timestamp: createdAt,
    type: 'run.created',
    payload: {
      kind: 'background-run',
      taskSlug: input.taskSlug,
      cwd: input.cwd,
      ...(argv ? { argv } : {}),
      ...(shellCommand ? { shellCommand } : {}),
      ...(agent ? { agent } : {}),
    },
  });

  appendOutputLog(paths.outputLogPath, `# task=${input.taskSlug}\n# cwd=${input.cwd}\n# createdAt=${createdAt}\n`);

  return {
    runId,
    paths,
    ...(argv ? { argv } : {}),
    ...(shellCommand ? { shellCommand } : {}),
  };
}

export async function markBackgroundRunStarted(input: {
  runId: string;
  runPaths: DurableRunPaths;
  startedAt: string;
  pid: number;
  taskSlug: string;
  cwd: string;
}): Promise<void> {
  const manifest = loadDurableRunManifest(input.runPaths.manifestPath);
  const checkpoint = loadDurableRunCheckpoint(input.runPaths.checkpointPath);
  const payload = checkpoint?.payload ?? {};

  saveDurableRunStatus(input.runPaths.statusPath, createInitialDurableRunStatus({
    runId: input.runId,
    status: 'running',
    createdAt: manifest?.createdAt ?? input.startedAt,
    updatedAt: input.startedAt,
    activeAttempt: 1,
    startedAt: input.startedAt,
    checkpointKey: 'spawned',
  }));

  saveDurableRunCheckpoint(input.runPaths.checkpointPath, {
    version: 1,
    runId: input.runId,
    updatedAt: input.startedAt,
    step: 'spawned',
    payload: {
      ...payload,
      taskSlug: input.taskSlug,
      cwd: input.cwd,
      pid: input.pid,
      startedAt: input.startedAt,
    },
  });

  await appendDurableRunEvent(input.runPaths.eventsPath, {
    version: 1,
    runId: input.runId,
    timestamp: input.startedAt,
    type: 'run.attempt.started',
    attempt: 1,
    payload: {
      taskSlug: input.taskSlug,
      cwd: input.cwd,
      pid: input.pid,
    },
  });

  appendOutputLog(input.runPaths.outputLogPath, `# startedAt=${input.startedAt}\n# pid=${String(input.pid)}\n\n`);
}

export async function finalizeBackgroundRun(input: FinalizeBackgroundRunInput): Promise<void> {
  const manifest = loadDurableRunManifest(input.runPaths.manifestPath);
  const status = input.cancelled
    ? 'cancelled'
    : input.exitCode === 0
      ? 'completed'
      : 'failed';
  const step = input.cancelled
    ? 'cancelled'
    : input.exitCode === 0
      ? 'completed'
      : 'failed';

  saveDurableRunStatus(input.runPaths.statusPath, createInitialDurableRunStatus({
    runId: input.runId,
    status,
    createdAt: manifest?.createdAt ?? input.startedAt,
    updatedAt: input.endedAt,
    activeAttempt: 1,
    startedAt: input.startedAt,
    completedAt: input.endedAt,
    checkpointKey: step,
    lastError: input.error,
  }));

  const checkpoint = loadDurableRunCheckpoint(input.runPaths.checkpointPath);
  saveDurableRunCheckpoint(input.runPaths.checkpointPath, {
    version: 1,
    runId: input.runId,
    updatedAt: input.endedAt,
    step,
    payload: {
      ...(checkpoint?.payload ?? {}),
      taskSlug: input.taskSlug,
      cwd: input.cwd,
      endedAt: input.endedAt,
      exitCode: input.exitCode,
      signal: input.signal ?? undefined,
      cancelled: input.cancelled,
      ...(input.error ? { error: input.error } : {}),
    },
  });

  await appendDurableRunEvent(input.runPaths.eventsPath, {
    version: 1,
    runId: input.runId,
    timestamp: input.endedAt,
    type: input.cancelled
      ? 'run.cancelled'
      : input.exitCode === 0
        ? 'run.completed'
        : 'run.failed',
    attempt: 1,
    payload: {
      taskSlug: input.taskSlug,
      cwd: input.cwd,
      exitCode: input.exitCode,
      signal: input.signal ?? undefined,
      cancelled: input.cancelled,
      ...(input.error ? { error: input.error } : {}),
    },
  });

  const marker = `\n__PA_RUN_EXIT_CODE=${String(input.exitCode)}\n`;
  appendOutputLog(input.runPaths.outputLogPath, `${marker}# endedAt=${input.endedAt}\n# status=${status}\n`);

  writeFileSync(input.runPaths.resultPath, JSON.stringify({
    version: 1,
    runId: input.runId,
    taskSlug: input.taskSlug,
    cwd: input.cwd,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    exitCode: input.exitCode,
    signal: input.signal,
    cancelled: input.cancelled,
    success: input.exitCode === 0 && !input.cancelled,
    ...(input.error ? { error: input.error } : {}),
  }, null, 2));
}

export async function markBackgroundRunInterrupted(input: {
  runId: string;
  runPaths: DurableRunPaths;
  reason: string;
  interruptedAt?: string;
}): Promise<boolean> {
  const manifest = loadDurableRunManifest(input.runPaths.manifestPath);
  const currentStatus = loadDurableRunStatus(input.runPaths.statusPath);
  if (!manifest || manifest.kind !== 'background-run' || !currentStatus) {
    return false;
  }

  if (currentStatus.status === 'completed' || currentStatus.status === 'failed' || currentStatus.status === 'cancelled' || currentStatus.status === 'interrupted') {
    return false;
  }

  const interruptedAt = new Date(input.interruptedAt ?? Date.now()).toISOString();
  const checkpoint = loadDurableRunCheckpoint(input.runPaths.checkpointPath);

  saveDurableRunStatus(input.runPaths.statusPath, createInitialDurableRunStatus({
    runId: input.runId,
    status: 'interrupted',
    createdAt: currentStatus.createdAt,
    updatedAt: interruptedAt,
    activeAttempt: currentStatus.activeAttempt,
    startedAt: currentStatus.startedAt,
    checkpointKey: 'interrupted',
    lastError: input.reason,
  }));

  saveDurableRunCheckpoint(input.runPaths.checkpointPath, {
    version: 1,
    runId: input.runId,
    updatedAt: interruptedAt,
    step: 'interrupted',
    payload: {
      ...(checkpoint?.payload ?? {}),
      interruptedAt,
      error: input.reason,
    },
  });

  await appendDurableRunEvent(input.runPaths.eventsPath, {
    version: 1,
    runId: input.runId,
    timestamp: interruptedAt,
    type: 'run.interrupted',
    attempt: currentStatus.activeAttempt,
    payload: {
      error: input.reason,
    },
  });

  appendOutputLog(input.runPaths.outputLogPath, `\n# interruptedAt=${interruptedAt}\n# error=${input.reason}\n`);
  return true;
}
