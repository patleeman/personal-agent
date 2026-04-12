import { existsSync } from 'node:fs';
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import { parsePendingOperation } from '@personal-agent/daemon';
import { getDurableRun } from '../automation/durableRuns.js';
import { logError } from '../middleware/index.js';
import { readWebUiConfig } from '../ui/webUi.js';
import {
  createWebLiveConversationRunId,
  listRecoverableWebLiveConversationRuns,
  syncWebLiveConversationRun,
  type WebLiveConversationPendingOperation,
  type WebLiveConversationPromptImage,
} from './conversationRuns.js';
import {
  isLive as isLiveSession,
  promptSession,
  queuePromptContext,
  registry as liveRegistry,
  resumeSession,
} from './liveSessions.js';
import { readSessionBlocks } from './sessions.js';

interface RecoveryLoaderOptions {
  extensionFactories?: ExtensionFactory[];
  additionalExtensionPaths?: string[];
  additionalSkillPaths?: string[];
  additionalPromptTemplatePaths?: string[];
  additionalThemePaths?: string[];
}

export interface RecoverConversationCapabilityContext {
  getCurrentProfile: () => string;
  buildLiveSessionResourceOptions: (profile?: string) => Omit<RecoveryLoaderOptions, 'extensionFactories'>;
  buildLiveSessionExtensionFactories: () => ExtensionFactory[];
  flushLiveDeferredResumes: () => Promise<void>;
}

export interface RecoverConversationResult {
  conversationId: string;
  live: true;
  recovered: true;
  replayedPendingOperation: boolean;
  usedFallbackPrompt: boolean;
}

export interface RecoverDurableLiveConversationsDependencies {
  isLive: (conversationId: string) => boolean;
  resumeSession: (sessionFile: string, options?: RecoveryLoaderOptions) => Promise<{ id: string }>;
  queuePromptContext: (conversationId: string, customType: string, content: string) => Promise<void>;
  promptSession: (
    conversationId: string,
    text: string,
    behavior?: 'steer' | 'followUp',
    images?: WebLiveConversationPromptImage[],
  ) => Promise<void>;
  loaderOptions?: RecoveryLoaderOptions;
  logger?: {
    info: (message: string) => void;
    warn: (message: string) => void;
  };
}

export interface RecoverDurableLiveConversationsResult {
  recovered: Array<{
    runId: string;
    conversationId: string;
    replayedPendingOperation: boolean;
  }>;
}

function buildRecoveryLoaderOptions(context: RecoverConversationCapabilityContext, profile: string): RecoveryLoaderOptions {
  return {
    ...context.buildLiveSessionResourceOptions(profile),
    extensionFactories: context.buildLiveSessionExtensionFactories(),
  };
}

function readCheckpointString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isSyntheticResumeFallbackOperation(
  operation: WebLiveConversationPendingOperation | null | undefined,
  resumeFallbackPrompt: string,
): boolean {
  const normalizedPrompt = resumeFallbackPrompt.trim();
  if (!operation || operation.type !== 'prompt' || normalizedPrompt.length === 0) {
    return false;
  }

  const hasImages = Array.isArray(operation.images) && operation.images.length > 0;
  const hasContextMessages = Array.isArray(operation.contextMessages) && operation.contextMessages.length > 0;
  return operation.text.trim() === normalizedPrompt
    && operation.behavior === undefined
    && !hasImages
    && !hasContextMessages;
}

export async function recoverConversationCapability(
  conversationIdInput: string,
  context: RecoverConversationCapabilityContext,
): Promise<RecoverConversationResult> {
  const conversationId = conversationIdInput.trim();
  if (!conversationId) {
    throw new Error('conversationId required');
  }

  if (isLiveSession(conversationId)) {
    const liveEntry = liveRegistry.get(conversationId);

    if (liveEntry?.session.sessionFile) {
      await syncWebLiveConversationRun({
        conversationId,
        sessionFile: liveEntry.session.sessionFile,
        cwd: liveEntry.cwd,
        title: liveEntry.title,
        profile: context.getCurrentProfile(),
        state: 'running',
        pendingOperation: null,
      });
    }

    return {
      conversationId,
      live: true,
      recovered: true,
      replayedPendingOperation: false,
      usedFallbackPrompt: false,
    };
  }

  const runDetail = await getDurableRun(createWebLiveConversationRunId(conversationId));
  const payload = runDetail?.run.checkpoint?.payload;
  const checkpointPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};

  const pendingOperation = parsePendingOperation(checkpointPayload.pendingOperation);
  const sessionDetail = readSessionBlocks(conversationId);
  const sessionFile = sessionDetail?.meta.file
    ?? readCheckpointString(checkpointPayload, 'sessionFile')
    ?? runDetail?.run.manifest?.source?.filePath?.trim();

  if (!sessionFile || !existsSync(sessionFile)) {
    throw new Error('Conversation not found.');
  }

  const currentProfile = context.getCurrentProfile();
  const manifestSpec = runDetail?.run.manifest?.spec;
  const manifestCwd = typeof manifestSpec?.cwd === 'string' && manifestSpec.cwd.trim().length > 0
    ? manifestSpec.cwd.trim()
    : undefined;
  const resumed = await resumeSession(sessionFile, buildRecoveryLoaderOptions(context, currentProfile));
  await context.flushLiveDeferredResumes();

  const resumedEntry = liveRegistry.get(resumed.id);
  const effectiveCwd = resumedEntry?.cwd
    ?? sessionDetail?.meta.cwd
    ?? readCheckpointString(checkpointPayload, 'cwd')
    ?? manifestCwd;
  const effectiveTitle = sessionDetail?.meta.title ?? readCheckpointString(checkpointPayload, 'title');
  const effectiveProfile = readCheckpointString(checkpointPayload, 'profile') ?? currentProfile;

  if (!effectiveCwd) {
    throw new Error('Could not determine the conversation working directory.');
  }

  const recoveryOperation = pendingOperation ?? null;
  const replayedPendingOperation = Boolean(pendingOperation);
  const usedFallbackPrompt = false;

  await syncWebLiveConversationRun({
    conversationId: resumed.id,
    sessionFile,
    cwd: effectiveCwd,
    title: effectiveTitle,
    profile: effectiveProfile,
    state: 'running',
    pendingOperation: recoveryOperation,
  });

  if (recoveryOperation) {
    for (const message of recoveryOperation.contextMessages ?? []) {
      await queuePromptContext(resumed.id, message.customType, message.content);
    }

    promptSession(
      resumed.id,
      recoveryOperation.text,
      recoveryOperation.behavior as 'steer' | 'followUp' | undefined,
      recoveryOperation.images,
    ).catch(async (error) => {
      await syncWebLiveConversationRun({
        conversationId: resumed.id,
        sessionFile,
        cwd: effectiveCwd,
        title: effectiveTitle,
        profile: effectiveProfile,
        state: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
      });

      logError('conversation recovery error', {
        sessionId: resumed.id,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });
  }

  return {
    conversationId: resumed.id,
    live: true,
    recovered: true,
    replayedPendingOperation,
    usedFallbackPrompt,
  };
}

export async function recoverDurableLiveConversations(
  dependencies: RecoverDurableLiveConversationsDependencies,
): Promise<RecoverDurableLiveConversationsResult> {
  const recovered: RecoverDurableLiveConversationsResult['recovered'] = [];
  const runs = await listRecoverableWebLiveConversationRuns();
  const resumeFallbackPrompt = readWebUiConfig().resumeFallbackPrompt;

  for (const run of runs) {
    if (dependencies.isLive(run.conversationId)) {
      continue;
    }

    try {
      const pendingOperation = isSyntheticResumeFallbackOperation(run.pendingOperation, resumeFallbackPrompt)
        ? null
        : run.pendingOperation;

      if (!pendingOperation) {
        continue;
      }

      const resumed = await dependencies.resumeSession(run.sessionFile, dependencies.loaderOptions);

      await syncWebLiveConversationRun({
        conversationId: resumed.id,
        sessionFile: run.sessionFile,
        cwd: run.cwd,
        title: run.title,
        profile: run.profile,
        state: 'running',
        pendingOperation,
      });

      for (const message of pendingOperation.contextMessages ?? []) {
        await dependencies.queuePromptContext(resumed.id, message.customType, message.content);
      }

      await dependencies.promptSession(
        resumed.id,
        pendingOperation.text,
        pendingOperation.behavior,
        pendingOperation.images,
      );

      recovered.push({
        runId: run.runId,
        conversationId: resumed.id,
        replayedPendingOperation: true,
      });
      dependencies.logger?.info(
        `recovered conversation run=${run.runId} conversation=${resumed.id} replayed=true`,
      );
    } catch (error) {
      dependencies.logger?.warn(
        `failed to recover conversation run=${run.runId}: ${(error as Error).message}`,
      );
    }
  }

  return { recovered };
}
