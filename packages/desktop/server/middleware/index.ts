/**
 * Web server middleware re-exports
 *
 * Re-exports middleware functions from their domain modules for use
 * in the main server and route modules.
 */

import type { Request, Response } from 'express';

// Security middleware
export {
  applyWebSecurityHeaders,
  createInMemoryRateLimit,
  enforceSameOriginUnsafeRequests,
  resolveRequestOrigin,
} from '../shared/webSecurity.js';

import { logInfo } from '../shared/logging.js';

// Logging middleware
export { installProcessLogging, logError, logInfo, logWarn, webRequestLoggingMiddleware } from '../shared/logging.js';

export interface ServerTimingMetric {
  name: string;
  durationMs: number;
  description?: string;
}

function formatServerTimingMetric(metric: ServerTimingMetric): string {
  const dur =
    Number.isFinite(metric.durationMs) && Math.abs(metric.durationMs) <= Number.MAX_SAFE_INTEGER ? Math.max(0, metric.durationMs) : 0;
  const parts = [`${metric.name};dur=${dur.toFixed(1)}`];
  if (metric.description) {
    parts.push(`desc="${metric.description.replace(/"/g, '')}"`);
  }
  return parts.join(';');
}

export function setServerTimingHeaders(res: Response, metrics: ServerTimingMetric[], meta?: Record<string, unknown>): void {
  if (metrics.length > 0) {
    res.setHeader('Server-Timing', metrics.map(formatServerTimingMetric).join(', '));
  }
  if (meta && res.locals) {
    res.locals.timingMeta = meta;
  }
}

export function logSlowConversationPerf(label: string, fields: Record<string, unknown>): void {
  const durationMs = typeof fields.durationMs === 'number' ? fields.durationMs : 0;
  if (!Number.isFinite(durationMs) || Math.abs(durationMs) > Number.MAX_SAFE_INTEGER || durationMs < 150) {
    return;
  }

  logInfo(label, fields);
}

export function writeSseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

export function readCookieValue(req: Request, cookieName: string): string {
  const cookie = req.headers.cookie;
  if (!cookie) {
    return '';
  }

  const parts = cookie.split(';');
  for (const part of parts) {
    const [name, value] = part.split('=');
    if (name?.trim() === cookieName) {
      return value?.trim() ?? '';
    }
  }

  return '';
}

// Session middleware
export { refreshAllLiveSessionModelRegistries, reloadAllLiveSessionAuth } from '../conversations/liveSessions.js';

// Settings persistence
export { persistSettingsWrite } from '../ui/settingsPersistence.js';

// App events
export { invalidateAppTopics } from '../shared/appEvents.js';
