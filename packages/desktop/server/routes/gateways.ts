import { authenticateMcpServerDirect, clearMcpServerAuthDirect, hasStoredMcpServerTokens } from '@personal-agent/core';
import type { Express, Request, Response } from 'express';

import {
  abortLiveSessionCapability,
  compactLiveSessionCapability,
  createLiveSessionCapability,
  submitLiveSessionPromptCapability,
} from '../conversations/liveSessionCapability.js';
import { registerLiveSessionLifecycleHandler } from '../conversations/liveSessionLifecycle.js';
import {
  getAvailableModelObjects,
  getLiveSessions,
  renameSession,
  updateLiveSessionModelPreferences,
} from '../conversations/liveSessions.js';
import { readSessionBlocks } from '../conversations/sessions.js';
import {
  attachGatewayConversation,
  detachGatewayConversation,
  ensureGatewayConnection,
  type GatewayProviderId,
  type GatewayStatus,
  readGatewayState,
  updateGatewayConnectionStatus,
  upsertGatewayChatTarget,
} from '../gateways/gatewayState.js';
import { SLACK_MCP_SERVER_CONFIG, SlackMcpGatewayRuntime } from '../gateways/slackMcpGateway.js';
import { readTelegramBotToken, removeTelegramBotToken, writeTelegramBotToken } from '../gateways/telegramAuth.js';
import { TelegramGatewayRuntime } from '../gateways/telegramGateway.js';
import { logError } from '../middleware/index.js';
import { invalidateAppTopics, publishAppEvent } from '../shared/appEvents.js';
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
let slackMcpRuntime: SlackMcpGatewayRuntime | null = null;
let lifecycleRegistered = false;
const lastTelegramDeliveryByConversation = new Map<string, string>();
const lastSlackDeliveryByConversation = new Map<string, string>();

function initializeGatewayRoutesContext(context: ServerRouteContext): void {
  getCurrentProfileFn = context.getCurrentProfile;
  getStateRootFn = context.getStateRoot;
  getAuthFileFn = context.getAuthFile;
  routeContext = context;
  if (!lifecycleRegistered) {
    lifecycleRegistered = true;
    registerLiveSessionLifecycleHandler(async (event) => {
      if (event.trigger !== 'turn_end') return;
      const text = readLatestAssistantText(event.conversationId);
      if (text && lastTelegramDeliveryByConversation.get(event.conversationId) !== text) {
        const delivered = await ensureTelegramRuntime().deliverAssistantReply({ conversationId: event.conversationId, text });
        if (delivered) {
          lastTelegramDeliveryByConversation.set(event.conversationId, text);
        }
      }
      const slackText = text && lastSlackDeliveryByConversation.get(event.conversationId) !== text ? text : null;
      const slackDelivered = await ensureSlackMcpRuntime().handleTurnEnd(event.conversationId, slackText);
      if (slackDelivered && text) {
        lastSlackDeliveryByConversation.set(event.conversationId, text);
      }
    });
  }
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
    notifyNewConversation: (conversationId) => {
      publishAppEvent({ type: 'open_session', sessionId: conversationId });
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

function ensureSlackMcpRuntime(): SlackMcpGatewayRuntime {
  if (!routeContext) {
    throw new Error('Gateway routes are not initialized');
  }
  if (slackMcpRuntime) {
    return slackMcpRuntime;
  }
  const context = routeContext;
  slackMcpRuntime = new SlackMcpGatewayRuntime({
    stateRoot: context.getStateRoot(),
    profile: context.getCurrentProfile(),
    createConversation: async (input) => {
      const created = await createLiveSessionCapability({}, liveSessionContext(context));
      renameSession(created.id, input.title);
      return { id: created.id };
    },
    notifyNewConversation: (conversationId) => {
      publishAppEvent({ type: 'open_session', sessionId: conversationId });
    },
    submitPrompt: async (input) =>
      submitLiveSessionPromptCapability(
        { conversationId: input.conversationId, text: input.text, ...(input.behavior ? { behavior: input.behavior } : {}) },
        liveSessionContext(context),
      ),
    abortConversation: async (conversationId) => {
      await abortLiveSessionCapability({ conversationId });
    },
    compactConversation: async (conversationId) => {
      await compactLiveSessionCapability({ conversationId });
    },
    renameConversation: (conversationId, title) => renameSession(conversationId, title),
    getCurrentModel: () => null,
    setModel: async (conversationId, model) => {
      await updateLiveSessionModelPreferences(conversationId, { model }, getAvailableModelObjects());
    },
    isConversationBusy: (conversationId) => getLiveSessions().some((session) => session.id === conversationId && session.isStreaming),
  });
  return slackMcpRuntime;
}

function readProvider(value: unknown): GatewayProviderId | null {
  return value === 'telegram' || value === 'slack_mcp' ? value : null;
}

function readStatus(value: unknown): GatewayStatus | null {
  return value === 'needs_config' || value === 'connected' || value === 'active' || value === 'paused' || value === 'needs_attention'
    ? value
    : null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readLatestAssistantText(conversationId: string): string | null {
  const detail = readSessionBlocks(conversationId, { tailBlocks: 20 });
  const block = [...(detail?.blocks ?? [])].reverse().find((candidate) => candidate.type === 'text');
  return block && block.type === 'text' && block.text.trim() ? block.text.trim() : null;
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

  const initialTelegramState = readGatewayState(currentGatewayContext()).connections.find(
    (connection) => connection.provider === 'telegram',
  );
  if (initialTelegramState?.enabled && readTelegramBotToken(getAuthFileFn())) {
    ensureTelegramRuntime().start();
  }
  const initialSlackState = readGatewayState(currentGatewayContext()).connections.find((connection) => connection.provider === 'slack_mcp');
  if (initialSlackState?.enabled) {
    ensureSlackMcpRuntime().start();
  }

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
        res.status(400).json({ error: 'provider must be telegram or slack_mcp' });
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
      } else if (provider === 'slack_mcp') {
        if (enabled === false || status === 'paused') {
          ensureSlackMcpRuntime().stop();
        } else {
          ensureSlackMcpRuntime().start();
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

  router.post('/api/gateways/telegram/chat', (req: Request, res: Response) => {
    try {
      const chatId = readOptionalString(req.body?.chatId);
      if (!chatId) {
        res.status(400).json({ error: 'chatId required' });
        return;
      }
      ensureGatewayConnection({ ...currentGatewayContext(), provider: 'telegram' });
      upsertGatewayChatTarget({
        ...currentGatewayContext(),
        provider: 'telegram',
        externalChatId: chatId,
        externalChatLabel: readOptionalString(req.body?.chatLabel) ?? chatId,
        conversationId: '',
        conversationTitle: '',
        repliesEnabled: false,
      });
      res.json(readGatewayState(currentGatewayContext()));
    } catch (err) {
      handleGatewayError(res, err);
    }
  });

  router.get('/api/gateways/slack-mcp/auth', (_req, res) => {
    try {
      res.json({ authenticated: hasStoredMcpServerTokens(SLACK_MCP_SERVER_CONFIG) });
    } catch (err) {
      handleGatewayError(res, err);
    }
  });

  router.post('/api/gateways/slack-mcp/auth', async (_req, res) => {
    try {
      const result = await authenticateMcpServerDirect(SLACK_MCP_SERVER_CONFIG, { timeoutMs: 120_000 });
      if (result.error) {
        res.status(500).json({ error: result.error });
        return;
      }
      ensureGatewayConnection({ ...currentGatewayContext(), provider: 'slack_mcp' });
      const state = updateGatewayConnectionStatus({
        ...currentGatewayContext(),
        provider: 'slack_mcp',
        status: 'connected',
        enabled: true,
      });
      res.json({ authenticated: true, state });
    } catch (err) {
      handleGatewayError(res, err);
    }
  });

  router.delete('/api/gateways/slack-mcp/auth', async (_req, res) => {
    try {
      await clearMcpServerAuthDirect(SLACK_MCP_SERVER_CONFIG);
      ensureSlackMcpRuntime().stop();
      const state = updateGatewayConnectionStatus({
        ...currentGatewayContext(),
        provider: 'slack_mcp',
        status: 'needs_config',
        enabled: false,
        statusMessage: 'Slack disconnected',
      });
      res.json({ authenticated: false, state });
    } catch (err) {
      handleGatewayError(res, err);
    }
  });

  router.get('/api/gateways/slack-mcp/channels', async (req: Request, res: Response) => {
    try {
      const query = readOptionalString(req.query.query);
      if (!query) {
        res.status(400).json({ error: 'query required' });
        return;
      }
      res.json({ channels: await ensureSlackMcpRuntime().searchChannels(query) });
    } catch (err) {
      handleGatewayError(res, err);
    }
  });

  // Save the channel target (like Telegram's /chat endpoint — no thread attached yet)
  router.post('/api/gateways/slack-mcp/channel', async (req: Request, res: Response) => {
    try {
      const channelId = readOptionalString(req.body?.channelId);
      if (!channelId) {
        res.status(400).json({ error: 'channelId required' });
        return;
      }
      ensureGatewayConnection({ ...currentGatewayContext(), provider: 'slack_mcp' });
      ensureSlackMcpRuntime().saveChannel({ channelId, channelLabel: readOptionalString(req.body?.channelLabel) });
      res.json(readGatewayState(currentGatewayContext()));
    } catch (err) {
      handleGatewayError(res, err);
    }
  });

  // Attach the saved channel to a specific conversation thread
  router.post('/api/gateways/slack-mcp/attach', async (req: Request, res: Response) => {
    try {
      const conversationId = readOptionalString(req.body?.conversationId);
      const externalChatId = readOptionalString(req.body?.externalChatId);
      if (!conversationId || !externalChatId) {
        res.status(400).json({ error: 'conversationId and externalChatId required' });
        return;
      }
      await ensureSlackMcpRuntime().attachChannelToConversation({
        conversationId,
        conversationTitle: readOptionalString(req.body?.conversationTitle) ?? conversationId,
        externalChatId,
        externalChatLabel: readOptionalString(req.body?.externalChatLabel),
      });
      invalidateAppTopics('sessions');
      res.json(readGatewayState(currentGatewayContext()));
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
