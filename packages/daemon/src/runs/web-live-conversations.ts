import { loadDaemonConfig } from '../config.js';
import { resolveDaemonPaths } from '../paths.js';
import {
  appendDurableRunEvent,
  createDurableRunManifest,
  createInitialDurableRunStatus,
  listDurableRunIds,
  loadDurableRunCheckpoint,
  loadDurableRunManifest,
  loadDurableRunStatus,
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  saveDurableRunCheckpoint,
  saveDurableRunManifest,
  saveDurableRunStatus,
  scanDurableRun,
  type DurableRunCheckpointFile,
} from './store.js';

export type WebLiveConversationRunState = 'waiting' | 'running' | 'interrupted' | 'failed';

export interface WebLiveConversationPreludeMessage {
  customType: string;
  content: string;
}

export interface WebLiveConversationPromptImage {
  type: 'image';
  data: string;
  mimeType: string;
  name?: string;
}

export interface WebLiveConversationPendingOperation {
  type: 'prompt';
  text: string;
  behavior?: 'steer' | 'followUp';
  images?: WebLiveConversationPromptImage[];
  contextMessages?: WebLiveConversationPreludeMessage[];
  enqueuedAt: string;
}

export interface RecoverableWebLiveConversationRun {
  runId: string;
  conversationId: string;
  sessionFile: string;
  cwd: string;
  title?: string;
  profile?: string;
  state: WebLiveConversationRunState;
  pendingOperation?: WebLiveConversationPendingOperation;
}

function sanitizeIdSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized.length > 0 ? sanitized : 'conversation';
}

function resolveDaemonRoot(): string {
  return resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root;
}

function normalizeTimestamp(value: string | Date | undefined): string {
  return new Date(value ?? Date.now()).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parsePendingOperation(value: unknown): WebLiveConversationPendingOperation | undefined {
  if (!isRecord(value) || value.type !== 'prompt' || typeof value.text !== 'string') {
    return undefined;
  }

  const behavior = value.behavior === 'steer' || value.behavior === 'followUp'
    ? value.behavior
    : undefined;
  const enqueuedAt = typeof value.enqueuedAt === 'string' ? normalizeTimestamp(value.enqueuedAt) : undefined;
  if (!enqueuedAt) {
    return undefined;
  }

  const images = Array.isArray(value.images)
    ? value.images.flatMap((image) => {
      if (!isRecord(image) || image.type !== 'image' || typeof image.data !== 'string' || typeof image.mimeType !== 'string') {
        return [];
      }

      return [{
        type: 'image' as const,
        data: image.data,
        mimeType: image.mimeType,
        ...(typeof image.name === 'string' && image.name.trim().length > 0 ? { name: image.name.trim() } : {}),
      }];
    })
    : undefined;

  const contextMessages = Array.isArray(value.contextMessages)
    ? value.contextMessages.flatMap((message) => {
      if (!isRecord(message) || typeof message.customType !== 'string' || typeof message.content !== 'string') {
        return [];
      }

      const customType = message.customType.trim();
      const content = message.content.trim();
      if (!customType || !content) {
        return [];
      }

      return [{ customType, content }];
    })
    : undefined;

  return {
    type: 'prompt',
    text: value.text,
    ...(behavior ? { behavior } : {}),
    ...(images && images.length > 0 ? { images } : {}),
    ...(contextMessages && contextMessages.length > 0 ? { contextMessages } : {}),
    enqueuedAt,
  };
}

function readCheckpointPayload(checkpoint: DurableRunCheckpointFile | undefined): Record<string, unknown> {
  return isRecord(checkpoint?.payload) ? checkpoint.payload : {};
}

export function createWebLiveConversationRunId(conversationId: string): string {
  return `conversation-live-${sanitizeIdSegment(conversationId)}`;
}

export async function saveWebLiveConversationRunState(input: {
  conversationId: string;
  sessionFile: string;
  cwd: string;
  title?: string;
  profile?: string;
  state: WebLiveConversationRunState;
  updatedAt?: string | Date;
  lastError?: string;
  pendingOperation?: WebLiveConversationPendingOperation | null;
}): Promise<{ runId: string }> {
  const daemonRoot = resolveDaemonRoot();
  const runId = createWebLiveConversationRunId(input.conversationId);
  const runPaths = resolveDurableRunPaths(resolveDurableRunsRoot(daemonRoot), runId);
  const existingManifest = loadDurableRunManifest(runPaths.manifestPath);
  const existingStatus = loadDurableRunStatus(runPaths.statusPath);
  const existingCheckpoint = loadDurableRunCheckpoint(runPaths.checkpointPath);
  const existingPayload = readCheckpointPayload(existingCheckpoint);
  const updatedAt = normalizeTimestamp(input.updatedAt);
  const createdAt = existingManifest?.createdAt ?? existingStatus?.createdAt ?? updatedAt;
  const pendingOperation = input.pendingOperation === undefined
    ? (input.state === 'waiting' ? undefined : parsePendingOperation(existingPayload.pendingOperation))
    : (input.pendingOperation ?? undefined);

  if (!existingManifest) {
    saveDurableRunManifest(runPaths.manifestPath, createDurableRunManifest({
      id: runId,
      kind: 'conversation',
      resumePolicy: 'continue',
      createdAt,
      spec: {
        mode: 'web-live-session',
        conversationId: input.conversationId,
        sessionFile: input.sessionFile,
        cwd: input.cwd,
        ...(input.profile ? { profile: input.profile } : {}),
      },
      source: {
        type: 'web-live-session',
        id: input.conversationId,
        filePath: input.sessionFile,
      },
    }));

    await appendDurableRunEvent(runPaths.eventsPath, {
      version: 1,
      runId,
      timestamp: createdAt,
      type: 'run.created',
      payload: {
        kind: 'conversation',
        source: 'web-live-session',
        conversationId: input.conversationId,
      },
    });
  }

  saveDurableRunStatus(runPaths.statusPath, createInitialDurableRunStatus({
    runId,
    status: input.state,
    createdAt,
    updatedAt,
    activeAttempt: input.state === 'running'
      ? Math.max(1, existingStatus?.activeAttempt ?? 0)
      : (existingStatus?.activeAttempt ?? 0),
    startedAt: input.state === 'running'
      ? (existingStatus?.startedAt ?? updatedAt)
      : undefined,
    checkpointKey: `web-live-session.${input.state}`,
    lastError: input.lastError,
  }));

  saveDurableRunCheckpoint(runPaths.checkpointPath, {
    version: 1,
    runId,
    updatedAt,
    step: `web-live-session.${input.state}`,
    payload: {
      conversationId: input.conversationId,
      sessionFile: input.sessionFile,
      cwd: input.cwd,
      ...(input.title ? { title: input.title } : {}),
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.lastError ? { lastError: input.lastError } : {}),
      ...(pendingOperation ? { pendingOperation } : {}),
    },
  });

  await appendDurableRunEvent(runPaths.eventsPath, {
    version: 1,
    runId,
    timestamp: updatedAt,
    type: `conversation.web_live.${input.state}`,
    payload: {
      conversationId: input.conversationId,
      sessionFile: input.sessionFile,
      ...(input.title ? { title: input.title } : {}),
      ...(input.lastError ? { error: input.lastError } : {}),
      ...(pendingOperation ? { pendingOperationType: pendingOperation.type } : {}),
    },
  });

  return { runId };
}

export function listRecoverableWebLiveConversationRuns(): RecoverableWebLiveConversationRun[] {
  const runsRoot = resolveDurableRunsRoot(resolveDaemonRoot());

  return listDurableRunIds(runsRoot)
    .map((runId) => scanDurableRun(runsRoot, runId))
    .flatMap((run) => {
      if (!run || run.manifest?.source?.type !== 'web-live-session') {
        return [];
      }

      const payload = readCheckpointPayload(run.checkpoint);
      const conversationId = typeof payload.conversationId === 'string' && payload.conversationId.trim().length > 0
        ? payload.conversationId.trim()
        : run.manifest.source.id?.trim();
      const sessionFile = typeof payload.sessionFile === 'string' && payload.sessionFile.trim().length > 0
        ? payload.sessionFile.trim()
        : run.manifest.source.filePath?.trim();
      const cwd = typeof payload.cwd === 'string' && payload.cwd.trim().length > 0
        ? payload.cwd.trim()
        : (typeof run.manifest.spec.cwd === 'string' ? run.manifest.spec.cwd : undefined);
      const title = typeof payload.title === 'string' && payload.title.trim().length > 0
        ? payload.title.trim()
        : undefined;
      const profile = typeof payload.profile === 'string' && payload.profile.trim().length > 0
        ? payload.profile.trim()
        : (typeof run.manifest.spec.profile === 'string' ? run.manifest.spec.profile : undefined);
      const state = run.status?.status;

      if (!conversationId || !sessionFile || !cwd) {
        return [];
      }

      if (state !== 'running' && state !== 'interrupted' && state !== 'waiting') {
        return [];
      }

      const pendingOperation = parsePendingOperation(payload.pendingOperation);
      if (state === 'waiting' && !pendingOperation) {
        return [];
      }

      return [{
        runId: run.runId,
        conversationId,
        sessionFile,
        cwd,
        ...(title ? { title } : {}),
        ...(profile ? { profile } : {}),
        state,
        ...(pendingOperation ? { pendingOperation } : {}),
      } satisfies RecoverableWebLiveConversationRun];
    });
}
