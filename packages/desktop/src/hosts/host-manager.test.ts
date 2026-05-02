import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadDesktopConfig: vi.fn(),
  saveDesktopConfig: vi.fn(),
  LocalHostController: vi.fn(),
  SshHostController: vi.fn(),
  testSshConnection: vi.fn(),
}));

vi.mock('../state/desktop-config.js', () => ({
  loadDesktopConfig: mocks.loadDesktopConfig,
  saveDesktopConfig: mocks.saveDesktopConfig,
}));

vi.mock('./local-host-controller.js', () => ({
  LocalHostController: mocks.LocalHostController,
}));

vi.mock('./ssh-host-controller.js', () => ({
  SshHostController: mocks.SshHostController,
  testSshConnection: mocks.testSshConnection,
}));

import { HostManager } from './host-manager.js';

function createController(id: string, label = id, kind: 'local' | 'ssh' = 'local') {
  return {
    id,
    label,
    kind,
    ensureRunning: vi.fn().mockResolvedValue(undefined),
    getBaseUrl: vi.fn().mockResolvedValue(`http://${id}.example.test`),
    getStatus: vi.fn().mockResolvedValue({
      reachable: true,
      mode: kind === 'local' ? 'local-app-runtime' : 'ssh-tunnel',
      summary: `${label} ready`,
    }),
    openNewConversation: vi.fn().mockResolvedValue(`http://${id}.example.test/conversations/new`),
    dispatchApiRequest: vi.fn(),
    invokeLocalApi: vi.fn(),
    restart: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

describe('HostManager', () => {
  let config: {
    version: 2;
    openWindowOnLaunch: boolean;
    windowState: { width: number; height: number };
    hosts: Array<{ id: string; label: string; kind: 'ssh'; sshTarget: string }>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    config = {
      version: 2,
      openWindowOnLaunch: true,
      windowState: { width: 1440, height: 960 },
      hosts: [
        { id: 'ssh-1', label: 'GPU box', kind: 'ssh', sshTarget: 'user@gpu-box' },
      ],
    };
    mocks.loadDesktopConfig.mockImplementation(() => config);
    mocks.saveDesktopConfig.mockImplementation((next) => {
      config = next;
    });

    mocks.LocalHostController.mockImplementation(function LocalHostController(record) {
      return createController(record.id, record.label, 'local');
    });
    mocks.SshHostController.mockImplementation(function SshHostController(record) {
      return createController(record.id, record.label, 'ssh');
    });
    mocks.testSshConnection.mockImplementation(({ sshTarget }) => ({
      ok: true,
      sshTarget,
      os: 'linux',
      arch: 'x64',
      platformKey: 'linux-x64',
      homeDirectory: '/home/patrick',
      tempDirectory: '/tmp',
      cacheDirectory: '/home/patrick/.cache/personal-agent/ssh-runtime',
      message: `${sshTarget} is reachable · Linux x64`,
    }));
  });

  it('always reports the local desktop as the active host', async () => {
    const manager = new HostManager();

    expect(manager.getActiveHostId()).toBe('local');
    await expect(manager.getDesktopEnvironment()).resolves.toMatchObject({
      activeHostId: 'local',
      activeHostLabel: 'Local',
      activeHostKind: 'local',
    });
  });

  it('returns only saved SSH remotes in connections state', () => {
    const manager = new HostManager();
    expect(manager.getConnectionsState()).toEqual({
      hosts: [{ id: 'ssh-1', label: 'GPU box', kind: 'ssh', sshTarget: 'user@gpu-box' }],
    });
  });

  it('saves SSH remotes and rejects non-SSH records', async () => {
    const manager = new HostManager();

    await manager.saveHost({
      id: 'ssh-2',
      label: 'Bender',
      kind: 'ssh',
      sshTarget: 'user@bender',
    });

    expect(mocks.saveDesktopConfig).toHaveBeenCalledWith(expect.objectContaining({
      hosts: expect.arrayContaining([
        expect.objectContaining({ id: 'ssh-1' }),
        expect.objectContaining({ id: 'ssh-2', sshTarget: 'user@bender' }),
      ]),
    }));

    await expect(manager.saveHost({ id: 'local', label: 'Local', kind: 'local' })).rejects.toThrow('Only SSH remotes');
  });

  it('deletes saved SSH remotes and disposes existing controllers', async () => {
    const manager = new HostManager();
    manager.getHostController('ssh-1');

    await manager.deleteHost('ssh-1');

    expect(manager.getConnectionsState()).toEqual({ hosts: [] });
  });

  it('probes SSH targets without saving them first', async () => {
    const manager = new HostManager();

    await expect(manager.testSshConnection({ sshTarget: 'user@bender' })).resolves.toMatchObject({
      ok: true,
      sshTarget: 'user@bender',
      platformKey: 'linux-x64',
    });

    expect(mocks.testSshConnection).toHaveBeenCalledWith({ sshTarget: 'user@bender' });
  });
});
