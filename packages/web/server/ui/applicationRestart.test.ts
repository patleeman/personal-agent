import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  closeSyncMock,
  existsSyncMock,
  mkdirSyncMock,
  openSyncMock,
  readFileSyncMock,
  rmSyncMock,
  spawnMock,
  writeFileSyncMock,
} = vi.hoisted(() => ({
  closeSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  openSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  rmSyncMock: vi.fn(),
  spawnMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('node:fs', () => ({
  closeSync: closeSyncMock,
  existsSync: existsSyncMock,
  mkdirSync: mkdirSyncMock,
  openSync: openSyncMock,
  readFileSync: readFileSyncMock,
  rmSync: rmSyncMock,
  writeFileSync: writeFileSyncMock,
}));

vi.mock('@personal-agent/core', () => ({
  getStateRoot: () => '/tmp/pa-state',
}));

import { requestApplicationRestart } from './applicationRestart.js';

describe('application restart requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('{ bad json');
    openSyncMock.mockReturnValue(42);
  });

  it('rejects unsafe detached child pids', () => {
    const child = { pid: Number.MAX_SAFE_INTEGER + 1, unref: vi.fn() };
    spawnMock.mockReturnValue(child);

    expect(() => requestApplicationRestart({ repoRoot: '/tmp/repo', profile: 'default' }))
      .toThrow('Detached restart process did not return a valid pid.');

    expect(child.unref).not.toHaveBeenCalled();
    expect(rmSyncMock).toHaveBeenCalledWith('/tmp/pa-state/web/app-restart.lock.json', { force: true });
  });
});
