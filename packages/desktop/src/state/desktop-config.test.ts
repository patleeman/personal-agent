import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveDesktopRuntimePaths: vi.fn(),
}));

vi.mock('../desktop-env.js', () => ({
  resolveDesktopRuntimePaths: mocks.resolveDesktopRuntimePaths,
}));

import {
  loadDesktopConfig,
  readDesktopAppPreferences,
  updateDesktopAppPreferences,
} from './desktop-config.js';

describe('desktop-config', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pa-desktop-config-'));
    mocks.resolveDesktopRuntimePaths.mockReturnValue({
      desktopConfigFile: join(dir, 'config.json'),
      desktopStateDir: dir,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('drops legacy local and websocket host records while keeping ssh remotes', () => {
    writeFileSync(join(dir, 'config.json'), `${JSON.stringify({
      version: 1,
      defaultHostId: 'tailnet',
      openWindowOnLaunch: true,
      hosts: [
        { id: 'local', label: 'Local', kind: 'local' },
        { id: 'tailnet', label: 'Tailnet', kind: 'web', websocketUrl: 'wss://desktop.tail5a01ec.ts.net/codex' },
        { id: 'ssh-1', label: 'GPU', kind: 'ssh', sshTarget: 'patrick@gpu' },
      ],
    }, null, 2)}\n`, 'utf-8');

    const config = loadDesktopConfig();
    expect(config).toEqual(expect.objectContaining({
      version: 2,
      hosts: [{ id: 'ssh-1', label: 'GPU', kind: 'ssh', sshTarget: 'patrick@gpu' }],
    }));
  });

  it('drops unsafe persisted window bounds', () => {
    writeFileSync(join(dir, 'config.json'), `${JSON.stringify({
      version: 2,
      windowState: {
        x: Number.MAX_SAFE_INTEGER + 1,
        y: 40,
        width: Number.MAX_SAFE_INTEGER + 1,
        height: 700,
      },
    }, null, 2)}\n`, 'utf-8');

    expect(loadDesktopConfig().windowState).toEqual({
      x: undefined,
      y: 40,
      width: 1440,
      height: 700,
    });
  });

  it('drops non-positive persisted window dimensions', () => {
    writeFileSync(join(dir, 'config.json'), `${JSON.stringify({
      version: 2,
      windowState: {
        x: -120,
        y: 40,
        width: -800,
        height: 0,
      },
    }, null, 2)}\n`, 'utf-8');

    expect(loadDesktopConfig().windowState).toEqual({
      x: -120,
      y: 40,
      width: 1440,
      height: 960,
    });
  });

  it('defaults desktop app preferences and persists updates', () => {
    const initial = loadDesktopConfig();
    expect(readDesktopAppPreferences(initial)).toEqual({
      autoInstallUpdates: false,
      startOnSystemStart: false,
    });

    updateDesktopAppPreferences({ autoInstallUpdates: true, startOnSystemStart: true });

    expect(readDesktopAppPreferences(loadDesktopConfig())).toEqual({
      autoInstallUpdates: true,
      startOnSystemStart: true,
    });
  });
});
