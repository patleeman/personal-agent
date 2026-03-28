import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { childProcessMocks, serviceMocks } = vi.hoisted(() => ({
  childProcessMocks: {
    spawnSync: vi.fn(),
  },
  serviceMocks: {
    getWebUiServiceStatus: vi.fn(),
    syncWebUiTailscaleServe: vi.fn(),
  },
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawnSync: childProcessMocks.spawnSync,
  };
});

vi.mock('@personal-agent/services', async () => {
  const actual = await vi.importActual<typeof import('@personal-agent/services')>('@personal-agent/services');
  return {
    ...actual,
    getWebUiServiceStatus: serviceMocks.getWebUiServiceStatus,
    syncWebUiTailscaleServe: serviceMocks.syncWebUiTailscaleServe,
  };
});

import { runCli } from './index.js';

const originalEnv = process.env;
const originalCwd = process.cwd();
const tempDirs: string[] = [];
let activeServers: Server[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createFakeWebRepo(): string {
  const repoRoot = createTempDir('pa-ui-foreground-repo-');
  mkdirSync(join(repoRoot, 'packages', 'web', 'dist-server'), { recursive: true });
  mkdirSync(join(repoRoot, 'packages', 'web', 'dist'), { recursive: true });
  writeFileSync(join(repoRoot, 'packages', 'web', 'dist-server', 'index.js'), 'process.exit(0);\n');
  return repoRoot;
}

async function listenOnRandomPort(): Promise<{ server: Server; port: number }> {
  const server = createServer((_req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  activeServers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address');
  }

  return { server, port: address.port };
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PI_SESSION_DIR: createTempDir('pi-session-'),
  };

  childProcessMocks.spawnSync.mockReset();
  childProcessMocks.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
  serviceMocks.getWebUiServiceStatus.mockReset();
  serviceMocks.getWebUiServiceStatus.mockImplementation(({ port }: { port: number }) => ({
    identifier: 'mock-web-ui',
    manifestPath: '/tmp/mock-web-ui',
    installed: false,
    running: false,
    platform: 'launchd',
    port,
    url: `http://localhost:${port}`,
  }));
  serviceMocks.syncWebUiTailscaleServe.mockReset();
  serviceMocks.syncWebUiTailscaleServe.mockImplementation(() => undefined);
});

afterEach(async () => {
  process.chdir(originalCwd);
  process.env = originalEnv;
  await Promise.all(activeServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('ui foreground launch', () => {
  it('shows status for bare `pa ui` instead of launching a foreground server', async () => {
    const repoRoot = createFakeWebRepo();
    const stateRoot = createTempDir('pa-ui-foreground-state-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['ui']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Web UI'))).toBe(true);
    expect(logs.some((line) => line.includes('Managed service'))).toBe(true);
    expect(logs.some((line) => line.includes('Web UI commands'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui open'))).toBe(true);
    expect(logs.some((line) => line.includes('Options:'))).toBe(true);
    expect(childProcessMocks.spawnSync).not.toHaveBeenCalledWith(process.execPath, expect.any(Array), expect.any(Object));

    logSpy.mockRestore();
  });

  it('reuses the managed web UI service instead of starting a second server on the same port', async () => {
    const repoRoot = createFakeWebRepo();
    const stateRoot = createTempDir('pa-ui-foreground-state-');
    const { port } = await listenOnRandomPort();
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    serviceMocks.getWebUiServiceStatus.mockImplementation(() => ({
      identifier: 'mock-web-ui',
      manifestPath: '/tmp/mock-web-ui',
      installed: true,
      running: true,
      platform: 'launchd',
      port,
      url: `http://localhost:${port}`,
    }));

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['ui', '--port', String(port)]);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Managed web UI service is already running'))).toBe(true);
    expect(childProcessMocks.spawnSync).not.toHaveBeenCalledWith(process.execPath, expect.any(Array), expect.any(Object));

    logSpy.mockRestore();
  });

  it('still starts a foreground server when the managed service is marked running but nothing is listening on the requested port', async () => {
    const repoRoot = createFakeWebRepo();
    const stateRoot = createTempDir('pa-ui-foreground-state-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const probe = await listenOnRandomPort();
    const port = probe.port;
    await new Promise<void>((resolve) => probe.server.close(() => resolve()));
    activeServers = activeServers.filter((server) => server !== probe.server);

    serviceMocks.getWebUiServiceStatus.mockImplementation(() => ({
      identifier: 'mock-web-ui',
      manifestPath: '/tmp/mock-web-ui',
      installed: true,
      running: true,
      platform: 'launchd',
      port,
      url: `http://localhost:${port}`,
    }));

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['ui', '--port', String(port)]);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes(`Starting web UI on http://localhost:${port}`))).toBe(true);
    expect(childProcessMocks.spawnSync).toHaveBeenCalledWith(
      process.execPath,
      [join(repoRoot, 'packages', 'web', 'dist-server', 'index.js')],
      expect.objectContaining({
        stdio: 'inherit',
        env: expect.objectContaining({
          PA_WEB_PORT: String(port),
          PA_WEB_COMPANION_PORT: '3742',
          PERSONAL_AGENT_REPO_ROOT: repoRoot,
        }),
      }),
    );

    logSpy.mockRestore();
  });

  it('preserves unknown web config fields when CLI updates port and tailscale settings', async () => {
    const repoRoot = createFakeWebRepo();
    const stateRoot = createTempDir('pa-ui-foreground-state-');
    const configDir = createTempDir('pa-ui-config-');
    const configPath = join(configDir, 'web.json');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_WEB_CONFIG_FILE = configPath;

    writeFileSync(configPath, JSON.stringify({
      port: 3741,
      useTailscaleServe: true,
      resumeFallbackPrompt: 'Pick up from the last useful checkpoint.',
      webOnlySetting: {
        enabled: true,
      },
    }, null, 2));

    const exitCode = await runCli(['ui', '--port', '4810', '--no-tailscale-serve']);

    expect(exitCode).toBe(0);
    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual({
      port: 4810,
      companionPort: 3742,
      useTailscaleServe: false,
      resumeFallbackPrompt: 'Pick up from the last useful checkpoint.',
      webOnlySetting: {
        enabled: true,
      },
    });
  });
});
