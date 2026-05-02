import type { NextFunction, Request, Response } from 'express';

export type WebLogLevel = 'info' | 'warn' | 'error';

function formatValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }

  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatFields(fields: Record<string, unknown> | undefined): string {
  if (!fields) {
    return '';
  }

  const entries = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`);

  return entries.length > 0 ? ` ${entries.join(' ')}` : '';
}

function emit(level: WebLogLevel, message: string, fields?: Record<string, unknown>): void {
  const line = `[${new Date().toISOString()}] [web] [${level}] ${message}${formatFields(fields)}`;

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}

export function logInfo(message: string, fields?: Record<string, unknown>): void {
  emit('info', message, fields);
}

export function logWarn(message: string, fields?: Record<string, unknown>): void {
  emit('warn', message, fields);
}

export function logError(message: string, fields?: Record<string, unknown>): void {
  emit('error', message, fields);
}

function normalizeDurationMs(start: bigint): number {
  const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  return Math.round(durationMs * 10) / 10;
}

function shouldLogRequest(req: Request): boolean {
  return req.path.startsWith('/api/');
}

export function webRequestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!shouldLogRequest(req)) {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const statusCode = res.statusCode;
    const durationMs = normalizeDurationMs(startedAt);
    const fields = {
      method: req.method,
      path: req.originalUrl || req.url,
      status: statusCode,
      durationMs,
      contentLength: res.getHeader('content-length'),
    };

    if (statusCode >= 500) {
      logError('request failed', fields);
      return;
    }

    if (statusCode >= 400) {
      logWarn('request completed', fields);
      return;
    }

    logInfo('request completed', fields);
  });

  next();
}

let processLoggingInstalled = false;

export function installProcessLogging(): void {
  if (processLoggingInstalled) {
    return;
  }

  processLoggingInstalled = true;

  process.on('uncaughtExceptionMonitor', (error) => {
    logError('uncaught exception', {
      message: error.message,
      stack: error.stack,
    });
  });

  process.on('unhandledRejection', (reason) => {
    logError('unhandled rejection', {
      reason:
        reason instanceof Error
          ? {
              message: reason.message,
              stack: reason.stack,
            }
          : reason,
    });
  });

  process.on('SIGTERM', () => {
    logInfo('received SIGTERM');
  });

  process.on('SIGINT', () => {
    logInfo('received SIGINT');
  });
}
