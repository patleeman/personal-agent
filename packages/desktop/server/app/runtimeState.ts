import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuthStorage, type ExtensionFactory } from '@mariozechner/pi-coding-agent';
import { getProfilesRoot, getStateRoot, writeMergedMcpConfigFile } from '@personal-agent/core';
import { materializeRuntimeResourcesToAgentDir, resolveRuntimeResources } from '@personal-agent/core';

import { renameSession, requestConversationWorkingDirectoryChange } from '../conversations/liveSessions.js';
import { createArtifactAgentExtension } from '../extensions/artifactAgentExtension.js';
import { createAskUserQuestionAgentExtension } from '../extensions/askUserQuestionAgentExtension.js';
import { createChangeWorkingDirectoryAgentExtension } from '../extensions/changeWorkingDirectoryAgentExtension.js';
import { createCheckpointAgentExtension } from '../extensions/checkpointAgentExtension.js';
import { createConversationAutoModeAgentExtension } from '../extensions/conversationAutoModeAgentExtension.js';
import { createConversationInspectAgentExtension } from '../extensions/conversationInspectAgentExtension.js';
import { createConversationQueueAgentExtension } from '../extensions/conversationQueueAgentExtension.js';
import { createConversationTitleAgentExtension } from '../extensions/conversationTitleAgentExtension.js';
import { createImageAgentExtension } from '../extensions/imageAgentExtension.js';
import { createImageProbeAgentExtension } from '../extensions/imageProbeAgentExtension.js';
import { createMcpAgentExtension } from '../extensions/mcpAgentExtension.js';
import openaiNativeCompactionExtension from '../extensions/openai-native-compaction/index.js';
import { createReminderAgentExtension } from '../extensions/reminderAgentExtension.js';
import { createRunAgentExtension } from '../extensions/runAgentExtension.js';
import { createScheduledTaskAgentExtension } from '../extensions/scheduledTaskAgentExtension.js';
import webToolsExtension from '../extensions/web-tools/index.js';
import { createWorkbenchBrowserAgentExtension } from '../extensions/workbenchBrowserAgentExtension.js';
import { readSavedModelPreferences } from '../models/modelPreferences.js';
import type { LiveSessionResourceOptions } from '../routes/context.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE } from '../ui/settingsPersistence.js';

export interface RuntimeStateLogger {
  warn: (message: string, fields?: Record<string, unknown>) => void;
}

export interface CreateRuntimeStateOptions {
  repoRoot: string;
  agentDir: string;
  logger: RuntimeStateLogger;
}

export interface RuntimeState {
  getRuntimeScope: () => string;
  materializeRuntimeResources: () => void;
  buildLiveSessionExtensionFactories: () => ExtensionFactory[];
  buildLiveSessionResourceOptions: () => LiveSessionResourceOptions;
  withTemporaryRuntimeAgentDir: <T>(run: (agentDir: string) => Promise<T>) => Promise<T>;
}

const DEFAULT_RUNTIME_SCOPE = 'shared';

export function createRuntimeState(options: CreateRuntimeStateOptions): RuntimeState {
  const { repoRoot, agentDir, logger } = options;
  const runtimeScope = DEFAULT_RUNTIME_SCOPE;

  function applyRuntimeEnvironment(mcpConfigPath?: string | null): void {
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = runtimeScope;
    process.env.PERSONAL_AGENT_PROFILE = runtimeScope;
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;

    if (mcpConfigPath) {
      process.env.MCP_CONFIG_PATH = mcpConfigPath;
      return;
    }

    delete process.env.MCP_CONFIG_PATH;
  }

  function materializeRuntimeResources(): void {
    const resolved = resolveRuntimeResources(runtimeScope, {
      repoRoot,
      profilesRoot: getProfilesRoot(),
    });
    materializeRuntimeResourcesToAgentDir(resolved, agentDir);
    const materializedMcpConfigPath = join(agentDir, 'mcp_servers.json');
    const mergedMcpConfig = writeMergedMcpConfigFile({
      outputPath: materializedMcpConfigPath,
      cwd: process.cwd(),
      env: process.env,
      skillDirs: resolved.skillDirs,
    });
    applyRuntimeEnvironment(mergedMcpConfig.bundledServerCount > 0 ? materializedMcpConfigPath : null);
  }

  try {
    materializeRuntimeResources();
  } catch (error) {
    logger.warn('failed to materialize runtime resources', {
      runtimeScope,
      message: (error as Error).message,
    });
  }

  function getRuntimeScope(): string {
    return runtimeScope;
  }

  function hasOpenAiImageProvider(): boolean {
    try {
      const auth = AuthStorage.create(join(agentDir, 'auth.json'));
      return auth.hasAuth('openai') || auth.hasAuth('openai-codex');
    } catch {
      return false;
    }
  }

  function getPreferredVisionModel(): string {
    return readSavedModelPreferences(DEFAULT_RUNTIME_SETTINGS_FILE).currentVisionModel;
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
        getCurrentProfile: getRuntimeScope,
      }),
      createAskUserQuestionAgentExtension(),
      createChangeWorkingDirectoryAgentExtension({
        requestConversationWorkingDirectoryChange: (input) =>
          requestConversationWorkingDirectoryChange(input, {
            ...buildLiveSessionResourceOptions(),
            extensionFactories: buildLiveSessionExtensionFactories(),
          }),
      }),
      createRunAgentExtension({
        getCurrentProfile: getRuntimeScope,
        repoRoot,
        profilesRoot: getProfilesRoot(),
      }),
      createConversationInspectAgentExtension(),
      createConversationTitleAgentExtension({
        setConversationTitle: renameSession,
      }),
      ...(getPreferredVisionModel() ? [createImageProbeAgentExtension({ getPreferredVisionModel })] : []),
      ...(hasOpenAiImageProvider() ? [createImageAgentExtension()] : []),
      createArtifactAgentExtension({
        stateRoot: getStateRoot(),
        repoRoot,
        getCurrentProfile: getRuntimeScope,
      }),
      createCheckpointAgentExtension({
        stateRoot: getStateRoot(),
        getCurrentProfile: getRuntimeScope,
      }),
      createMcpAgentExtension(),
      createWorkbenchBrowserAgentExtension(),
      createConversationAutoModeAgentExtension(),
      createConversationQueueAgentExtension({ getCurrentProfile: getRuntimeScope }),
      createReminderAgentExtension(),
      webToolsExtension,

      openaiNativeCompactionExtension,
    ].map(guardSystemPromptOverride);
  }

  function buildLiveSessionResourceOptions(): LiveSessionResourceOptions {
    const resolved = resolveRuntimeResources(runtimeScope, {
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

  function withTemporaryRuntimeAgentDir<T>(run: (runtimeAgentDir: string) => Promise<T>): Promise<T> {
    const resolved = resolveRuntimeResources(runtimeScope, {
      repoRoot,
      profilesRoot: getProfilesRoot(),
    });
    const runtimeAgentDir = mkdtempSync(join(tmpdir(), 'pa-web-runtime-inspect-'));
    materializeRuntimeResourcesToAgentDir(resolved, runtimeAgentDir);

    return run(runtimeAgentDir).finally(() => {
      rmSync(runtimeAgentDir, { recursive: true, force: true });
    });
  }

  return {
    getRuntimeScope,
    materializeRuntimeResources,
    buildLiveSessionExtensionFactories,
    buildLiveSessionResourceOptions,
    withTemporaryRuntimeAgentDir,
  };
}
