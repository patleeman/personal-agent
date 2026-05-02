import { existsSync } from 'fs';

import { resolveBackgroundRunSessionDir } from './background-run-sessions.js';
import type { StartBackgroundRunInput } from './background-runs.js';
import type { ScannedDurableRun } from './store.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readSpec(run: ScannedDurableRun): Record<string, unknown> | undefined {
  return isRecord(run.manifest?.spec) ? run.manifest.spec : isRecord(run.checkpoint?.payload) ? run.checkpoint.payload : undefined;
}

function readTarget(run: ScannedDurableRun): Record<string, unknown> | undefined {
  const spec = readSpec(run);
  return isRecord(spec?.target) ? spec.target : undefined;
}

function readMetadata(run: ScannedDurableRun): Record<string, unknown> {
  const spec = readSpec(run);
  if (isRecord(spec?.metadata)) {
    return spec.metadata;
  }

  return {};
}

function readCallback(run: ScannedDurableRun): StartBackgroundRunInput['callback'] | undefined {
  const spec = readSpec(run);
  const callback = isRecord(spec?.callback) ? spec.callback : undefined;
  if (!callback) {
    return undefined;
  }

  const alertLevel = callback.alertLevel;
  const autoResumeIfOpen = readOptionalBoolean(callback.autoResumeIfOpen);
  const requireAck = readOptionalBoolean(callback.requireAck);
  if (
    alertLevel !== 'none' &&
    alertLevel !== 'passive' &&
    alertLevel !== 'disruptive' &&
    autoResumeIfOpen === undefined &&
    requireAck === undefined
  ) {
    return undefined;
  }

  return {
    ...(alertLevel === 'none' || alertLevel === 'passive' || alertLevel === 'disruptive' ? { alertLevel } : {}),
    ...(autoResumeIfOpen !== undefined ? { autoResumeIfOpen } : {}),
    ...(requireAck !== undefined ? { requireAck } : {}),
  };
}

function readCallbackConversation(run: ScannedDurableRun): StartBackgroundRunInput['callbackConversation'] | undefined {
  const metadata = readMetadata(run);
  const raw = isRecord(metadata.callbackConversation) ? metadata.callbackConversation : undefined;
  if (!raw) {
    return undefined;
  }

  const conversationId = readOptionalString(raw.conversationId);
  const sessionFile = readOptionalString(raw.sessionFile);
  const profile = readOptionalString(raw.profile);
  if (!conversationId || !sessionFile || !profile) {
    return undefined;
  }

  return {
    conversationId,
    sessionFile,
    profile,
    ...(readOptionalString(raw.repoRoot) ? { repoRoot: readOptionalString(raw.repoRoot) } : {}),
  };
}

function readTaskSlug(run: ScannedDurableRun): string | undefined {
  const metadata = readMetadata(run);
  const spec = readSpec(run);
  return (
    readOptionalString(metadata.taskSlug) ??
    readOptionalString(spec?.taskSlug) ??
    readOptionalString(run.manifest?.source?.id) ??
    readOptionalString(run.runId)
  );
}

function readCwd(run: ScannedDurableRun): string | undefined {
  const metadata = readMetadata(run);
  const target = readTarget(run);
  const spec = readSpec(run);
  return readOptionalString(metadata.cwd) ?? readOptionalString(target?.cwd) ?? readOptionalString(spec?.cwd);
}

function readAgentSpec(run: ScannedDurableRun): StartBackgroundRunInput['agent'] | undefined {
  const target = readTarget(run);
  const legacyAgent = isRecord(run.checkpoint?.payload?.agent) ? run.checkpoint?.payload?.agent : undefined;
  const prompt = readOptionalString(target?.prompt) ?? readOptionalString(legacyAgent?.prompt);
  if (!prompt) {
    return undefined;
  }

  const profile = readOptionalString(target?.profile) ?? readOptionalString(legacyAgent?.profile);
  const model = readOptionalString(target?.model) ?? readOptionalString(legacyAgent?.model);
  const noSession = target?.noSession === true || legacyAgent?.noSession === true;

  return {
    prompt,
    ...(profile ? { profile } : {}),
    ...(model ? { model } : {}),
    ...(noSession ? { noSession: true } : {}),
  };
}

function readShellCommand(run: ScannedDurableRun): string | undefined {
  const target = readTarget(run);
  return readOptionalString(target?.command) ?? readOptionalString(run.checkpoint?.payload?.shellCommand);
}

function readArgv(run: ScannedDurableRun): string[] | undefined {
  const target = readTarget(run);
  const argv = Array.isArray(target?.argv)
    ? target.argv
    : Array.isArray(run.checkpoint?.payload?.argv)
      ? run.checkpoint?.payload?.argv
      : undefined;
  if (!argv) {
    return undefined;
  }

  const normalized = argv.flatMap((entry) => (typeof entry === 'string' && entry.trim().length > 0 ? [entry.trim()] : []));
  return normalized.length > 0 ? normalized : undefined;
}

function copyReplayMetadata(run: ScannedDurableRun): Record<string, unknown> {
  const metadata = { ...readMetadata(run) };
  delete metadata.taskSlug;
  delete metadata.cwd;
  delete metadata.followUpOfRunId;
  delete metadata.rerunOfRunId;
  return metadata;
}

function buildCommonInput(run: ScannedDurableRun): Omit<StartBackgroundRunInput, 'agent' | 'shellCommand'> {
  const taskSlug = readTaskSlug(run);
  const cwd = readCwd(run);
  if (!taskSlug || !cwd) {
    throw new Error(`Run ${run.runId} does not contain enough launch metadata to restart.`);
  }

  return {
    taskSlug,
    cwd,
    ...(run.manifest?.source ? { source: run.manifest.source } : {}),
    ...(readCallbackConversation(run) ? { callbackConversation: readCallbackConversation(run) } : {}),
    ...(readCallback(run) ? { callback: readCallback(run) } : {}),
  };
}

function canReplayBackgroundRun(run: ScannedDurableRun): boolean {
  return run.manifest?.kind === 'background-run' || run.manifest?.kind === 'raw-shell';
}

export function buildRerunBackgroundRunInput(run: ScannedDurableRun): StartBackgroundRunInput {
  if (!canReplayBackgroundRun(run)) {
    throw new Error(`Run ${run.runId} is not a replayable background run.`);
  }

  const common = buildCommonInput(run);
  const metadata = copyReplayMetadata(run);

  if (run.manifest?.kind === 'background-run') {
    const agent = readAgentSpec(run);
    if (!agent) {
      throw new Error(`Run ${run.runId} does not contain its original agent prompt.`);
    }

    return {
      ...common,
      agent,
      manifestMetadata: {
        ...metadata,
        rerunOfRunId: run.runId,
      },
    };
  }

  const argv = readArgv(run);
  if (argv) {
    return {
      ...common,
      argv,
      manifestMetadata: {
        ...metadata,
        rerunOfRunId: run.runId,
      },
    };
  }

  const shellCommand = readShellCommand(run);
  if (!shellCommand) {
    throw new Error(`Run ${run.runId} does not contain its original shell command.`);
  }

  return {
    ...common,
    shellCommand,
    manifestMetadata: {
      ...metadata,
      rerunOfRunId: run.runId,
    },
  };
}

export function buildFollowUpBackgroundRunInput(run: ScannedDurableRun, prompt: string): StartBackgroundRunInput {
  if (run.manifest?.kind !== 'background-run') {
    throw new Error(`Run ${run.runId} does not support follow-up prompts.`);
  }

  const normalizedPrompt = prompt.trim();
  if (normalizedPrompt.length === 0) {
    throw new Error('follow-up prompt must be non-empty');
  }

  const common = buildCommonInput(run);
  const agent = readAgentSpec(run);
  if (!agent) {
    throw new Error(`Run ${run.runId} does not contain enough agent metadata to continue.`);
  }

  const sourceSessionDir = resolveBackgroundRunSessionDir(run.runId);
  if (!existsSync(sourceSessionDir)) {
    throw new Error(`Run ${run.runId} does not have a resumable session transcript.`);
  }

  return {
    ...common,
    agent: {
      ...agent,
      prompt: normalizedPrompt,
    },
    manifestMetadata: {
      ...copyReplayMetadata(run),
      followUpOfRunId: run.runId,
    },
    continueSession: true,
    bootstrapSessionDir: sourceSessionDir,
  };
}
