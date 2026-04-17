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
  DEFAULT_DESKTOP_WORKSPACE_SERVER_PORT,
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

  it('migrates legacy SSH remote ports from the old web-ui default to the codex default', () => {
    writeFileSync(join(dir, 'config.json'), `${JSON.stringify({
      version: 1,
      defaultHostId: 'ssh-1',
      openWindowOnLaunch: true,
      hosts: [
        { id: 'local', label: 'Local', kind: 'local' },
        { id: 'ssh-1', label: 'GPU', kind: 'ssh', sshTarget: 'patrick@gpu', remotePort: 3741 },
      ],
    }, null, 2)}\n`, 'utf-8');

    const config = loadDesktopConfig();
    expect(config.hosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ssh-1', remotePort: DEFAULT_DESKTOP_WORKSPACE_SERVER_PORT }),
    ]));
  });

  it('migrates tailscale websocket URLs to include the codex upstream path', () => {
    writeFileSync(join(dir, 'config.json'), `${JSON.stringify({
      version: 1,
      defaultHostId: 'tailnet',
      openWindowOnLaunch: true,
      hosts: [
        { id: 'local', label: 'Local', kind: 'local' },
        { id: 'tailnet', label: 'Tailnet', kind: 'web', websocketUrl: 'wss://desktop.tail5a01ec.ts.net/codex' },
      ],
    }, null, 2)}\n`, 'utf-8');

    const config = loadDesktopConfig();
    expect(config.hosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'tailnet', websocketUrl: 'wss://desktop.tail5a01ec.ts.net/codex/codex' }),
    ]));
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
