import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { DesktopConfig } from './hosts/types.js';
import { DesktopWorkspaceServerManager } from './workspace-server.js';

function createConfig(overrides: Partial<DesktopConfig> = {}): DesktopConfig {
  return {
    version: 1,
    defaultHostId: 'local',
    openWindowOnLaunch: true,
    windowState: { width: 1440, height: 960 },
    hosts: [{ id: 'local', label: 'Local', kind: 'local' }],
    workspaceServer: {
      enabled: false,
      port: 8390,
      useTailscaleServe: false,
    },
    ...overrides,
  };
}

function createRuntimePaths() {
  return {
    repoRoot: '/repo',
    nodeCommand: '/usr/local/bin/node',
    useElectronRunAsNode: false,
    daemonEntryFile: '/repo/packages/daemon/dist/index.js',
    webDistDir: '/repo/packages/web/dist',
    desktopStateDir: '/state/desktop',
    desktopLogsDir: '/logs',
    desktopConfigFile: '/state/desktop/config.json',
    trayTemplateIconFile: '/repo/packages/desktop/assets/iconTemplate.png',
    colorIconFile: '/repo/packages/desktop/assets/icon.png',
  };
}

function createChildHandle(pid: number) {
  let exitHandler: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
  const child = {
    pid,
    exitCode: null,
    killed: false,
    once: vi.fn((event: string, handler: (code: number | null, signal: NodeJS.Signals | null) => void) => {
      if (event === 'exit') {
        exitHandler = handler;
      }
    }),
    kill: vi.fn(),
  } as unknown as ChildProcess;

  return {
    child,
    emitExit(code: number | null, signal: NodeJS.Signals | null = null) {
      (child as { exitCode: number | null }).exitCode = code;
      exitHandler?.(code, signal);
    },
  };
}

describe('DesktopWorkspaceServerManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts and publishes the managed workspace server from desktop config', async () => {
    let config = createConfig({
      workspaceServer: {
        enabled: true,
        port: 8390,
        useTailscaleServe: true,
      },
    });
    const saveConfig = vi.fn((next: DesktopConfig) => {
      config = next;
    });
    const child = {
      pid: 4242,
      exitCode: null,
      killed: false,
      once: vi.fn(),
      kill: vi.fn(),
    } as unknown as ChildProcess;
    const spawnChild = vi.fn(() => ({
      child,
      logPath: '/logs/codex-app-server.log',
    }));
    const stopChild = vi.fn().mockResolvedValue(undefined);
    const syncTailscaleServe = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new DesktopWorkspaceServerManager({
      loadConfig: () => config,
      saveConfig,
      resolveRuntimePaths: () => createRuntimePaths(),
      resolveInvocation: (extraArgs = []) => ({
        command: '/usr/local/bin/node',
        args: ['/repo/packages/cli/dist/index.js', 'codex', 'app-server', ...extraArgs],
        cwd: '/repo',
      }),
      spawnChild: spawnChild as never,
      stopChild,
      resolveChildEnv: (env) => env ?? {},
      syncTailscaleServe,
      resolveTailscaleBaseUrl: () => 'https://desktop.tailnet.ts.net',
      waitForHealthy: vi.fn().mockResolvedValue(undefined),
    });

    await expect(manager.readState()).resolves.toEqual({
      enabled: true,
      port: 8390,
      useTailscaleServe: true,
      running: true,
      websocketPath: '/codex',
      localWebsocketUrl: 'ws://127.0.0.1:8390/codex',
      tailnetWebsocketUrl: 'wss://desktop.tailnet.ts.net/codex',
      logFile: '/logs/codex-app-server.log',
      pid: 4242,
    });

    expect(spawnChild).toHaveBeenCalledWith(expect.objectContaining({
      command: '/usr/local/bin/node',
      args: ['/repo/packages/cli/dist/index.js', 'codex', 'app-server', '--listen', 'ws://127.0.0.1:8390/codex'],
      cwd: '/repo',
      logPath: '/logs/codex-app-server.log',
    }));
    expect(syncTailscaleServe).toHaveBeenCalledWith({ enabled: true, port: 8390, path: '/codex' });
  });

  it('disabling hosting clears Tailnet publishing and stops the managed child', async () => {
    let config = createConfig({
      workspaceServer: {
        enabled: true,
        port: 8390,
        useTailscaleServe: true,
      },
    });
    const saveConfig = vi.fn((next: DesktopConfig) => {
      config = next;
    });
    const child = {
      pid: 4242,
      exitCode: null,
      killed: false,
      once: vi.fn(),
      kill: vi.fn(),
    } as unknown as ChildProcess;
    const spawnChild = vi.fn(() => ({ child, logPath: '/logs/codex-app-server.log' }));
    const stopChild = vi.fn().mockResolvedValue(undefined);
    const syncTailscaleServe = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new DesktopWorkspaceServerManager({
      loadConfig: () => config,
      saveConfig,
      resolveRuntimePaths: () => createRuntimePaths(),
      resolveInvocation: (extraArgs = []) => ({
        command: '/usr/local/bin/node',
        args: ['/repo/packages/cli/dist/index.js', 'codex', 'app-server', ...extraArgs],
        cwd: '/repo',
      }),
      spawnChild: spawnChild as never,
      stopChild,
      resolveChildEnv: (env) => env ?? {},
      syncTailscaleServe,
      resolveTailscaleBaseUrl: () => 'https://desktop.tailnet.ts.net',
      waitForHealthy: vi.fn().mockResolvedValue(undefined),
    });

    await manager.readState();
    await manager.updateConfig({ enabled: false });

    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      workspaceServer: {
        enabled: false,
        port: 8390,
        useTailscaleServe: false,
      },
    }));
    expect(stopChild).toHaveBeenCalled();
    expect(syncTailscaleServe).toHaveBeenLastCalledWith({ enabled: false, port: 8390, path: '/codex' });
  });

  it('restarts the managed child after an unexpected exit while enabled', async () => {
    vi.useFakeTimers();
    try {
      let config = createConfig({
        workspaceServer: {
          enabled: true,
          port: 8390,
          useTailscaleServe: false,
        },
      });
      const firstChild = createChildHandle(4242);
      const secondChild = createChildHandle(4343);
      const spawnChild = vi.fn()
        .mockReturnValueOnce({ child: firstChild.child, logPath: '/logs/codex-app-server.log' })
        .mockReturnValueOnce({ child: secondChild.child, logPath: '/logs/codex-app-server.log' });
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      const manager = new DesktopWorkspaceServerManager({
        loadConfig: () => config,
        saveConfig: (next: DesktopConfig) => {
          config = next;
        },
        resolveRuntimePaths: () => createRuntimePaths(),
        resolveInvocation: (extraArgs = []) => ({
          command: '/usr/local/bin/node',
          args: ['/repo/packages/cli/dist/index.js', 'codex', 'app-server', ...extraArgs],
          cwd: '/repo',
        }),
        spawnChild: spawnChild as never,
        stopChild: vi.fn().mockResolvedValue(undefined),
        resolveChildEnv: (env) => env ?? {},
        syncTailscaleServe: vi.fn(),
        resolveTailscaleBaseUrl: () => 'https://desktop.tailnet.ts.net',
        waitForHealthy: vi.fn().mockResolvedValue(undefined),
      });

      await manager.readState();
      firstChild.emitExit(1);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(spawnChild).toHaveBeenCalledTimes(2);
      await expect(manager.readState()).resolves.toMatchObject({
        enabled: true,
        running: true,
        pid: 4343,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-restart after an intentional stop', async () => {
    vi.useFakeTimers();
    try {
      let config = createConfig({
        workspaceServer: {
          enabled: true,
          port: 8390,
          useTailscaleServe: false,
        },
      });
      const firstChild = createChildHandle(4242);
      const spawnChild = vi.fn(() => ({ child: firstChild.child, logPath: '/logs/codex-app-server.log' }));
      const stopChild = vi.fn().mockImplementation(async () => {
        firstChild.emitExit(0, 'SIGTERM');
      });
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValue({ ok: false });
      vi.stubGlobal('fetch', fetchMock);

      const manager = new DesktopWorkspaceServerManager({
        loadConfig: () => config,
        saveConfig: (next: DesktopConfig) => {
          config = next;
        },
        resolveRuntimePaths: () => createRuntimePaths(),
        resolveInvocation: (extraArgs = []) => ({
          command: '/usr/local/bin/node',
          args: ['/repo/packages/cli/dist/index.js', 'codex', 'app-server', ...extraArgs],
          cwd: '/repo',
        }),
        spawnChild: spawnChild as never,
        stopChild,
        resolveChildEnv: (env) => env ?? {},
        syncTailscaleServe: vi.fn(),
        resolveTailscaleBaseUrl: () => 'https://desktop.tailnet.ts.net',
        waitForHealthy: vi.fn().mockResolvedValue(undefined),
      });

      await manager.readState();
      await manager.updateConfig({ enabled: false });
      await vi.advanceTimersByTimeAsync(10_000);

      expect(spawnChild).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
