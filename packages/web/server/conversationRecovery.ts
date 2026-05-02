import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import {
  listRecoverableWebLiveConversationRuns,
  syncWebLiveConversationRun,
  type WebLiveConversationPromptImage,
} from './conversationRuns.js';

interface RecoveryLoaderOptions {
  extensionFactories?: ExtensionFactory[];
  additionalExtensionPaths?: string[];
  additionalSkillPaths?: string[];
  additionalPromptTemplatePaths?: string[];
  additionalThemePaths?: string[];
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

export async function recoverDurableLiveConversations(
  dependencies: RecoverDurableLiveConversationsDependencies,
): Promise<RecoverDurableLiveConversationsResult> {
  const recovered: RecoverDurableLiveConversationsResult['recovered'] = [];
  const runs = await listRecoverableWebLiveConversationRuns();

  for (const run of runs) {
    if (dependencies.isLive(run.conversationId)) {
      continue;
    }

    try {
      const resumed = await dependencies.resumeSession(run.sessionFile, dependencies.loaderOptions);

      if (run.pendingOperation) {
        await syncWebLiveConversationRun({
          conversationId: resumed.id,
          sessionFile: run.sessionFile,
          cwd: run.cwd,
          title: run.title,
          profile: run.profile,
          state: 'running',
          pendingOperation: run.pendingOperation,
        });

        for (const message of run.pendingOperation.contextMessages ?? []) {
          await dependencies.queuePromptContext(resumed.id, message.customType, message.content);
        }

        await dependencies.promptSession(
          resumed.id,
          run.pendingOperation.text,
          run.pendingOperation.behavior,
          run.pendingOperation.images,
        );
      }

      recovered.push({
        runId: run.runId,
        conversationId: resumed.id,
        replayedPendingOperation: Boolean(run.pendingOperation),
      });
      dependencies.logger?.info(
        `recovered conversation run=${run.runId} conversation=${resumed.id} replayed=${String(Boolean(run.pendingOperation))}`,
      );
    } catch (error) {
      dependencies.logger?.warn(
        `failed to recover conversation run=${run.runId}: ${(error as Error).message}`,
      );
    }
  }

  return { recovered };
}
