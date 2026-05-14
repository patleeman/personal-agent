import { existsSync } from 'node:fs';

import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { parsePendingOperation } from '@personal-agent/daemon';

import { getDurableRun } from '../automation/durableRuns.js';
import { logError } from '../middleware/index.js';
import {
  createWebLiveConversationRunId,
  syncWebLiveConversationRun,
  type WebLiveConversationPendingOperation,
} from './conversationRuns.js';
import {
  isLive as isLiveSession,
  promptSession,
  queuePromptContext,
  registry as liveRegistry,
  repairLiveSessionTranscriptTail,
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

async function continueRecoveredConversation(input: {
  conversationId: string;
  sessionFile?: string;
  cwd: string;
  title?: string;
  profile: string;
  recoveryOperation: WebLiveConversationPendingOperation | null;
}): Promise<Pick<RecoverConversationResult, 'replayedPendingOperation' | 'usedFallbackPrompt'>> {
  repairLiveSessionTranscriptTail(input.conversationId);
  const promptOperation = input.recoveryOperation;

  const sessionFile = input.sessionFile?.trim();
  if (sessionFile) {
    await syncWebLiveConversationRun({
      conversationId: input.conversationId,
      sessionFile,
      cwd: input.cwd,
      title: input.title,
      profile: input.profile,
      state: promptOperation ? 'running' : 'waiting',
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
  }

  return {
    replayedPendingOperation: Boolean(input.recoveryOperation),
    usedFallbackPrompt: false,
  };
}

export async function recoverConversationCapability(
  conversationIdInput: string,
  context: RecoverConversationCapabilityContext,
  options: { replayPendingOperation?: boolean } = {},
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

  const pendingOperation = options.replayPendingOperation ? parsePendingOperation(checkpointPayload.pendingOperation) : undefined;
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
  });

  return {
    conversationId: resumed.id,
    live: true,
    recovered: true,
    ...continuation,
  };
}
