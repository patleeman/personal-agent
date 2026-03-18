import { existsSync, mkdtempSync, writeFileSync, utimesSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConfig } from '../config.js';
import type { DaemonEvent, DaemonPaths, EventPayload } from '../types.js';
import type { DaemonModuleContext } from './types.js';
import { createMaintenanceModule } from './maintenance.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

interface PublishedEvent {
  type: string;
  payload?: EventPayload;
}

function createContext(logDir: string, warn = vi.fn()): {
  context: DaemonModuleContext;
  published: PublishedEvent[];
  warn: ReturnType<typeof vi.fn>;
} {
  const daemonConfig: DaemonConfig = {
    logLevel: 'error',
    queue: { maxDepth: 100 },
    ipc: {},
    modules: {
      maintenance: {
        enabled: true,
        cleanupIntervalMinutes: 60,
      },
      tasks: {
        enabled: false,
        taskDir: join(logDir, 'tasks'),
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
    },
  };

  const paths: DaemonPaths = {
    stateRoot: dirname(logDir),
    root: dirname(logDir),
    socketPath: join(logDir, 'daemon.sock'),
    pidFile: join(logDir, 'daemon.pid'),
    logDir,
    logFile: join(logDir, 'daemon.log'),
  };

  const published: PublishedEvent[] = [];

  return {
    context: {
      config: daemonConfig,
      paths,
      publish: (type, payload) => {
        published.push({ type, payload });
        return true;
      },
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn,
        error: () => undefined,
      },
    },
    published,
    warn,
  };
}

function dirname(path: string): string {
  const separatorIndex = path.lastIndexOf('/');
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : path;
}

function createEvent(type: string): DaemonEvent {
  return {
    id: `evt_${Math.random().toString(16).slice(2)}`,
    version: 1,
    type,
    source: 'test',
    timestamp: new Date().toISOString(),
    payload: {},
  };
}

describe('maintenance module', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('enforces a minimum cleanup timer interval of 60 seconds', () => {
    const module = createMaintenanceModule({
      enabled: true,
      cleanupIntervalMinutes: 0,
    });

    expect(module.timers).toHaveLength(1);
    expect(module.timers[0]?.intervalMs).toBe(60_000);
  });

  it('cleans stale .log files and publishes completion event', async () => {
    const logDir = createTempDir('maintenance-logs-');
    const staleLog = join(logDir, 'stale.log');
    const freshLog = join(logDir, 'fresh.log');
    const ignoredFile = join(logDir, 'notes.txt');

    writeFileSync(staleLog, 'old log');
    writeFileSync(freshLog, 'new log');
    writeFileSync(ignoredFile, 'not a log');

    const eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000);
    const now = new Date();
    utimesSync(staleLog, new Date(eightDaysAgo), new Date(eightDaysAgo));
    utimesSync(freshLog, now, now);

    const module = createMaintenanceModule({
      enabled: true,
      cleanupIntervalMinutes: 30,
    });

    const { context, published } = createContext(logDir);

    await module.start(context);
    await module.handleEvent(createEvent('timer.maintenance.cleanup'), context);

    expect(existsSync(staleLog)).toBe(false);
    expect(existsSync(freshLog)).toBe(true);
    expect(existsSync(ignoredFile)).toBe(true);

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: 'maintenance.cleanup.completed',
      payload: {
        cleaned: 1,
      },
    });

    const status = module.getStatus?.();
    expect(status).toMatchObject({
      cleanedFiles: 1,
      lastError: undefined,
    });
    expect(typeof status?.lastRunAt).toBe('string');
  });

  it('ignores unrelated events', async () => {
    const logDir = createTempDir('maintenance-ignore-');
    const module = createMaintenanceModule({
      enabled: true,
      cleanupIntervalMinutes: 10,
    });

    const { context, published } = createContext(logDir);

    await module.handleEvent(createEvent('timer.tasks.tick'), context);

    expect(published).toHaveLength(0);
    expect(module.getStatus?.()).toMatchObject({
      cleanedFiles: 0,
      lastRunAt: undefined,
      lastError: undefined,
    });
  });

  it('records cleanup errors and logs a warning', async () => {
    const missingLogDir = join(createTempDir('maintenance-missing-'), 'logs-do-not-exist');
    const module = createMaintenanceModule({
      enabled: true,
      cleanupIntervalMinutes: 10,
    });

    const warn = vi.fn();
    const { context, published } = createContext(missingLogDir, warn);

    await module.handleEvent(createEvent('timer.maintenance.cleanup'), context);

    expect(published).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('maintenance cleanup failed');

    const status = module.getStatus?.();
    expect(typeof status?.lastError).toBe('string');
    expect(String(status?.lastError)).toContain('ENOENT');
    expect(status?.cleanedFiles).toBe(0);
  });
});
