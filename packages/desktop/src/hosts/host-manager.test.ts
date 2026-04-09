import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadDesktopConfig: vi.fn(),
  saveDesktopConfig: vi.fn(),
  LocalHostController: vi.fn(),
  SshHostController: vi.fn(),
  WebHostController: vi.fn(),
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
}));

vi.mock('./web-host-controller.js', () => ({
  WebHostController: mocks.WebHostController,
}));

import { HostManager } from './host-manager.js';

function createController(id: string, label = id, kind: 'local' | 'ssh' | 'web' = 'local') {
  return {
    id,
    label,
    kind,
    ensureRunning: vi.fn().mockResolvedValue(undefined),
    getBaseUrl: vi.fn().mockResolvedValue(`http://${id}.example.test`),
    getStatus: vi.fn().mockResolvedValue({
      reachable: true,
      mode: kind === 'local' ? 'local-child-process' : kind === 'ssh' ? 'ssh-tunnel' : 'web-remote',
      summary: `${label} ready`,
    }),
    openNewConversation: vi.fn().mockResolvedValue(`http://${id}.example.test/conversations/new`),
    restart: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

describe('HostManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadDesktopConfig.mockReturnValue({
      version: 1,
      defaultHostId: 'web-1',
      openWindowOnLaunch: true,
      windowState: { width: 1440, height: 960 },
      hosts: [
        { id: 'local', label: 'Local', kind: 'local' },
        { id: 'web-1', label: 'Tailnet', kind: 'web', baseUrl: 'https://tailnet.example.ts.net', autoConnect: true },
      ],
    });

    mocks.LocalHostController.mockImplementation(function LocalHostController(record) {
      return createController(record.id, record.label, 'local');
    });
    mocks.WebHostController.mockImplementation(function WebHostController(record) {
      return createController(record.id, record.label, 'web');
    });
    mocks.SshHostController.mockImplementation(function SshHostController(record) {
      return createController(record.id, record.label, 'ssh');
    });
  });

  it('starts on the configured default host but does not persist a temporary switch', async () => {
    const manager = new HostManager();

    expect(manager.getConnectionsState().activeHostId).toBe('web-1');
    expect(manager.getConnectionsState().defaultHostId).toBe('web-1');

    await manager.switchHost('local');

    expect(manager.getConnectionsState().activeHostId).toBe('local');
    expect(manager.getConnectionsState().defaultHostId).toBe('web-1');
    expect(mocks.saveDesktopConfig).not.toHaveBeenCalled();
  });

  it('persists default-on-launch when saving an auto-connect host', async () => {
    const manager = new HostManager();

    await manager.saveHost({
      id: 'ssh-gpu',
      label: 'GPU box',
      kind: 'ssh',
      sshTarget: 'patrick@gpu-box',
      autoConnect: true,
    });

    expect(mocks.saveDesktopConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mocks.saveDesktopConfig.mock.calls[0]?.[0];
    expect(savedConfig.defaultHostId).toBe('ssh-gpu');
    expect(savedConfig.hosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'web-1', autoConnect: false }),
      expect.objectContaining({ id: 'ssh-gpu', autoConnect: true }),
    ]));
  });
});
