import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveDaemonPaths } from './paths.js';

const originalStateRoot = process.env.PERSONAL_AGENT_STATE_ROOT;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('daemon paths', () => {
  afterEach(async () => {
    if (originalStateRoot === undefined) {
      delete process.env.PERSONAL_AGENT_STATE_ROOT;
    } else {
      process.env.PERSONAL_AGENT_STATE_ROOT = originalStateRoot;
    }

    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('uses the default daemon directory under the state root', () => {
    const stateRoot = createTempDir('pa-daemon-paths-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    expect(resolveDaemonPaths()).toMatchObject({
      stateRoot,
      root: join(stateRoot, 'daemon'),
      socketPath: join(stateRoot, 'daemon', 'personal-agentd.sock'),
      pidFile: join(stateRoot, 'daemon', 'personal-agentd.pid'),
      logFile: join(stateRoot, 'daemon', 'logs', 'daemon.log'),
    });
  });

  it('isolates daemon runtime files beside an explicit socket path', () => {
    const stateRoot = createTempDir('pa-daemon-paths-state-');
    const daemonRoot = createTempDir('pa-daemon-paths-explicit-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    expect(resolveDaemonPaths(join(daemonRoot, 'custom.sock'))).toMatchObject({
      stateRoot,
      root: daemonRoot,
      socketPath: join(daemonRoot, 'custom.sock'),
      pidFile: join(daemonRoot, 'personal-agentd.pid'),
      logFile: join(daemonRoot, 'logs', 'daemon.log'),
    });
  });
});
