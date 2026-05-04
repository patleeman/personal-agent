import type { Express, Request, Response } from 'express';

import {
  compactLiveSessionCapability,
  createLiveSessionCapability,
  submitLiveSessionPromptCapability,
} from '../conversations/liveSessionCapability.js';
import { getAvailableModelObjects, renameSession, updateLiveSessionModelPreferences } from '../conversations/liveSessions.js';
import {
  attachGatewayConversation,
  detachGatewayConversation,
  ensureGatewayConnection,
  type GatewayProviderId,
  type GatewayStatus,
  readGatewayState,
  updateGatewayConnectionStatus,
} from '../gateways/gatewayState.js';
import { readTelegramBotToken, removeTelegramBotToken, writeTelegramBotToken } from '../gateways/telegramAuth.js';
import { TelegramGatewayRuntime } from '../gateways/telegramGateway.js';
import { logError } from '../middleware/index.js';
import { invalidateAppTopics } from '../shared/appEvents.js';
import type { ServerRouteContext } from './context.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for gateway routes');
};
let getStateRootFn: () => string = () => {
  throw new Error('getStateRoot not initialized for gateway routes');
};
let getAuthFileFn: () => string = () => {
  throw new Error('getAuthFile not initialized for gateway routes');
};
let routeContext: ServerRouteContext | null = null;
let telegramRuntime: TelegramGatewayRuntime | null = null;

function initializeGatewayRoutesContext(context: ServerRouteContext): void {
  getCurrentProfileFn = context.getCurrentProfile;
  getStateRootFn = context.getStateRoot;
  getAuthFileFn = context.getAuthFile;
  routeContext = context;
}

function currentGatewayContext(): { stateRoot: string; profile: string } {
  return { stateRoot: getStateRootFn(), profile: getCurrentProfileFn() };
}

function liveSessionContext(context: ServerRouteContext) {
  return {
    getCurrentProfile: context.getCurrentProfile,
    getRepoRoot: context.getRepoRoot,
    getDefaultWebCwd: context.getDefaultWebCwd,
    buildLiveSessionResourceOptions: context.buildLiveSessionResourceOptions,
    buildLiveSessionExtensionFactories: context.buildLiveSessionExtensionFactories,
    flushLiveDeferredResumes: context.flushLiveDeferredResumes,
    listTasksForCurrentProfile: context.listTasksForCurrentProfile,
    listMemoryDocs: context.listMemoryDocs,
  };
}

function ensureTelegramRuntime(): TelegramGatewayRuntime {
  if (!routeContext) {
    throw new Error('Gateway routes are not initialized');
  }
  if (telegramRuntime) {
    return telegramRuntime;
  }
  const context = routeContext;
  telegramRuntime = new TelegramGatewayRuntime({
    stateRoot: context.getStateRoot(),
    profile: context.getCurrentProfile(),
    authFile: context.getAuthFile(),
    readBotToken: () => readTelegramBotToken(context.getAuthFile()),
    createConversation: async (input) => {
      const created = await createLiveSessionCapability({}, liveSessionContext(context));
      renameSession(created.id, input.title);
      return { id: created.id };
    },
    submitPrompt: async (input) => {
      await submitLiveSessionPromptCapability(
        { conversationId: input.conversationId, text: input.text, images: input.images },
        liveSessionContext(context),
      );
    },
    renameConversation: (conversationId, title) => renameSession(conversationId, title),
    compactConversation: async (conversationId) => {
      await compactLiveSessionCapability({ conversationId });
    },
    archiveConversation: async (conversationId) => {
      detachGatewayConversation({
        stateRoot: context.getStateRoot(),
        profile: context.getCurrentProfile(),
        provider: 'telegram',
        conversationId,
      });
    },
    getCurrentModel: () => null,
    setModel: async (conversationId, model) => {
      await updateLiveSessionModelPreferences(conversationId, { model }, getAvailableModelObjects());
    },
  });
  return telegramRuntime;
}

function readProvider(value: unknown): GatewayProviderId | null {
  return value === 'telegram' ? value : null;
}

function readStatus(value: unknown): GatewayStatus | null {
  return value === 'needs_config' || value === 'connected' || value === 'active' || value === 'paused' || value === 'needs_attention'
    ? value
    : null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function handleGatewayError(res: Response, err: unknown): void {
  logError('request handler error', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({ error: String(err) });
}

export function registerGatewayRoutes(router: Pick<Express, 'get' | 'post' | 'patch' | 'delete'>, context: ServerRouteContext): void {
  initializeGatewayRoutesContext(context);

  router.get('/api/gateways', (_req, res) => {
    try {
      res.json(readGatewayState(currentGatewayContext()));
    } catch (err) {
      handleGatewayError(res, err);
    }
  });

  router.post('/api/gateways/connections', (req: Request, res: Response) => {
    try {
      const provider = readProvider(req.body?.provider);
      if (!provider) {
        res.status(400).json({ error: 'provider must be telegram' });
        return;
      }
      ensureGatewayConnection({ ...currentGatewayContext(), provider });
      invalidateAppTopics('sessions');
      res.json(readGatewayState(currentGatewayContext()));
    } catch (err) {
      handleGatewayError(res, err);
    }
  });

  router.patch('/api/gateways/connections/:provider', (req: Request, res: Response) => {
    try {
      const provider = readProvider(req.params.provider);
      const status = readStatus(req.body?.status);
      if (!provider || !status) {
        res.status(400).json({ error: 'provider and status are required' });
        return;
      }
      const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined;
      const statusMessage = readOptionalString(req.body?.statusMessage);
      const state = updateGatewayConnectionStatus({ ...currentGatewayContext(), provider, status, enabled, statusMessage });
      if (provider === 'telegram') {
        if (enabled === false || status === 'paused' || status === 'needs_attention') {
          ensureTelegramRuntime().stop();
        } else {
          ensureTelegramRuntime().start();
        }
      }
      res.json(state);
    } catch (err) {
      handleGatewayError(res, err);
    }
  });

  router.get('/api/gateways/telegram/token', (_req, res) => {
    try {
      res.json({ configured: readTelegramBotToken(getAuthFileFn()) !== null });
    } catch (err) {
      handleGatewayError(res, err);
    }
  });

  router.post('/api/gateways/telegram/token', (req: Request, res: Response) => {
    try {
      const token = readOptionalString(req.body?.token);
      if (!token) {
        res.status(400).json({ error: 'token required' });
        return;
      }
      writeTelegramBotToken(getAuthFileFn(), token);
      ensureGatewayConnection({ ...currentGatewayContext(), provider: 'telegram' });
      const state = updateGatewayConnectionStatus({ ...currentGatewayContext(), provider: 'telegram', status: 'active', enabled: true });
      ensureTelegramRuntime().start();
      res.json({ configured: true, state });
    } catch (err) {
      handleGatewayError(res, err);
    }
  });

  router.delete('/api/gateways/telegram/token', (_req, res) => {
    try {
      removeTelegramBotToken(getAuthFileFn());
      ensureTelegramRuntime().stop();
      const state = updateGatewayConnectionStatus({
        ...currentGatewayContext(),
        provider: 'telegram',
        status: 'needs_config',
        enabled: false,
        statusMessage: 'Telegram bot token removed',
      });
      res.json({ configured: false, state });
    } catch (err) {
      handleGatewayError(res, err);
    }
  });

  router.post('/api/gateways/bindings', (req: Request, res: Response) => {
    try {
      const provider = readProvider(req.body?.provider);
      const conversationId = readOptionalString(req.body?.conversationId);
      if (!provider || !conversationId) {
        res.status(400).json({ error: 'provider and conversationId are required' });
        return;
      }
      res.json(
        attachGatewayConversation({
          ...currentGatewayContext(),
          provider,
          conversationId,
          conversationTitle: readOptionalString(req.body?.conversationTitle),
          externalChatId: readOptionalString(req.body?.externalChatId),
          externalChatLabel: readOptionalString(req.body?.externalChatLabel),
        }),
      );
    } catch (err) {
      handleGatewayError(res, err);
    }
  });

  router.delete('/api/gateways/bindings/:conversationId', (req: Request, res: Response) => {
    try {
      const provider = readProvider(req.query.provider);
      res.json(
        detachGatewayConversation({
          ...currentGatewayContext(),
          provider: provider ?? undefined,
          conversationId: req.params.conversationId,
        }),
      );
    } catch (err) {
      handleGatewayError(res, err);
    }
  });
}
