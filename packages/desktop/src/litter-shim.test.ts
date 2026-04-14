import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/Applications/Personal Agent.app/Contents/Resources/app.asar'),
  },
}));

vi.mock('electron', () => ({
  app: electronMocks.app,
}));

vi.mock('./desktop-env.js', () => ({
  resolveDesktopRuntimePaths: () => ({
    repoRoot: '/repo',
    nodeCommand: '/usr/local/bin/node',
  }),
}));

import { installLitterShim, readLitterShimState, uninstallLitterShim } from './litter-shim.js';

describe('litter shim', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'pa-litter-shim-'));
    vi.stubEnv('HOME', homeDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('installs and removes the dev shim', () => {
    const before = readLitterShimState();
    expect(before.installed).toBe(false);
    expect(before.shimPath).toBe(join(homeDir, '.litter', 'bin', 'codex'));

    const installed = installLitterShim();
    expect(installed.installed).toBe(true);
    const content = readFileSync(installed.shimPath, 'utf-8');
    expect(content).toContain('/usr/local/bin/node');
    expect(content).toContain('/repo/packages/cli/dist/index.js');
    expect(content).toContain('codex app-server');

    const after = readLitterShimState();
    expect(after.installed).toBe(true);

    const removed = uninstallLitterShim();
    expect(removed.installed).toBe(false);
    expect(readLitterShimState().installed).toBe(false);
  });
});
