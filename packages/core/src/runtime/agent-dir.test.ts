import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { preparePiAgentDir } from './agent-dir.js';
import { getDurablePiAgentDir, getDurableSessionsDir, type RuntimeStatePaths } from './paths.js';

const tempDirs: string[] = [];

function createStatePaths(root: string): RuntimeStatePaths {
  return {
    root,
    auth: join(root, 'auth'),
    session: join(root, 'session'),
    cache: join(root, 'cache'),
  };
}

async function createTempStateRoot(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'pa-agent-dir-'));
  tempDirs.push(dir);
  return join(dir, 'state');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('preparePiAgentDir', () => {
  it('creates the runtime agent dir, links sessions to durable state, and removes stale synced artifacts', async () => {
    const root = await createTempStateRoot();
    const statePaths = createStatePaths(root);
    const durablePiAgentDir = getDurablePiAgentDir(root);

    mkdirSync(join(durablePiAgentDir, 'bin'), { recursive: true });
    for (const relativePath of [
      'AGENTS.md',
      'APPEND_SYSTEM.md',
      'SYSTEM.md',
      'auth.json',
      'models.json',
      'settings.json',
      'session-meta-index.json',
    ]) {
      writeFileSync(join(durablePiAgentDir, relativePath), 'stale');
    }

    const result = await preparePiAgentDir({ statePaths });

    expect(result).toEqual({
      agentDir: join(root, 'pi-agent-runtime'),
      authFile: join(root, 'pi-agent-runtime', 'auth.json'),
      sessionsDir: join(root, 'pi-agent-runtime', 'sessions'),
    });
    expect(lstatSync(result.sessionsDir).isSymbolicLink()).toBe(true);
    expect(resolve(dirname(result.sessionsDir), readlinkSync(result.sessionsDir))).toBe(getDurableSessionsDir(root));

    for (const relativePath of [
      'AGENTS.md',
      'APPEND_SYSTEM.md',
      'SYSTEM.md',
      'auth.json',
      'models.json',
      'settings.json',
      'session-meta-index.json',
      'bin',
    ]) {
      expect(existsSync(join(durablePiAgentDir, relativePath))).toBe(false);
    }
  });

  it('replaces a pre-existing runtime sessions file with the durable sessions symlink', async () => {
    const root = await createTempStateRoot();
    const statePaths = createStatePaths(root);
    const runtimeSessionsPath = join(root, 'pi-agent-runtime', 'sessions');

    mkdirSync(dirname(runtimeSessionsPath), { recursive: true });
    writeFileSync(runtimeSessionsPath, 'legacy sessions file');

    await preparePiAgentDir({ statePaths });

    expect(lstatSync(runtimeSessionsPath).isSymbolicLink()).toBe(true);
    expect(resolve(dirname(runtimeSessionsPath), readlinkSync(runtimeSessionsPath))).toBe(getDurableSessionsDir(root));
  });

  it('repairs incorrect legacy symlinks and leaves the correct target in place on repeat runs', async () => {
    const root = await createTempStateRoot();
    const statePaths = createStatePaths(root);
    const runtimeSessionsPath = join(root, 'pi-agent-runtime', 'sessions');
    const wrongTarget = join(root, 'sync', 'pi-agent', 'legacy-sessions');

    mkdirSync(dirname(runtimeSessionsPath), { recursive: true });
    mkdirSync(wrongTarget, { recursive: true });
    symlinkSync('../sync/pi-agent/legacy-sessions', runtimeSessionsPath, 'dir');

    await preparePiAgentDir({ statePaths });
    const expectedTarget = getDurableSessionsDir(root);
    expect(resolve(dirname(runtimeSessionsPath), readlinkSync(runtimeSessionsPath))).toBe(expectedTarget);

    const firstReadlink = readlinkSync(runtimeSessionsPath);
    await preparePiAgentDir({ statePaths });

    expect(readlinkSync(runtimeSessionsPath)).toBe(firstReadlink);
    expect(resolve(dirname(runtimeSessionsPath), readlinkSync(runtimeSessionsPath))).toBe(expectedTarget);
  });
});
