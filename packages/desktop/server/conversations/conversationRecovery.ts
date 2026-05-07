import { existsSync } from 'node:fs';

import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { readMachineUiConfig } from '@personal-agent/core';
import { parsePendingOperation } from '@personal-agent/daemon';

import { getDurableRun } from '../automation/durableRuns.js';
import { logError } from '../middleware/index.js';
import { readConversationAutoModeStateFromSessionManager } from './conversationAutoMode.js';
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
  repairLiveSessionTranscriptTail,
  requestConversationAutoModeTurn,
  resumeSession,
} from './liveSessions.js';
import { type DisplayBlock, readSessionBlocks } from './sessions.js';

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
  resumeSession: (sessionFile: string, options?: RecoveryLoaderOptions & { cwdOverride?: string }) => Promise<{ id: string }>;
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
  return operation.text.trim() === normalizedPrompt && operation.behavior === undefined && !hasImages && !hasContextMessages;
}

function isTerminalBashDisplayBlock(block: DisplayBlock | null | undefined): boolean {
  if (!block || block.type !== 'tool_use' || block.tool !== 'bash') {
    return false;
  }

  const details = block.details;
  return (
    typeof details === 'object' &&
    details !== null &&
    !Array.isArray(details) &&
    (details as { displayMode?: unknown }).displayMode === 'terminal'
  );
}

function displayBlockNeedsResumeFallback(block: DisplayBlock | null | undefined): boolean {
  if (!block) {
    return false;
  }

  switch (block.type) {
    case 'error':
      return true;
    case 'thinking':
      return true;
    case 'tool_use':
      return !isTerminalBashDisplayBlock(block);
    default:
      return false;
  }
}

async function continueRecoveredConversation(input: {
  conversationId: string;
  sessionFile?: string;
  cwd: string;
  title?: string;
  profile: string;
  recoveryOperation: WebLiveConversationPendingOperation | null;
  lastBlock?: DisplayBlock | null;
}): Promise<Pick<RecoverConversationResult, 'replayedPendingOperation' | 'usedFallbackPrompt'>> {
  const repairedTail = repairLiveSessionTranscriptTail(input.conversationId);
  const liveEntry = liveRegistry.get(input.conversationId);
  const autoModeEnabled = Boolean(
    liveEntry?.session.sessionManager && readConversationAutoModeStateFromSessionManager(liveEntry.session.sessionManager).enabled,
  );

  const fallbackPrompt = readMachineUiConfig().resumeFallbackPrompt.trim();
  const shouldUseFallbackPrompt =
    !input.recoveryOperation &&
    !autoModeEnabled &&
    fallbackPrompt.length > 0 &&
    (repairedTail.recoverable || displayBlockNeedsResumeFallback(input.lastBlock));

  const promptOperation =
    input.recoveryOperation ??
    (shouldUseFallbackPrompt
      ? {
          type: 'prompt' as const,
          text: fallbackPrompt,
          enqueuedAt: new Date().toISOString(),
        }
      : null);

  const sessionFile = input.sessionFile?.trim();
  if (sessionFile) {
    await syncWebLiveConversationRun({
      conversationId: input.conversationId,
      sessionFile,
      cwd: input.cwd,
      title: input.title,
      profile: input.profile,
      state: 'running',
      pendingOperation: promptOperation,
    });
  }

  if (promptOperation) {
    for (const message of promptOperation.contextMessages ?? []) {
      await queuePromptContext(input.conversationId, message.customType, message.content);
    }

    promptSession(input.conversationId, promptOperation.text, promptOperation.behavior, promptOperation.images).catch(async (error) => {
      if (sessionFile) {
        await syncWebLiveConversationRun({
          conversationId: input.conversationId,
          sessionFile,
          cwd: input.cwd,
          title: input.title,
          profile: input.profile,
          state: 'failed',
          lastError: error instanceof Error ? error.message : String(error),
        });
      }

      logError('conversation recovery error', {
        sessionId: input.conversationId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });
  } else if (autoModeEnabled) {
    queueMicrotask(() => {
      void Promise.resolve(requestConversationAutoModeTurn(input.conversationId)).catch((error) => {
        logError('conversation recovery auto mode request failed', {
          sessionId: input.conversationId,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      });
    });
  }

  return {
    replayedPendingOperation: Boolean(input.recoveryOperation),
    usedFallbackPrompt: shouldUseFallbackPrompt,
  };
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
    const liveSessionDetail = readSessionBlocks(conversationId);
    const continuation = await continueRecoveredConversation({
      conversationId,
      sessionFile: liveEntry?.session.sessionFile,
      cwd: liveEntry?.cwd ?? liveSessionDetail?.meta.cwd ?? '',
      title: liveEntry?.title ?? liveSessionDetail?.meta.title,
      profile: context.getCurrentProfile(),
      recoveryOperation: null,
      lastBlock: liveSessionDetail?.blocks.at(-1) ?? null,
    });

    return {
      conversationId,
      live: true,
      recovered: true,
      ...continuation,
    };
  }

  const runDetail = await getDurableRun(createWebLiveConversationRunId(conversationId));
  const payload = runDetail?.run.checkpoint?.payload;
  const checkpointPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};

  const pendingOperation = parsePendingOperation(checkpointPayload.pendingOperation);
  const sessionDetail = readSessionBlocks(conversationId);
  const sessionFile =
    sessionDetail?.meta.file ?? readCheckpointString(checkpointPayload, 'sessionFile') ?? runDetail?.run.manifest?.source?.filePath?.trim();

  if (!sessionFile || !existsSync(sessionFile)) {
    throw new Error('Conversation not found.');
  }

  const currentProfile = context.getCurrentProfile();
  const manifestSpec = runDetail?.run.manifest?.spec;
  const manifestCwd = typeof manifestSpec?.cwd === 'string' && manifestSpec.cwd.trim().length > 0 ? manifestSpec.cwd.trim() : undefined;
  const requestedCwd = sessionDetail?.meta.cwd ?? readCheckpointString(checkpointPayload, 'cwd') ?? manifestCwd;
  const resumed = await resumeSession(sessionFile, {
    ...buildRecoveryLoaderOptions(context, currentProfile),
    ...(requestedCwd ? { cwdOverride: requestedCwd } : {}),
  });
  await context.flushLiveDeferredResumes();

  const resumedEntry = liveRegistry.get(resumed.id);
  const effectiveCwd = resumedEntry?.cwd ?? requestedCwd;
  const effectiveTitle = sessionDetail?.meta.title ?? readCheckpointString(checkpointPayload, 'title');
  const effectiveProfile = readCheckpointString(checkpointPayload, 'profile') ?? currentProfile;

  if (!effectiveCwd) {
    throw new Error('Could not determine the conversation working directory.');
  }

  const continuation = await continueRecoveredConversation({
    conversationId: resumed.id,
    sessionFile,
    cwd: effectiveCwd,
    title: effectiveTitle,
    profile: effectiveProfile,
    recoveryOperation: pendingOperation ?? null,
    lastBlock: sessionDetail?.blocks.at(-1) ?? null,
  });

  return {
    conversationId: resumed.id,
    live: true,
    recovered: true,
    ...continuation,
  };
}

export async function recoverDurableLiveConversations(
  dependencies: RecoverDurableLiveConversationsDependencies,
): Promise<RecoverDurableLiveConversationsResult> {
  const recovered: RecoverDurableLiveConversationsResult['recovered'] = [];
  const runs = await listRecoverableWebLiveConversationRuns();
  const resumeFallbackPrompt = readMachineUiConfig().resumeFallbackPrompt;

  for (const run of runs) {
    if (dependencies.isLive(run.conversationId)) {
      continue;
    }

    try {
      const pendingOperation = isSyntheticResumeFallbackOperation(run.pendingOperation, resumeFallbackPrompt) ? null : run.pendingOperation;

      if (!pendingOperation) {
        continue;
      }

      const resumed = await dependencies.resumeSession(run.sessionFile, {
        ...(dependencies.loaderOptions ?? {}),
        cwdOverride: run.cwd,
      });

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

      await dependencies.promptSession(resumed.id, pendingOperation.text, pendingOperation.behavior, pendingOperation.images);

      recovered.push({
        runId: run.runId,
        conversationId: resumed.id,
        replayedPendingOperation: true,
      });
      dependencies.logger?.info(`recovered conversation run=${run.runId} conversation=${resumed.id} replayed=true`);
    } catch (error) {
      dependencies.logger?.warn(`failed to recover conversation run=${run.runId}: ${(error as Error).message}`);
    }
  }

  return { recovered };
}
