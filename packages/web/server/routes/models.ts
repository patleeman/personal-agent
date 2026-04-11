/**
 * Model and provider routes
 * 
 * Handles model preferences, model providers, and provider authentication.
 */

import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import { getDefaultVaultRoot, getMachineConfigFilePath, getVaultRoot, readMachineConfig, readMachineInstructionFiles, updateMachineConfig, writeMachineInstructionFiles } from '@personal-agent/core';
import type { ServerRouteContext } from './context.js';
import {
  writeSavedModelPreferences,
} from '../models/modelPreferences.js';
import { listModelDefinitions, readModelState } from '../models/modelState.js';
import {
  readModelProvidersState,
  removeModelProvider,
  removeModelProviderModel,
  upsertModelProvider,
  upsertModelProviderModel,
} from '../models/modelProviders.js';
import {
  cancelProviderOAuthLogin,
  getProviderOAuthLoginState,
  readProviderAuthState,
  removeProviderCredential,
  setProviderApiKey,
  startProviderOAuthLogin,
  submitProviderOAuthLoginInput,
  subscribeProviderOAuthLogin,
} from '../models/providerAuth.js';
import { readCodexPlanUsage } from '../models/codexUsage.js';
import { readSavedDefaultCwdPreferences, writeSavedDefaultCwdPreference } from '../ui/defaultCwdPreferences.js';
import { readConversationPlansWorkspace } from '../ui/conversationPlanPreferences.js';
import {
  logError,
  persistSettingsWrite,
  reloadAllLiveSessionAuth,
  refreshAllLiveSessionModelRegistries,
} from '../middleware/index.js';

/**
 * Gets the current profile getter for use in route handlers.
 */
let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for model routes');
};

let getCurrentProfileSettingsFileFn: () => string = () => {
  throw new Error('getCurrentProfileSettingsFile not initialized for model routes');
};

let materializeWebProfileFn: (profile: string) => void = () => {
  throw new Error('materializeWebProfile not initialized for model routes');
};

let AUTH_FILE: string = '';

let SETTINGS_FILE: string = '';

function expandHomePath(value: string): string {
  if (value === '~') {
    return homedir();
  }

  if (value.startsWith('~/')) {
    return join(homedir(), value.slice(2));
  }

  return value;
}

function readConfiguredVaultRoot(): string {
  const config = readMachineConfig() as { vaultRoot?: unknown };
  return typeof config.vaultRoot === 'string' ? config.vaultRoot : '';
}

function readInstructionFilesState() {
  return {
    configFile: getMachineConfigFilePath(),
    instructionFiles: readMachineInstructionFiles(),
  };
}

function initializeModelRoutesContext(
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getCurrentProfileSettingsFile' | 'materializeWebProfile' | 'getAuthFile' | 'getSettingsFile'>,
): void {
  getCurrentProfileFn = context.getCurrentProfile;
  getCurrentProfileSettingsFileFn = context.getCurrentProfileSettingsFile;
  materializeWebProfileFn = context.materializeWebProfile;
  AUTH_FILE = context.getAuthFile();
  SETTINGS_FILE = context.getSettingsFile();
}

/**
 * Register model routes on the given router.
 */
export function registerModelRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch' | 'delete'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getCurrentProfileSettingsFile' | 'materializeWebProfile' | 'getAuthFile' | 'getSettingsFile'>,
): void {
  initializeModelRoutesContext(context);
  // ── Models ────────────────────────────────────────────────────────────────

  router.get('/api/models', (_req, res) => {
    try {
      res.json(readModelState(SETTINGS_FILE));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.patch('/api/models/current', (req, res) => {
    try {
      const { model, thinkingLevel } = req.body as { model?: string; thinkingLevel?: string };
      if (typeof model !== 'string' && typeof thinkingLevel !== 'string') {
        res.status(400).json({ error: 'model or thinkingLevel required' });
        return;
      }

      const models = listModelDefinitions();
      persistSettingsWrite((settingsFile) => {
        writeSavedModelPreferences({ model, thinkingLevel }, settingsFile, models);
      }, {
        localSettingsFile: getCurrentProfileSettingsFileFn(),
        runtimeSettingsFile: SETTINGS_FILE,
      });

      materializeWebProfileFn(getCurrentProfileFn());

      res.json({ ok: true });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/default-cwd', (_req, res) => {
    try {
      res.json(readSavedDefaultCwdPreferences(SETTINGS_FILE, process.cwd()));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/vault-root', (_req, res) => {
    try {
      const currentRoot = readConfiguredVaultRoot();
      const source = process.env.PERSONAL_AGENT_VAULT_ROOT?.trim().length
        ? 'env'
        : currentRoot.length > 0
          ? 'config'
          : 'default';
      res.json({
        currentRoot,
        effectiveRoot: getVaultRoot(),
        defaultRoot: getDefaultVaultRoot(),
        source,
      });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/instructions', (_req, res) => {
    try {
      res.json(readInstructionFilesState());
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.patch('/api/instructions', (req, res) => {
    try {
      const { instructionFiles } = req.body as { instructionFiles?: unknown };
      if (!Array.isArray(instructionFiles) || !instructionFiles.every((entry) => typeof entry === 'string')) {
        res.status(400).json({ error: 'instructionFiles must be an array of strings' });
        return;
      }

      for (const rawFile of instructionFiles) {
        const filePath = rawFile.trim();
        if (!filePath) {
          continue;
        }
        if (!existsSync(filePath)) {
          res.status(400).json({ error: `File does not exist: ${filePath}` });
          return;
        }
        if (!statSync(filePath).isFile()) {
          res.status(400).json({ error: `Not a file: ${filePath}` });
          return;
        }
      }

      writeMachineInstructionFiles(instructionFiles);
      materializeWebProfileFn(getCurrentProfileFn());
      res.json(readInstructionFilesState());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('does not exist') || message.includes('Not a file') ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  router.patch('/api/vault-root', (req, res) => {
    try {
      const { root } = req.body as { root?: string | null };
      if (root !== undefined && root !== null && typeof root !== 'string') {
        res.status(400).json({ error: 'root must be a string or null' });
        return;
      }

      const normalizedRoot = typeof root === 'string' ? root.trim() : '';
      if (normalizedRoot.length > 0) {
        const resolvedRoot = expandHomePath(normalizedRoot);
        if (!existsSync(resolvedRoot)) {
          res.status(400).json({ error: `Directory does not exist: ${resolvedRoot}` });
          return;
        }
        if (!statSync(resolvedRoot).isDirectory()) {
          res.status(400).json({ error: `Not a directory: ${resolvedRoot}` });
          return;
        }
      }

      updateMachineConfig((current) => {
        const next = { ...(current as Record<string, unknown>) } as Record<string, unknown>;
        if (normalizedRoot.length > 0) {
          next.vaultRoot = normalizedRoot;
        } else {
          delete next.vaultRoot;
        }
        return next as typeof current;
      });
      materializeWebProfileFn(getCurrentProfileFn());

      const currentRoot = readConfiguredVaultRoot();
      const source = process.env.PERSONAL_AGENT_VAULT_ROOT?.trim().length
        ? 'env'
        : currentRoot.length > 0
          ? 'config'
          : 'default';
      res.json({
        currentRoot,
        effectiveRoot: getVaultRoot(),
        defaultRoot: getDefaultVaultRoot(),
        source,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('Directory does not exist') || message.includes('Not a directory')
        ? 400
        : 500;
      res.status(status).json({ error: message });
    }
  });

  router.patch('/api/default-cwd', (req, res) => {
    try {
      const { cwd } = req.body as { cwd?: string | null };
      if (cwd !== undefined && cwd !== null && typeof cwd !== 'string') {
        res.status(400).json({ error: 'cwd must be a string or null' });
        return;
      }

      const state = persistSettingsWrite((settingsFile) => writeSavedDefaultCwdPreference(
        { cwd },
        settingsFile,
        { baseDir: process.cwd(), validate: true },
      ), {
        localSettingsFile: getCurrentProfileSettingsFileFn(),
        runtimeSettingsFile: SETTINGS_FILE,
      });

      materializeWebProfileFn(getCurrentProfileFn());
      res.json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('required') || message.includes('Directory does not exist') || message.includes('Not a directory')
        ? 400
        : 500;
      res.status(status).json({ error: message });
    }
  });

  router.get('/api/conversation-plans/workspace', (_req, res) => {
    try {
      res.json(readConversationPlansWorkspace(SETTINGS_FILE));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Model Providers ────────────────────────────────────────────────────────

  router.get('/api/model-providers', (_req, res) => {
    try {
      res.json(readModelProvidersState(getCurrentProfileFn()));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/model-providers/providers', (req, res) => {
    try {
      const {
        provider,
        baseUrl,
        api,
        apiKey,
        authHeader,
        headers,
        compat,
        modelOverrides,
      } = req.body as {
        provider?: string;
        baseUrl?: string;
        api?: string;
        apiKey?: string;
        authHeader?: boolean;
        headers?: Record<string, string>;
        compat?: Record<string, unknown>;
        modelOverrides?: Record<string, unknown>;
      };

      if (typeof provider !== 'string' || provider.trim().length === 0) {
        res.status(400).json({ error: 'provider required' });
        return;
      }

      const state = upsertModelProvider(getCurrentProfileFn(), provider, {
        baseUrl,
        api: api as Parameters<typeof upsertModelProvider>[2]['api'],
        apiKey,
        authHeader,
        headers,
        compat,
        modelOverrides,
      });
      materializeWebProfileFn(getCurrentProfileFn());
      refreshAllLiveSessionModelRegistries();
      res.json(state);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete('/api/model-providers/providers/:provider', (req, res) => {
    try {
      const { provider } = req.params;
      if (!provider || provider.trim().length === 0) {
        res.status(400).json({ error: 'provider required' });
        return;
      }

      const result = removeModelProvider(getCurrentProfileFn(), provider);
      materializeWebProfileFn(getCurrentProfileFn());
      refreshAllLiveSessionModelRegistries();
      res.json(result.state);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/model-providers/providers/:provider/models', (req, res) => {
    try {
      const { provider } = req.params;
      const {
        modelId,
        name,
        api,
        baseUrl,
        reasoning,
        input,
        contextWindow,
        maxTokens,
        headers,
        cost,
        compat,
      } = req.body as {
        modelId?: string;
        name?: string;
        api?: string;
        baseUrl?: string;
        reasoning?: boolean;
        input?: Array<'text' | 'image'>;
        contextWindow?: number;
        maxTokens?: number;
        headers?: Record<string, string>;
        cost?: {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
        };
        compat?: Record<string, unknown>;
      };

      if (!provider || provider.trim().length === 0) {
        res.status(400).json({ error: 'provider required' });
        return;
      }

      if (typeof modelId !== 'string' || modelId.trim().length === 0) {
        res.status(400).json({ error: 'modelId required' });
        return;
      }

      const state = upsertModelProviderModel(getCurrentProfileFn(), provider, modelId, {
        name,
        api: api as Parameters<typeof upsertModelProviderModel>[3]['api'],
        baseUrl,
        reasoning,
        input,
        contextWindow,
        maxTokens,
        headers,
        cost,
        compat,
      });
      materializeWebProfileFn(getCurrentProfileFn());
      refreshAllLiveSessionModelRegistries();
      res.json(state);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete('/api/model-providers/providers/:provider/models/:modelId', (req, res) => {
    try {
      const { provider, modelId } = req.params;
      if (!provider || provider.trim().length === 0) {
        res.status(400).json({ error: 'provider required' });
        return;
      }

      if (!modelId || modelId.trim().length === 0) {
        res.status(400).json({ error: 'modelId required' });
        return;
      }

      const result = removeModelProviderModel(getCurrentProfileFn(), provider, modelId);
      materializeWebProfileFn(getCurrentProfileFn());
      refreshAllLiveSessionModelRegistries();
      res.json(result.state);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Provider Auth ─────────────────────────────────────────────────────────

  router.get('/api/provider-auth', (_req, res) => {
    try {
      res.json(readProviderAuthState(AUTH_FILE));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/provider-auth/openai-codex/usage', async (_req, res) => {
    try {
      res.json(await readCodexPlanUsage(AUTH_FILE));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({
        available: true,
        planType: null,
        fiveHour: null,
        weekly: null,
        credits: null,
        updatedAt: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.patch('/api/provider-auth/:provider/api-key', (req, res) => {
    try {
      const { provider } = req.params;
      const { apiKey } = req.body as { apiKey?: string };

      if (!provider || provider.trim().length === 0) {
        res.status(400).json({ error: 'provider required' });
        return;
      }

      if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        res.status(400).json({ error: 'apiKey required' });
        return;
      }

      const state = setProviderApiKey(AUTH_FILE, provider, apiKey);
      reloadAllLiveSessionAuth();
      res.json(state);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete('/api/provider-auth/:provider', (req, res) => {
    try {
      const { provider } = req.params;
      if (!provider || provider.trim().length === 0) {
        res.status(400).json({ error: 'provider required' });
        return;
      }

      const state = removeProviderCredential(AUTH_FILE, provider);
      reloadAllLiveSessionAuth();
      res.json(state);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/provider-auth/:provider/oauth/start', (req, res) => {
    try {
      const { provider } = req.params;
      const state = startProviderOAuthLogin(AUTH_FILE, provider);
      res.json(state);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/provider-auth/oauth/:loginId', (req, res) => {
    try {
      res.json(getProviderOAuthLoginState(req.params.loginId));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/provider-auth/oauth/:loginId/events', (req, res) => {
    try {
      const loginId = req.params.loginId;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const unsubscribe = subscribeProviderOAuthLogin(loginId, (login: { status: string }) => {
        res.write(`data: ${JSON.stringify(login)}\n\n`);
        if (login.status === 'completed' || login.status === 'failed') {
          clearTimeout(timeoutId);
          unsubscribe();
          res.end();
        }
      });

      // Timeout after 10 minutes
      const timeoutId = setTimeout(() => {
        unsubscribe();
        res.end();
      }, 10 * 60 * 1000);

      req.on('close', () => {
        unsubscribe();
      });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/provider-auth/oauth/:loginId/input', (req, res) => {
    try {
      const { loginId } = req.params;
      const { input } = req.body as { input?: string };
      const state = submitProviderOAuthLoginInput(loginId, input ?? '');
      res.json(state);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/provider-auth/oauth/:loginId/cancel', (req, res) => {
    try {
      const { loginId } = req.params;

      if (!loginId || loginId.trim().length === 0) {
        res.status(400).json({ error: 'loginId required' });
        return;
      }

      const login = cancelProviderOAuthLogin(req.params.loginId);
      res.json(login);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });
}

