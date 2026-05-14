import {
  createReadyDeferredResume,
  type DeferredResumeAlertLevel,
  loadDeferredResumeState,
  resolveDeferredResumeStateFile,
  saveDeferredResumeState,
} from '@personal-agent/core';

import { surfaceReadyDeferredResume } from '../daemon/conversation-wakeups.js';
import { markDeferredResumeConversationRunReady } from './deferred-resume-conversations.js';
import {
  loadDurableRunCheckpoint,
  resolveDurableRunPaths,
  saveDurableRunCheckpoint,
  scanDurableRun,
  type ScannedDurableRun,
} from './store.js';

interface BackgroundRunCallbackBinding {
  conversationId: string;
  sessionFile: string;
  profile: string;
  repoRoot?: string;
  alertLevel: DeferredResumeAlertLevel;
  autoResumeIfOpen: boolean;
  requireAck: boolean;
}

interface BackgroundRunCallbackDelivery {
  wakeupId?: string;
  deliveredAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readAlertLevel(value: unknown): DeferredResumeAlertLevel | undefined {
  return value === 'none' || value === 'passive' || value === 'disruptive' ? value : undefined;
}

function sanitizeIdSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized.length > 0 ? sanitized : 'run';
}

function readSpec(run: ScannedDurableRun): Record<string, unknown> | undefined {
  return isRecord(run.manifest?.spec) ? run.manifest.spec : isRecord(run.checkpoint?.payload) ? run.checkpoint.payload : undefined;
}

function readMetadata(run: ScannedDurableRun): Record<string, unknown> | undefined {
  const spec = readSpec(run);
  return isRecord(spec?.metadata) ? spec.metadata : undefined;
}

function readCallbackRecord(run: ScannedDurableRun): Record<string, unknown> | undefined {
  const spec = readSpec(run);
  return isRecord(spec?.callback) ? spec.callback : undefined;
}

function readCheckpointPayload(run: ScannedDurableRun): Record<string, unknown> {
  return isRecord(run.checkpoint?.payload) ? run.checkpoint.payload : {};
}

function readTaskSlug(run: ScannedDurableRun): string {
  const spec = readSpec(run);
  const metadata = readMetadata(run);
  return readOptionalString(metadata?.taskSlug) ?? readOptionalString(spec?.taskSlug) ?? run.runId;
}

function readTargetCommand(run: ScannedDurableRun): string | undefined {
  const spec = readSpec(run);
  const target = isRecord(spec?.target) ? spec.target : undefined;
  const prompt = readOptionalString(target?.prompt);
  if (prompt) {
    return prompt.length > 500 ? `${prompt.slice(0, 499).trimEnd()}…` : prompt;
  }

  const command = readOptionalString(target?.command);
  if (command) {
    return command.length > 500 ? `${command.slice(0, 499).trimEnd()}…` : command;
  }

  return undefined;
}

function buildWakeupPrompt(run: ScannedDurableRun): string {
  const taskSlug = readTaskSlug(run);
  const status = run.status?.status ?? 'unknown';
  const lines = [`Background task ${taskSlug} ${status}.`, `Run ID: ${run.runId}`];

  const command = readTargetCommand(run);
  if (command) {
    lines.push(`Command: ${command}`);
  }

  lines.push('', 'Continue from this result. Use background_command get/logs only if you need details.');

  return lines.join('\n');
}

function buildWakeupTitle(run: ScannedDurableRun): string {
  const taskSlug = readTaskSlug(run);
  const status = run.status?.status ?? 'finished';

  switch (status) {
    case 'completed':
      return `Background task ${taskSlug} completed`;
    case 'failed':
      return `Background task ${taskSlug} failed`;
    case 'cancelled':
      return `Background task ${taskSlug} cancelled`;
    case 'interrupted':
      return `Background task ${taskSlug} interrupted`;
    default:
      return `Background task ${taskSlug} finished`;
  }
}

function buildWakeupId(runId: string): string {
  return `background-run-${sanitizeIdSegment(runId)}`;
}

function getBackgroundRunCallbackBinding(run: ScannedDurableRun): BackgroundRunCallbackBinding | undefined {
  if (run.manifest?.kind !== 'background-run' && run.manifest?.kind !== 'raw-shell') {
    return undefined;
  }

  const metadata = readMetadata(run);
  const raw = isRecord(metadata?.callbackConversation) ? metadata.callbackConversation : undefined;
  if (!raw) {
    return undefined;
  }

  const conversationId = readOptionalString(raw.conversationId);
  const sessionFile = readOptionalString(raw.sessionFile);
  const profile = readOptionalString(raw.profile);
  if (!conversationId || !sessionFile || !profile) {
    return undefined;
  }

  const callback = readCallbackRecord(run);

  return {
    conversationId,
    sessionFile,
    profile,
    ...(readOptionalString(raw.repoRoot) ? { repoRoot: readOptionalString(raw.repoRoot) } : {}),
    alertLevel: readAlertLevel(callback?.alertLevel) ?? 'passive',
    autoResumeIfOpen: readOptionalBoolean(callback?.autoResumeIfOpen) ?? true,
    requireAck: readOptionalBoolean(callback?.requireAck) ?? false,
  };
}

export function getBackgroundRunCallbackDelivery(run: ScannedDurableRun): BackgroundRunCallbackDelivery {
  const payload = readCheckpointPayload(run);
  const marker = isRecord(payload.backgroundRunCallback) ? payload.backgroundRunCallback : undefined;
  return {
    ...(readOptionalString(marker?.wakeupId) ? { wakeupId: readOptionalString(marker?.wakeupId) } : {}),
    ...(readOptionalString(marker?.deliveredAt) ? { deliveredAt: readOptionalString(marker?.deliveredAt) } : {}),
  };
}

function markBackgroundRunCallbackDelivered(input: {
  runsRoot: string;
  run: ScannedDurableRun;
  wakeupId: string;
  deliveredAt: string;
}): void {
  const paths = resolveDurableRunPaths(input.runsRoot, input.run.runId);
  const checkpoint = loadDurableRunCheckpoint(paths.checkpointPath);
  const payload = isRecord(checkpoint?.payload) ? checkpoint.payload : {};

  saveDurableRunCheckpoint(paths.checkpointPath, {
    version: 1,
    runId: input.run.runId,
    updatedAt: input.deliveredAt,
    step: checkpoint?.step ?? input.run.status?.checkpointKey,
    cursor: checkpoint?.cursor,
    payload: {
      ...payload,
      backgroundRunCallback: {
        wakeupId: input.wakeupId,
        deliveredAt: input.deliveredAt,
      },
    },
  });
}

function shouldDeliverCallbackForStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'interrupted';
}

export async function deliverBackgroundRunCallbackWakeup(input: {
  daemonRoot: string;
  stateRoot: string;
  runsRoot: string;
  runId: string;
}): Promise<{ delivered: boolean; wakeupId?: string; conversationId?: string }> {
  const run = scanDurableRun(input.runsRoot, input.runId);
  if (!run) {
    return { delivered: false };
  }

  const binding = getBackgroundRunCallbackBinding(run);
  if (!binding) {
    return { delivered: false };
  }

  if (!shouldDeliverCallbackForStatus(run.status?.status)) {
    return { delivered: false };
  }

  const existingDelivery = getBackgroundRunCallbackDelivery(run);
  const wakeupId = existingDelivery.wakeupId ?? buildWakeupId(run.runId);
  if (existingDelivery.deliveredAt) {
    return {
      delivered: true,
      wakeupId,
      conversationId: binding.conversationId,
    };
  }

  const readyAt = run.status?.completedAt ?? run.status?.updatedAt ?? run.manifest?.createdAt ?? new Date().toISOString();
  const createdAt = run.manifest?.createdAt ?? readyAt;
  const prompt = buildWakeupPrompt(run);
  const title = buildWakeupTitle(run);
  const stateFile = resolveDeferredResumeStateFile(input.stateRoot);
  const deferredState = loadDeferredResumeState(stateFile);
  const entry = createReadyDeferredResume(deferredState, {
    id: wakeupId,
    sessionFile: binding.sessionFile,
    prompt,
    dueAt: readyAt,
    createdAt,
    readyAt,
    attempts: 0,
    title,
    source: {
      kind: 'background-run',
      id: run.runId,
    },
    delivery: {
      alertLevel: binding.alertLevel,
      autoResumeIfOpen: binding.autoResumeIfOpen,
      requireAck: binding.requireAck,
    },
  });
  saveDeferredResumeState(deferredState, stateFile);

  await markDeferredResumeConversationRunReady({
    daemonRoot: input.daemonRoot,
    deferredResumeId: entry.id,
    sessionFile: entry.sessionFile,
    prompt: entry.prompt,
    dueAt: entry.dueAt,
    createdAt: entry.createdAt,
    readyAt: entry.readyAt ?? readyAt,
    profile: binding.profile,
    conversationId: binding.conversationId,
  });

  surfaceReadyDeferredResume({
    entry,
    repoRoot: binding.repoRoot,
    profile: binding.profile,
    stateRoot: input.stateRoot,
    conversationId: binding.conversationId,
  });

  markBackgroundRunCallbackDelivered({
    runsRoot: input.runsRoot,
    run,
    wakeupId,
    deliveredAt: readyAt,
  });

  return {
    delivered: true,
    wakeupId,
    conversationId: binding.conversationId,
  };
}
