import type { Express, Request, Response } from 'express';

import { getCompanionUrl } from '../daemon/client.js';
import { logError } from '../middleware/index.js';

const COMPANION_PROXY_ROUTE = '/companion/v1/*';

function buildProxyHeaders(req: Request): HeadersInit {
  const headers: Record<string, string> = {};
  const contentType = req.get('content-type');
  if (contentType) {
    headers['content-type'] = contentType;
  }
  return headers;
}

async function handleCompanionProxyRequest(req: Request, res: Response): Promise<void> {
  try {
    const companionUrl = await getCompanionUrl();
    if (!companionUrl) {
      res.status(503).json({ error: 'Companion server is not available.' });
      return;
    }

    const upstreamUrl = new URL(req.originalUrl, companionUrl);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined;
    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers: buildProxyHeaders(req),
      body: hasBody ? JSON.stringify(req.body) : undefined,
    });

    const contentType = upstreamResponse.headers.get('content-type');
    if (contentType) {
      res.setHeader('content-type', contentType);
    }

    res.status(upstreamResponse.status).send(await upstreamResponse.arrayBuffer());
  } catch (error) {
    logError('companion proxy request failed', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

export function registerCompanionProxyRoutes(router: Pick<Express, 'get' | 'post' | 'patch' | 'delete'>): void {
  router.get(COMPANION_PROXY_ROUTE, handleCompanionProxyRequest);
  router.post(COMPANION_PROXY_ROUTE, handleCompanionProxyRequest);
  router.patch(COMPANION_PROXY_ROUTE, handleCompanionProxyRequest);
  router.delete(COMPANION_PROXY_ROUTE, handleCompanionProxyRequest);
}
