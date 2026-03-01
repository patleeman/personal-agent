import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConfig, MemoryModuleConfig } from '../config.js';
import type { DaemonEvent, DaemonPaths, EventPayload } from '../types.js';
import type { DaemonModuleContext } from './types.js';
import { createMemoryModule } from './memory.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createTestEvent(type: string, payload: EventPayload = {}): DaemonEvent {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    version: 1,
    type,
    source: 'test',
    timestamp: new Date().toISOString(),
    payload,
  };
}

function createMemoryConfig(sessionSource: string, summaryDir: string): MemoryModuleConfig {
  return {
    enabled: true,
    sessionSource,
    summaryDir,
    scanIntervalMinutes: 1,
    inactiveAfterMinutes: 30,
    retentionDays: 30,
    collections: [],
    summarization: {
      provider: 'pi-sdk',
      maxTurns: 50,
      maxCharsPerTurn: 400,
      maxTranscriptChars: 4_000,
    },
    qmd: {
      index: 'test',
      updateDebounceSeconds: 60,
      embedDebounceSeconds: 300,
    },
  };
}

interface PublishedEvent {
  type: string;
  payload?: EventPayload;
}

function createModuleContext(memoryConfig: MemoryModuleConfig): {
  context: DaemonModuleContext;
  published: PublishedEvent[];
} {
  const root = createTempDir('memory-module-daemon-');

  const daemonConfig: DaemonConfig = {
    logLevel: 'error',
    queue: { maxDepth: 100 },
    ipc: {},
    modules: {
      memory: memoryConfig,
      maintenance: {
        enabled: false,
        cleanupIntervalMinutes: 60,
      },
    },
  };

  const daemonPaths: DaemonPaths = {
    root,
    socketPath: join(root, 'daemon.sock'),
    pidFile: join(root, 'daemon.pid'),
    logDir: join(root, 'logs'),
    logFile: join(root, 'logs', 'daemon.log'),
  };

  const published: PublishedEvent[] = [];

  const context: DaemonModuleContext = {
    config: daemonConfig,
    paths: daemonPaths,
    publish: (type, payload) => {
      published.push({ type, payload });
      return true;
    },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };

  return { context, published };
}

function writeSessionFile(path: string, cwd: string, id = 'session-1'): void {
  const lines = [
    JSON.stringify({
      type: 'session',
      version: 3,
      id,
      timestamp: '2026-02-28T19:00:00.000Z',
      cwd,
    }),
    JSON.stringify({
      type: 'message',
      id: 'msg-1',
      parentId: null,
      timestamp: '2026-02-28T19:01:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Please update the memory docs.' }],
      },
    }),
    JSON.stringify({
      type: 'message',
      id: 'msg-2',
      parentId: 'msg-1',
      timestamp: '2026-02-28T19:02:00.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Updated docs and validated build/lint.' },
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'edit',
            arguments: { path: 'docs/memory.md' },
          },
        ],
      },
    }),
  ];

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join('\n')}\n`);
}

function createFakeQmdBinary(argsLogPath: string): string {
  const binDir = createTempDir('memory-qmd-bin-');
  const qmdPath = join(binDir, 'qmd');

  writeFileSync(
    qmdPath,
    `#!/usr/bin/env bash
printf '%s\n' "$@" >> "${argsLogPath}"
exit 0
`,
  );

  chmodSync(qmdPath, 0o755);
  return binDir;
}

describe('memory module scanner flow', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('summarizes only concluded sessions during scan', async () => {
    const sessionSource = createTempDir('memory-sessions-');
    const summaryDir = createTempDir('memory-summaries-');
    const sessionFile = join(sessionSource, 'workspace-a', 'session-1.jsonl');

    writeSessionFile(sessionFile, '/Users/patrick/workingdir/personal-agent', 'session-1');

    const now = new Date('2026-03-01T12:00:00.000Z');
    const old = new Date('2026-03-01T10:00:00.000Z');
    utimesSync(sessionFile, old, old);

    const summarizeSession = vi.fn(async () => '# Session session-1\n\n- summarized\n');

    const config = createMemoryConfig(sessionSource, summaryDir);
    const { context, published } = createModuleContext(config);

    const module = createMemoryModule(config, {
      now: () => now,
      summarizeSession,
    });

    await module.start(context);

    const summaryPath = join(summaryDir, 'users-patrick-workingdir-personal-agent', 'session-1.md');

    expect(summarizeSession).toHaveBeenCalledTimes(1);
    expect(existsSync(summaryPath)).toBe(true);
    expect(readFileSync(summaryPath, 'utf-8')).toContain('- summarized');
    expect(published.some((event) => event.type === 'memory.summary.updated')).toBe(true);
    expect(published.some((event) => event.type === 'memory.scan.completed')).toBe(true);
  });

  it('uses session hints but waits for inactivity before summarizing', async () => {
    const sessionSource = createTempDir('memory-sessions-');
    const summaryDir = createTempDir('memory-summaries-');
    const sessionFile = join(sessionSource, 'workspace-b', 'active.jsonl');

    writeSessionFile(sessionFile, '/Users/patrick/workingdir/active-repo', 'active-session');

    const now = new Date('2026-03-01T12:00:00.000Z');
    utimesSync(sessionFile, now, now);

    const summarizeSession = vi.fn(async () => '# Session active-session\n\n- summarized\n');

    const config = createMemoryConfig(sessionSource, summaryDir);
    config.inactiveAfterMinutes = 10;

    const { context } = createModuleContext(config);

    const module = createMemoryModule(config, {
      now: () => now,
      summarizeSession,
    });

    await module.start(context);
    expect(summarizeSession).toHaveBeenCalledTimes(0);

    await module.handleEvent(
      createTestEvent('session.closed', {
        sessionFile,
        cwd: '/Users/patrick/workingdir/active-repo',
      }),
      context,
    );

    const hintedStatus = module.getStatus?.() as { pendingHintedSessions?: number };
    expect(hintedStatus.pendingHintedSessions).toBe(1);

    const old = new Date('2026-03-01T10:00:00.000Z');
    utimesSync(sessionFile, old, old);

    await module.handleEvent(createTestEvent('timer.memory.session.scan', { timer: 'memory-session-scan' }), context);

    expect(summarizeSession).toHaveBeenCalledTimes(1);

    const summaryPath = join(summaryDir, 'users-patrick-workingdir-active-repo', 'active-session.md');
    expect(existsSync(summaryPath)).toBe(true);

    const status = module.getStatus?.() as { pendingHintedSessions?: number };
    expect(status.pendingHintedSessions).toBe(0);
  });

  it('runs qmd reconcile update even when memory state is clean', async () => {
    const sessionSource = createTempDir('memory-sessions-');
    const summaryDir = createTempDir('memory-summaries-');
    const argsLogPath = join(createTempDir('memory-qmd-log-'), 'qmd-args.log');
    const qmdBinDir = createFakeQmdBinary(argsLogPath);

    const originalPath = process.env.PATH;
    process.env.PATH = `${qmdBinDir}:${process.env.PATH}`;

    try {
      const now = new Date('2026-03-01T12:00:00.000Z');
      const summarizeSession = vi.fn(async () => '# should-not-run');

      const config = createMemoryConfig(sessionSource, summaryDir);
      const { context } = createModuleContext(config);

      const module = createMemoryModule(config, {
        now: () => now,
        summarizeSession,
      });

      await module.start(context);

      const statusBefore = module.getStatus?.() as { dirty?: boolean };
      expect(statusBefore.dirty).toBe(false);

      await module.handleEvent(
        createTestEvent('timer.memory.qmd.reconcile', {
          timer: 'memory-qmd-reconcile',
        }),
        context,
      );

      const argsLog = readFileSync(argsLogPath, 'utf-8');
      expect(argsLog).toContain('update');
      expect(argsLog).toContain('--index');
      expect(argsLog).toContain('test');

      const status = module.getStatus?.() as {
        dirty?: boolean;
        lastQmdUpdateAt?: string;
        lastQmdReconcileAt?: string;
      };

      expect(status.dirty).toBe(false);
      expect(status.lastQmdUpdateAt).toBeDefined();
      expect(status.lastQmdReconcileAt).toBeDefined();
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('removes expired summaries during retention cleanup', async () => {
    const sessionSource = createTempDir('memory-sessions-');
    const summaryDir = createTempDir('memory-summaries-');
    const staleSummaryDir = join(summaryDir, 'workspace-old');
    const staleSummaryPath = join(staleSummaryDir, 'old-session.md');

    mkdirSync(staleSummaryDir, { recursive: true });
    writeFileSync(staleSummaryPath, '# stale\n');

    const now = new Date('2026-03-10T12:00:00.000Z');
    const old = new Date('2026-03-01T12:00:00.000Z');
    utimesSync(staleSummaryPath, old, old);

    const summarizeSession = vi.fn(async () => '# should-not-run');

    const config = createMemoryConfig(sessionSource, summaryDir);
    config.retentionDays = 1;

    const { context } = createModuleContext(config);

    const module = createMemoryModule(config, {
      now: () => now,
      summarizeSession,
    });

    await module.start(context);

    expect(existsSync(staleSummaryPath)).toBe(false);
    expect(summarizeSession).toHaveBeenCalledTimes(0);

    const status = module.getStatus?.() as { deletedSummaries?: number };
    expect((status.deletedSummaries ?? 0) > 0).toBe(true);
  });
});
