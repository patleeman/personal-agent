import type { Express, Request, Response } from 'express';

import {
  attachGatewayConversation,
  detachGatewayConversation,
  ensureGatewayConnection,
  type GatewayProviderId,
  type GatewayStatus,
  readGatewayState,
  updateGatewayConnectionStatus,
} from '../gateways/gatewayState.js';
import { logError } from '../middleware/index.js';
import { invalidateAppTopics } from '../shared/appEvents.js';
import type { ServerRouteContext } from './context.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for gateway routes');
};
let getStateRootFn: () => string = () => {
  throw new Error('getStateRoot not initialized for gateway routes');
};

function initializeGatewayRoutesContext(context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getStateRoot'>): void {
  getCurrentProfileFn = context.getCurrentProfile;
  getStateRootFn = context.getStateRoot;
}

function currentGatewayContext(): { stateRoot: string; profile: string } {
  return { stateRoot: getStateRootFn(), profile: getCurrentProfileFn() };
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

export function registerGatewayRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch' | 'delete'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getStateRoot'>,
): void {
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
      res.json(updateGatewayConnectionStatus({ ...currentGatewayContext(), provider, status, enabled, statusMessage }));
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
