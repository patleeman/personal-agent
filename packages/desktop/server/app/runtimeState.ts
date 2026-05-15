import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { AuthStorage, type ExtensionAPI, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { getProfilesRoot, getStateRoot, writeMergedMcpConfigFile } from '@personal-agent/core';
import { materializeRuntimeResourcesToAgentDir, resolveRuntimeResources } from '@personal-agent/core';

import { type BashProcessWrapper, clearBashProcessWrappers, registerBashProcessWrapper } from '../conversations/processWrappers.js';
import { createManifestAgentExtensions } from '../extensions/extensionAgentExtensions.js';
import { isExtensionEnabled, listExtensionEntries, listExtensionSkillRegistrations } from '../extensions/extensionRegistry.js';
import { createManifestToolAgentExtensions } from '../extensions/manifestToolAgentExtension.js';
import { setRuntimeAgentHookBuilders } from '../extensions/runtimeAgentHooks.js';
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

  function resolveRuntimeExtensionEntries(): string[] {
    return listExtensionEntries()
      .filter((entry) => {
        if (entry.source !== 'system') return true;
        return isExtensionEnabled(entry.manifest.id);
      })
      .flatMap((entry) => {
        const backend = entry.manifest.backend?.entry;
        if (!backend) return [];
        return entry.packageRoot ? [join(entry.packageRoot, backend)] : [];
      });
  }

  function materializeRuntimeResources(): void {
    const resolved = resolveRuntimeResources(runtimeScope, {
      repoRoot,
      extensionEntries: resolveRuntimeExtensionEntries(),
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

  setRuntimeAgentHookBuilders({
    buildLiveSessionResourceOptions,
    buildLiveSessionExtensionFactories,
  });

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
   * Wraps an extension factory to enforce stable runtime boundaries.
   * The system prompt is assembled exclusively from file layers
   * (SYSTEM.md, APPEND_SYSTEM.md, AGENTS.md from CWD). Extensions that
   * need to influence the system prompt should write to those files during
   * setup, not override at runtime.
   *
   * Tool registration is also stable for the life of a session. Extensions
   * must register their tools and validate runtime state inside handlers
   * instead of dynamically mutating the active tool set.
   */
  function guardExtensionApi(factory: ExtensionFactory): ExtensionFactory {
    return (pi: ExtensionAPI) => {
      const apiWithProcessWrappers = pi as ExtensionAPI & {
        registerBashProcessWrapper?: (id: string, wrap: BashProcessWrapper, options?: { label?: string }) => void;
      };
      apiWithProcessWrappers.registerBashProcessWrapper = registerBashProcessWrapper;

      const guardedPi = new Proxy(apiWithProcessWrappers, {
        get(target, prop, receiver) {
          if (prop === 'setActiveTools') {
            return () => {
              throw new Error('setActiveTools is deprecated and unsupported. Register tools once and validate state in handlers.');
            };
          }
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
    clearBashProcessWrappers();
    const agentExtensions = createManifestAgentExtensions({ onError: logger.warn });

    // Surface agent extension loading errors as session-level diagnostics
    for (const err of agentExtensions.errors) {
      logger.warn('extension agent factory failed to load', {
        extensionId: err.extensionId,
        message: err.message,
      });
    }

    // TODO: Remove this stub once the unified error display is wired up.
    // This simulates what a real extension loading error looks like through
    // the diagnostics pipeline. Replace with actual extension load-error
    // collection from the resource loader's extensionsResult.errors.
    {
      const stubErrors = [
        {
          extensionId: 'system-conversation-tools',
          message: 'Backend build failed — source files not found in bundled app (stub)',
        },
      ];
      for (const err of stubErrors) {
        logger.warn('extension load error', err);
      }
    }

    return [
      ...createManifestToolAgentExtensions({
        getCurrentProfile: getRuntimeScope,
        getPreferredVisionModel,
        hasOpenAiImageProvider,
        repoRoot,
        profilesRoot: getProfilesRoot(),
        stateRoot: getStateRoot(),
        serverContext: { getCurrentProfile: getRuntimeScope },
      }),

      ...agentExtensions.factories,
    ].map(guardExtensionApi);
  }

  function buildLiveSessionResourceOptions(): LiveSessionResourceOptions {
    const resolved = resolveRuntimeResources(runtimeScope, {
      repoRoot,
      extensionEntries: resolveRuntimeExtensionEntries(),
    });

    return {
      additionalExtensionPaths: resolved.extensionEntries,
      additionalSkillPaths: [...new Set([...resolved.skillDirs, ...listExtensionSkillRegistrations().map((skill) => dirname(skill.path))])],
      additionalPromptTemplatePaths: resolved.promptEntries,
      additionalThemePaths: resolved.themeEntries,
    };
  }

  function withTemporaryRuntimeAgentDir<T>(run: (runtimeAgentDir: string) => Promise<T>): Promise<T> {
    const resolved = resolveRuntimeResources(runtimeScope, {
      repoRoot,
      extensionEntries: resolveRuntimeExtensionEntries(),
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
