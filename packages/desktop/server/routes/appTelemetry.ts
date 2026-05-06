import type { Express } from 'express';

import { persistAppTelemetryEvent } from '../traces/appTelemetry.js';

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readMetadata(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function registerAppTelemetryRoutes(router: Pick<Express, 'post'>): void {
  router.post('/api/telemetry/event', (req, res) => {
    const category = readString(req.body?.category);
    const name = readString(req.body?.name);
    if (!category || !name) {
      res.status(400).json({ error: 'category and name are required' });
      return;
    }

    persistAppTelemetryEvent({
      source: 'renderer',
      category,
      name,
      sessionId: readString(req.body?.sessionId),
      route: readString(req.body?.route),
      status: Number.isInteger(req.body?.status) ? req.body.status : undefined,
      durationMs: readNumber(req.body?.durationMs),
      count: Number.isInteger(req.body?.count) ? req.body.count : undefined,
      value: readNumber(req.body?.value),
      metadata: {
        ...readMetadata(req.body?.metadata),
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(202).json({ ok: true });
  });
}
