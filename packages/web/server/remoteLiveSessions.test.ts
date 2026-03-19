import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalMirrorSession } from './remoteLiveSessions.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_STATE_ROOT: createTempDir('pa-remote-live-state-'),
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('remote live sessions', () => {
  it('creates a persisted local mirror session with the remote cwd', async () => {
    const result = await createLocalMirrorSession({ remoteCwd: '/home/bits/project' });

    expect(result.id).toBeTruthy();
    expect(existsSync(result.sessionFile)).toBe(true);
    expect(readFileSync(result.sessionFile, 'utf-8')).toContain('/home/bits/project');
  });
});
