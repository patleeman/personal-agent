import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuthStorage, type ExtensionFactory } from '@mariozechner/pi-coding-agent';
import { getProfilesRoot, getStateRoot, writeMergedMcpConfigFile } from '@personal-agent/core';
import { materializeProfileToAgentDir, resolveResourceProfile } from '@personal-agent/core';

import { renameSession, requestConversationWorkingDirectoryChange } from '../conversations/liveSessions.js';
import { createArtifactAgentExtension } from '../extensions/artifactAgentExtension.js';
import { createAskUserQuestionAgentExtension } from '../extensions/askUserQuestionAgentExtension.js';
import { createChangeWorkingDirectoryAgentExtension } from '../extensions/changeWorkingDirectoryAgentExtension.js';
import { createCheckpointAgentExtension } from '../extensions/checkpointAgentExtension.js';
import { createConversationAutoModeAgentExtension } from '../extensions/conversationAutoModeAgentExtension.js';
import { createConversationInspectAgentExtension } from '../extensions/conversationInspectAgentExtension.js';
import { createConversationQueueAgentExtension } from '../extensions/conversationQueueAgentExtension.js';
import { createConversationTitleAgentExtension } from '../extensions/conversationTitleAgentExtension.js';
import gptApplyPatchExtension from '../extensions/gpt-apply-patch/index.js';
import { createImageAgentExtension } from '../extensions/imageAgentExtension.js';
import { createMcpAgentExtension } from '../extensions/mcpAgentExtension.js';
import openaiNativeCompactionExtension from '../extensions/openai-native-compaction/index.js';
import { createReminderAgentExtension } from '../extensions/reminderAgentExtension.js';
import { createRunAgentExtension } from '../extensions/runAgentExtension.js';
import { createScheduledTaskAgentExtension } from '../extensions/scheduledTaskAgentExtension.js';
import webToolsExtension from '../extensions/web-tools/index.js';
import { createWorkbenchBrowserAgentExtension } from '../extensions/workbenchBrowserAgentExtension.js';
import type { LiveSessionResourceOptions } from '../routes/context.js';

export interface ProfileStateLogger {
  warn: (message: string, fields?: Record<string, unknown>) => void;
}

export interface CreateProfileStateOptions {
  repoRoot: string;
  agentDir: string;
  logger: ProfileStateLogger;
}

export interface ProfileState {
  getCurrentProfile: () => string;
  materializeWebProfile: (profile: string) => void;
  buildLiveSessionExtensionFactories: () => ExtensionFactory[];
  buildLiveSessionResourceOptions: (profile?: string) => LiveSessionResourceOptions;
  withTemporaryProfileAgentDir: <T>(profile: string, run: (agentDir: string) => Promise<T>) => Promise<T>;
}

export function createProfileState(options: CreateProfileStateOptions): ProfileState {
  const { repoRoot, agentDir, logger } = options;
  const currentProfile = 'shared';

  function applyProfileEnvironment(profile: string, mcpConfigPath?: string | null): void {
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = profile;
    process.env.PERSONAL_AGENT_PROFILE = profile;
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;

    if (mcpConfigPath) {
      process.env.MCP_CONFIG_PATH = mcpConfigPath;
      return;
    }

    delete process.env.MCP_CONFIG_PATH;
  }

  function materializeWebProfile(profile: string): void {
    const resolved = resolveResourceProfile(profile, {
      repoRoot,
      profilesRoot: getProfilesRoot(),
    });
    materializeProfileToAgentDir(resolved, agentDir);
    const materializedMcpConfigPath = join(agentDir, 'mcp_servers.json');
    const mergedMcpConfig = writeMergedMcpConfigFile({
      outputPath: materializedMcpConfigPath,
      cwd: process.cwd(),
      env: process.env,
      skillDirs: resolved.skillDirs,
    });
    applyProfileEnvironment(profile, mergedMcpConfig.bundledServerCount > 0 ? materializedMcpConfigPath : null);
  }

  try {
    materializeWebProfile(currentProfile);
  } catch (error) {
    logger.warn('failed to materialize initial profile', {
      profile: currentProfile,
      message: (error as Error).message,
    });
  }

  function getCurrentProfile(): string {
    return currentProfile;
  }

  function hasOpenAiImageProvider(): boolean {
    try {
      const auth = AuthStorage.create(join(agentDir, 'auth.json'));
      return auth.hasAuth('openai') || auth.hasAuth('openai-codex');
    } catch {
      return false;
    }
  }

  /**
   * Wraps an extension factory to discard any systemPrompt return from
   * before_agent_start. The system prompt is assembled exclusively from
   * file layers (SYSTEM.md, APPEND_SYSTEM.md, AGENTS.md from CWD).
   * Extensions that need to influence the system prompt should write to
   * those files during setup, not override at runtime.
   */
  function guardSystemPromptOverride(factory: ExtensionFactory): ExtensionFactory {
    return (pi: ExtensionAPI) => {
      const guardedPi = new Proxy(pi, {
        get(target, prop, receiver) {
          if (prop === 'on') {
            return (event: string, handler: (...args: unknown[]) => unknown) => {
              if (event === 'before_agent_start') {
                const wrappedHandler = async (...args: unknown[]) => {
                  const result = await handler(...args);
                  if (result && typeof result === 'object' && 'systemPrompt' in (result as Record<string, unknown>)) {
                    logger.warn('Extension attempted to override system prompt via before_agent_start — discarded');
                    return undefined;
                  }
                  return result;
                };
                return Reflect.apply(target.on, target, [event, wrappedHandler]);
              }
              return Reflect.apply(target.on, target, [event, handler]);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      factory(guardedPi);
    };
  }

  function buildLiveSessionExtensionFactories(): ExtensionFactory[] {
    return [
      createScheduledTaskAgentExtension({
        getCurrentProfile,
      }),
      createAskUserQuestionAgentExtension(),
      createChangeWorkingDirectoryAgentExtension({
        requestConversationWorkingDirectoryChange: (input) =>
          requestConversationWorkingDirectoryChange(input, {
            ...buildLiveSessionResourceOptions(getCurrentProfile()),
            extensionFactories: buildLiveSessionExtensionFactories(),
          }),
      }),
      createRunAgentExtension({
        getCurrentProfile,
        repoRoot,
        profilesRoot: getProfilesRoot(),
      }),
      createConversationInspectAgentExtension(),
      createConversationTitleAgentExtension({
        setConversationTitle: renameSession,
      }),
      ...(hasOpenAiImageProvider() ? [createImageAgentExtension()] : []),
      createArtifactAgentExtension({
        stateRoot: getStateRoot(),
        repoRoot,
        getCurrentProfile,
      }),
      createCheckpointAgentExtension({
        stateRoot: getStateRoot(),
        getCurrentProfile,
      }),
      createMcpAgentExtension(),
      createWorkbenchBrowserAgentExtension(),
      createConversationAutoModeAgentExtension(),
      createConversationQueueAgentExtension({ getCurrentProfile }),
      createReminderAgentExtension(),
      webToolsExtension,
      gptApplyPatchExtension,

      openaiNativeCompactionExtension,
    ].map(guardSystemPromptOverride);
  }

  function buildLiveSessionResourceOptions(profile = getCurrentProfile()): LiveSessionResourceOptions {
    const resolved = resolveResourceProfile(profile, {
      repoRoot,
      profilesRoot: getProfilesRoot(),
    });

    return {
      additionalExtensionPaths: resolved.extensionEntries,
      additionalSkillPaths: [...new Set(resolved.skillDirs)],
      additionalPromptTemplatePaths: resolved.promptEntries,
      additionalThemePaths: resolved.themeEntries,
    };
  }

  function withTemporaryProfileAgentDir<T>(profile: string, run: (profileAgentDir: string) => Promise<T>): Promise<T> {
    const resolved = resolveResourceProfile(profile, {
      repoRoot,
      profilesRoot: getProfilesRoot(),
    });
    const profileAgentDir = mkdtempSync(join(tmpdir(), 'pa-web-profile-inspect-'));
    materializeProfileToAgentDir(resolved, profileAgentDir);

    return run(profileAgentDir).finally(() => {
      rmSync(profileAgentDir, { recursive: true, force: true });
    });
  }

  return {
    getCurrentProfile,
    materializeWebProfile,
    buildLiveSessionExtensionFactories,
    buildLiveSessionResourceOptions,
    withTemporaryProfileAgentDir,
  };
}
