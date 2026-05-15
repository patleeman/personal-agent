import type { Express, Request, Response } from 'express';

import { getCompanionUrl } from '../daemon/client.js';
import { logError } from '../middleware/index.js';

const COMPANION_PROXY_ROUTE = '/api/companion/v1/*';
const COMPANION_UNAVAILABLE_ERROR = 'Companion server is not available.';
const COMPANION_FETCH_RETRY_DELAYS_MS = [100, 250, 500, 1000, 1500, 2500] as const;

function buildProxyHeaders(req: Request): HeadersInit {
  const headers: Record<string, string> = {};
  const contentType = req.get('content-type');
  if (contentType) {
    headers['content-type'] = contentType;
  }
  return headers;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientCompanionFetchError(error: unknown): boolean {
  return error instanceof TypeError;
}

async function fetchCompanionWithStartupRetry(url: URL, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      const retryDelay = COMPANION_FETCH_RETRY_DELAYS_MS[attempt];
      if (!isTransientCompanionFetchError(error) || retryDelay === undefined) {
        throw error;
      }
      await delay(retryDelay);
    }
  }
}

async function handleCompanionProxyRequest(req: Request, res: Response): Promise<void> {
  try {
    const companionUrl = await getCompanionUrl();
    if (!companionUrl) {
      res.status(503).json({ error: COMPANION_UNAVAILABLE_ERROR });
      return;
    }

    const upstreamPath = req.originalUrl.replace(/^\/api\/companion(?=\/v1(?:\/|$))/, '/companion');
    const upstreamUrl = new URL(upstreamPath, companionUrl);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined;
    const upstreamResponse = await fetchCompanionWithStartupRetry(upstreamUrl, {
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
    if (isTransientCompanionFetchError(error)) {
      res.status(503).json({ error: COMPANION_UNAVAILABLE_ERROR });
      return;
    }

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
