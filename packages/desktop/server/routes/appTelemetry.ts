import {
  exportAppTelemetryLogBundle,
  listAppTelemetryLogFiles,
  maintainAppTelemetryDb,
  maintainTraceDb,
  resolveAppTelemetryLogDir,
} from '@personal-agent/core';
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

function readSinceParam(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function registerAppTelemetryRoutes(router: Pick<Express, 'get' | 'post'>): void {
  router.get('/api/telemetry/logs', (_req, res) => {
    const files = listAppTelemetryLogFiles();
    res.json({
      logDir: resolveAppTelemetryLogDir(),
      fileCount: files.length,
      sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      files,
    });
  });

  router.post('/api/telemetry/logs/export', (req, res) => {
    const result = exportAppTelemetryLogBundle({ since: readSinceParam(req.body?.since) });
    res.status(201).json(result);
  });

  router.post('/api/telemetry/db/maintenance', (_req, res) => {
    res.json({ appTelemetry: maintainAppTelemetryDb(), trace: maintainTraceDb() });
  });

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
