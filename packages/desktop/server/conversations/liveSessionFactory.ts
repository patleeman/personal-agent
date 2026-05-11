import {
  AgentSession,
  AuthStorage,
  createAgentSession,
  createBashTool,
  type ExtensionFactory,
  ModelRegistry,
  type SessionManager,
} from '@earendil-works/pi-coding-agent';
import { resolveChildProcessEnv } from '@personal-agent/core';

import { readSavedModelPreferences } from '../models/modelPreferences.js';
import { createRuntimeModelRegistry } from '../models/modelRegistry.js';
import { applyConversationModelPreferencesToLiveSession } from './conversationModelPreferences.js';
import { type LiveSessionLoaderOptions, makeLoader } from './liveSessionLoader.js';
import {
  applyLiveSessionServiceTier,
  repairSessionModelProvider,
  resolveConversationPreferenceStateForSession,
} from './liveSessionModels.js';
import { ensureSessionFileExists, patchSessionManagerPersistence, resolveLiveSessionFile } from './liveSessionPersistence.js';

interface ToolPatchableSessionInternals {
  _baseToolRegistry?: Map<string, unknown>;
  _refreshToolRegistry?: (options: { activeToolNames: string[]; includeAllExtensionTools: boolean }) => void;
}

export function makeAuth(agentDir: string): AuthStorage {
  return AuthStorage.create(`${agentDir}/auth.json`);
}

export function makeRegistry(auth: AuthStorage, _extensionFactories?: ExtensionFactory[]): ModelRegistry {
  return createRuntimeModelRegistry(auth);
}

function patchConversationBashTool(session: AgentSession, cwd: string, conversationId: string, sessionFile?: string): void {
  const patchableSession = session as unknown as ToolPatchableSessionInternals;
  if (!(patchableSession._baseToolRegistry instanceof Map) || typeof patchableSession._refreshToolRegistry !== 'function') {
    return;
  }

  patchableSession._baseToolRegistry.set(
    'bash',
    createBashTool(cwd, {
      commandPrefix: session.settingsManager.getShellCommandPrefix(),
      spawnHook: (context) => ({
        ...context,
        env: resolveChildProcessEnv(
          {
            PERSONAL_AGENT_SOURCE_CONVERSATION_ID: conversationId,
            ...(sessionFile ? { PERSONAL_AGENT_SOURCE_SESSION_FILE: sessionFile } : {}),
          },
          context.env,
        ),
      }),
    }),
  );

  patchableSession._refreshToolRegistry({
    activeToolNames: session.getActiveToolNames(),
    includeAllExtensionTools: true,
  });
}

export async function createPreparedLiveAgentSession(input: {
  cwd: string;
  agentDir: string;
  settingsFile: string;
  sessionManager: SessionManager;
  options?: LiveSessionLoaderOptions;
  applyInitialPreferences?: boolean;
  ensureSessionFile?: boolean;
}): Promise<{ session: AgentSession; modelRegistry: ModelRegistry }> {
  const options = input.options ?? {};
  const auth = makeAuth(options.agentDir ?? input.agentDir);
  const modelRegistry = makeRegistry(auth, options.extensionFactories);
  const resourceLoader = await makeLoader(input.cwd, options);
  const { session } = await createAgentSession({
    cwd: input.cwd,
    agentDir: options.agentDir ?? input.agentDir,
    authStorage: auth,
    modelRegistry,
    resourceLoader,
    sessionManager: input.sessionManager,
    ...(options.allowedToolNames ? { tools: options.allowedToolNames } : {}),
  });

  patchConversationBashTool(session, input.cwd, session.sessionId, resolveLiveSessionFile(session));
  patchSessionManagerPersistence(session.sessionManager);
  if (input.ensureSessionFile !== false) {
    ensureSessionFileExists(session.sessionManager);
  }

  const availableModels = modelRegistry.getAvailable();
  await repairSessionModelProvider(session, availableModels);

  if (
    input.applyInitialPreferences &&
    (options.initialModel !== undefined || options.initialThinkingLevel !== undefined || options.initialServiceTier !== undefined)
  ) {
    await applyConversationModelPreferencesToLiveSession(
      session,
      {
        ...(options.initialModel !== undefined ? { model: options.initialModel } : {}),
        ...(options.initialThinkingLevel !== undefined ? { thinkingLevel: options.initialThinkingLevel } : {}),
        ...(options.initialServiceTier !== undefined ? { serviceTier: options.initialServiceTier } : {}),
      },
      {
        currentModel: session.model?.id ?? '',
        currentThinkingLevel: session.thinkingLevel ?? '',
        currentServiceTier: readSavedModelPreferences(input.settingsFile, availableModels).currentServiceTier,
      },
      availableModels,
    );
  }

  applyLiveSessionServiceTier(
    session,
    resolveConversationPreferenceStateForSession(input.settingsFile, session.sessionManager, availableModels).currentServiceTier,
  );

  return { session, modelRegistry };
}
