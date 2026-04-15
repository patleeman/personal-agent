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
      resolveRuntimePaths: () => ({
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
      }),
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
      resolveRuntimePaths: () => ({
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
      }),
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
});
