import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadDesktopConfig: vi.fn(),
  LocalHostController: vi.fn(),
}));

vi.mock('../state/desktop-config.js', () => ({
  loadDesktopConfig: mocks.loadDesktopConfig,
}));

vi.mock('./local-host-controller.js', () => ({
  LocalHostController: mocks.LocalHostController,
}));

import { HostManager } from './host-manager.js';

function createController(id: string, label = id) {
  return {
    id,
    label,
    kind: 'local',
    ensureRunning: vi.fn().mockResolvedValue(undefined),
    getBaseUrl: vi.fn().mockResolvedValue(`http://${id}.example.test`),
    getStatus: vi.fn().mockResolvedValue({
      reachable: true,
      mode: 'local-app-runtime',
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    config = {
      version: 2,
      openWindowOnLaunch: true,
      windowState: { width: 1440, height: 960 },
    };
    mocks.loadDesktopConfig.mockImplementation(() => config);

    mocks.LocalHostController.mockImplementation(function LocalHostController(record) {
      return createController(record.id, record.label);
    });
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

  it('creates and caches a local host controller', () => {
    const manager = new HostManager();
    const controller = manager.getHostController('local');
    expect(controller.id).toBe('local');
    expect(mocks.LocalHostController).toHaveBeenCalledTimes(1);

    const cached = manager.getHostController('local');
    expect(cached).toBe(controller);
    expect(mocks.LocalHostController).toHaveBeenCalledTimes(1);
  });

  it('throws for unknown hosts', () => {
    const manager = new HostManager();
    expect(() => manager.getHostRecord('unknown')).toThrow('Unknown desktop host');
    expect(() => manager.getHostController('unknown')).toThrow('Unknown desktop host');
  });
});
