import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalMirrorSession,
  forkLocalMirrorSession,
  notifyRemoteConversationConnectionChanged,
  subscribeRemoteConversationConnection,
} from './remoteLiveSessions.js';

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
  it('notifies only listeners for the matching conversation', () => {
    const matchingListener = vi.fn();
    const otherListener = vi.fn();

    const unsubscribeMatching = subscribeRemoteConversationConnection('conv-1', matchingListener);
    const unsubscribeOther = subscribeRemoteConversationConnection('conv-2', otherListener);

    notifyRemoteConversationConnectionChanged('conv-1');

    expect(matchingListener).toHaveBeenCalledTimes(1);
    expect(otherListener).not.toHaveBeenCalled();

    unsubscribeOther();
    unsubscribeMatching();
  });

  it('creates a persisted local mirror session with the remote cwd', async () => {
    const result = await createLocalMirrorSession({ remoteCwd: '/home/bits/project' });

    expect(result.id).toBeTruthy();
    expect(existsSync(result.sessionFile)).toBe(true);
    expect(readFileSync(result.sessionFile, 'utf-8')).toContain('/home/bits/project');
  });

  it('forks a local mirror session into a new remote cwd', async () => {
    const original = await createLocalMirrorSession({ remoteCwd: '/home/bits/project' });
    const forked = forkLocalMirrorSession({
      sessionFile: original.sessionFile,
      remoteCwd: '/srv/other-project',
    });

    expect(forked.id).not.toBe(original.id);
    expect(existsSync(forked.sessionFile)).toBe(true);

    const content = readFileSync(forked.sessionFile, 'utf-8');
    expect(content).toContain('/srv/other-project');
    expect(content.match(/"type":"session"/g)?.length).toBe(1);
  });
});
