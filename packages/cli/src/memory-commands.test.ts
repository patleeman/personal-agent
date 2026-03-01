import { chmodSync, mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './index.js';

vi.mock('@personal-agent/daemon', async () => {
  const actual = await vi.importActual<typeof import('@personal-agent/daemon')>('@personal-agent/daemon');

  return {
    ...actual,
    getDaemonStatus: vi.fn(async () => ({
      running: true,
      pid: 1234,
      startedAt: new Date().toISOString(),
      socketPath: '/tmp/personal-agentd.sock',
      queue: {
        maxDepth: 1000,
        currentDepth: 0,
        droppedEvents: 0,
        processedEvents: 0,
      },
      modules: [
        {
          name: 'memory',
          enabled: true,
          subscriptions: [],
          handledEvents: 0,
          detail: {
            failedSessions: 0,
            needsEmbedding: false,
            dirty: false,
          },
        },
      ],
    })),
  };
});

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createFakeQmdBinary(): string {
  const binDir = createTempDir('personal-agent-cli-qmd-bin-');
  const qmdScriptPath = join(binDir, 'qmd');

  writeFile(
    qmdScriptPath,
    `#!/usr/bin/env bash
if [ "$1" = "status" ]; then
  echo "Total: 2 files indexed"
  exit 0
fi

if [ "$1" = "ls" ]; then
  if [ -n "$2" ]; then
    echo "qmd://conversations/workspace-a/session-2.md"
    echo "qmd://conversations/workspace-b/session-3.md"
  else
    echo "conversations"
  fi
  exit 0
fi

echo "unsupported qmd command" >&2
exit 1
`,
  );

  chmodSync(qmdScriptPath, 0o755);
  return binDir;
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PI_SESSION_DIR: createTempDir('pi-session-'),
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('memory command', () => {
  it('shows latest summarized memories with pa memory head <count>', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const daemonConfigPath = join(createTempDir('personal-agent-cli-config-'), 'daemon.json');

    const summaryDir = join(stateRoot, 'memory', 'conversations');
    const olderSummary = join(summaryDir, 'workspace-a', 'session-1.md');
    const newerSummary = join(summaryDir, 'workspace-a', 'session-2.md');
    const newestSummary = join(summaryDir, 'workspace-b', 'session-3.md');

    writeFile(olderSummary, '# Session session-1\n\nOlder memory\n');
    writeFile(newerSummary, '# Session session-2\n\nNewer memory\n');
    writeFile(newestSummary, '# Session session-3\n\nNewest memory\n');

    const now = Date.now() / 1000;
    utimesSync(olderSummary, now - 300, now - 300);
    utimesSync(newerSummary, now - 200, now - 200);
    utimesSync(newestSummary, now - 100, now - 100);

    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = daemonConfigPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['memory', 'head', '2']);

    expect(exitCode).toBe(0);

    const output = logs.join('\n');
    expect(output).toContain('Latest memories (2)');
    expect(output).toContain('workspace-b/session-3.md');
    expect(output).toContain('workspace-a/session-2.md');
    expect(output).not.toContain('workspace-a/session-1.md');

    const newestIndex = output.indexOf('workspace-b/session-3.md');
    const newerIndex = output.indexOf('workspace-a/session-2.md');
    expect(newestIndex).toBeGreaterThan(-1);
    expect(newerIndex).toBeGreaterThan(-1);
    expect(newestIndex).toBeLessThan(newerIndex);

    logSpy.mockRestore();
  });

  it('returns usage error for invalid head count', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = join(createTempDir('personal-agent-cli-config-'), 'daemon.json');

    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    const exitCode = await runCli(['memory', 'head', 'abc']);

    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes('Usage: pa memory head [count]'))).toBe(true);

    errorSpy.mockRestore();
  });

  it('includes summary and cards directory paths in memory status --json output', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const daemonConfigPath = join(createTempDir('personal-agent-cli-config-'), 'daemon.json');
    const qmdBinDir = createFakeQmdBinary();

    const summaryDir = join(stateRoot, 'memory', 'conversations');
    const cardsDir = join(stateRoot, 'memory', 'cards');
    const sessionDir = join(stateRoot, 'pi-agent', 'sessions');

    writeFile(join(summaryDir, 'workspace-a', 'session-1.md'), '# Session session-1\n\nMemory\n');
    writeFile(join(cardsDir, 'workspace-a', 'session-1.json'), '{"type":"memory_card"}\n');
    writeFile(join(sessionDir, 'session-1.jsonl'), '{"type":"session","id":"session-1"}\n');

    process.env.PATH = `${qmdBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = daemonConfigPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['memory', 'status', '--json']);

    expect(exitCode).toBe(0);

    const payload = JSON.parse(logs.join('\n')) as {
      paths?: {
        sessionDir?: string;
        summaryDir?: string;
        cardsDir?: string;
      };
    };

    expect(payload.paths?.summaryDir).toBe(summaryDir);
    expect(payload.paths?.cardsDir).toBe(cardsDir);
    expect(payload.paths?.sessionDir).toBe(sessionDir);

    logSpy.mockRestore();
  });

  it('shows latest memory cards with pa memory cards head [count]', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = join(createTempDir('personal-agent-cli-config-'), 'daemon.json');

    const cardsDir = join(stateRoot, 'memory', 'cards');
    const olderCard = join(cardsDir, 'workspace-a', 'session-1.json');
    const newerCard = join(cardsDir, 'workspace-a', 'session-2.json');

    writeFile(olderCard, '{"session_id":"session-1"}\n');
    writeFile(newerCard, '{"session_id":"session-2"}\n');

    const now = Date.now() / 1000;
    utimesSync(olderCard, now - 120, now - 120);
    utimesSync(newerCard, now - 60, now - 60);

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['memory', 'cards', 'head', '1']);

    expect(exitCode).toBe(0);
    const output = logs.join('\n');
    expect(output).toContain('Latest memory cards (1)');
    expect(output).toContain('workspace-a/session-2.json');
    expect(output).not.toContain('workspace-a/session-1.json');

    logSpy.mockRestore();
  });

  it('opens memory summary by session id with pa memory open <sessionId>', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = join(createTempDir('personal-agent-cli-config-'), 'daemon.json');

    const summaryDir = join(stateRoot, 'memory', 'conversations');
    writeFile(join(summaryDir, 'workspace-a', 'session-42.md'), '# Session session-42\n\nOpened\n');

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['memory', 'open', 'session-42']);

    expect(exitCode).toBe(0);
    expect(logs.join('\n')).toContain('# Session session-42');

    logSpy.mockRestore();
  });
});
