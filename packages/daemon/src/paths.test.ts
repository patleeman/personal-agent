import { mkdtempSync, statSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDaemonDirectories, resolveDaemonPaths } from './paths.js';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('daemon paths', () => {
  it('resolves default daemon paths under state root', () => {
    const root = tempDir('pa-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = root;

    const paths = resolveDaemonPaths();

    expect(paths.root).toContain(join(root, 'daemon'));
    expect(paths.socketPath).toContain('personal-agentd.sock');
    expect(paths.pidFile).toContain('personal-agentd.pid');
    expect(paths.logFile).toContain(join('logs', 'daemon.log'));
  });

  it('uses explicit socket path and expands home', () => {
    const paths = resolveDaemonPaths('~/custom.sock');
    expect(paths.socketPath.startsWith(process.env.HOME || '')).toBe(true);
    expect(paths.socketPath.endsWith('custom.sock')).toBe(true);
  });

  it('creates daemon directories with restrictive permissions', () => {
    const root = tempDir('pa-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = root;

    const paths = resolveDaemonPaths();
    ensureDaemonDirectories(paths);

    const rootStats = statSync(paths.root);
    const logsStats = statSync(paths.logDir);

    expect(rootStats.isDirectory()).toBe(true);
    expect(logsStats.isDirectory()).toBe(true);
  });
});
