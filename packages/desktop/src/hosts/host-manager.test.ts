import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadDesktopConfig: vi.fn(),
  saveDesktopConfig: vi.fn(),
  readDesktopRemoteHostAuthState: vi.fn((hostId: string) => ({ hostId, hasBearerToken: false })),
  writeDesktopRemoteHostAuth: vi.fn(),
  clearDesktopRemoteHostAuth: vi.fn((hostId: string) => ({ hostId, hasBearerToken: false })),
  LocalHostController: vi.fn(),
  SshHostController: vi.fn(),
  WebHostController: vi.fn(),
}));

vi.mock('../state/desktop-config.js', () => ({
  loadDesktopConfig: mocks.loadDesktopConfig,
  saveDesktopConfig: mocks.saveDesktopConfig,
}));

vi.mock('../state/remote-host-auth.js', () => ({
  readDesktopRemoteHostAuthState: mocks.readDesktopRemoteHostAuthState,
  writeDesktopRemoteHostAuth: mocks.writeDesktopRemoteHostAuth,
  clearDesktopRemoteHostAuth: mocks.clearDesktopRemoteHostAuth,
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
    dispatchApiRequest: vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: Buffer.from(JSON.stringify({ ok: true }), 'utf-8'),
    }),
    invokeLocalApi: vi.fn().mockResolvedValue({ ok: true }),
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
        { id: 'ssh-1', label: 'GPU box', kind: 'ssh', sshTarget: 'patrick@gpu-box' },
      ],
    });

    mocks.readDesktopRemoteHostAuthState.mockImplementation((hostId: string) => ({ hostId, hasBearerToken: false }));
    mocks.writeDesktopRemoteHostAuth.mockReset();
    mocks.writeDesktopRemoteHostAuth.mockImplementation(({ hostId }: { hostId: string }) => ({ hostId, hasBearerToken: true }));
    mocks.clearDesktopRemoteHostAuth.mockImplementation((hostId: string) => ({ hostId, hasBearerToken: false }));

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

  it('cycles through hosts in config order when switching relative to the active host', async () => {
    const manager = new HostManager();

    await expect(manager.switchRelativeHost(1)).resolves.toMatchObject({ id: 'ssh-1' });
    expect(manager.getConnectionsState().activeHostId).toBe('ssh-1');

    await expect(manager.switchRelativeHost(1)).resolves.toMatchObject({ id: 'local' });
    expect(manager.getConnectionsState().activeHostId).toBe('local');

    await expect(manager.switchRelativeHost(-1)).resolves.toMatchObject({ id: 'ssh-1' });
    expect(manager.getConnectionsState().activeHostId).toBe('ssh-1');
  });

  it('can resolve environment and conversation URLs for a non-active host', async () => {
    const manager = new HostManager();

    await expect(manager.openNewConversationForHost('local')).resolves.toBe('http://local.example.test/conversations/new');
    await expect(manager.getDesktopEnvironmentForHost('local')).resolves.toMatchObject({
      activeHostId: 'local',
      activeHostLabel: 'Local',
      activeHostKind: 'local',
    });
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

  it('pairs direct web hosts by exchanging a pairing code for a bearer token', async () => {
    const manager = new HostManager();
    mocks.readDesktopRemoteHostAuthState.mockImplementation((hostId: string) => ({
      hostId,
      hasBearerToken: true,
      deviceLabel: 'Patrick desktop',
      sessionId: 'session-1',
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        bearerToken: 'desktop-token',
        session: {
          id: 'session-1',
          deviceLabel: 'Patrick desktop',
        },
      }),
    }));

    await expect(manager.pairHost('web-1', { code: 'PAIR-1234', deviceLabel: 'Patrick desktop' })).resolves.toEqual({
      hostId: 'web-1',
      hasBearerToken: true,
      deviceLabel: 'Patrick desktop',
      sessionId: 'session-1',
    });
    expect(mocks.writeDesktopRemoteHostAuth).toHaveBeenCalledWith({
      hostId: 'web-1',
      bearerToken: 'desktop-token',
      session: {
        id: 'session-1',
        deviceLabel: 'Patrick desktop',
      },
    });
  });
});
