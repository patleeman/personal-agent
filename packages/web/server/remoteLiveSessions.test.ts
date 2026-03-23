import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalMirrorSession,
  forkLocalMirrorSession,
  notifyRemoteConversationConnectionChanged,
  remoteRegistry,
  subscribeRemoteConversationConnection,
  subscribeRemoteLiveSession,
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
  remoteRegistry.clear();
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

  it('refreshes remote queued prompt state on subscribe', async () => {
    const mirror = await createLocalMirrorSession({ remoteCwd: '/home/bits/project' });
    const events: Array<Record<string, unknown>> = [];

    remoteRegistry.set('conv-remote', {
      conversationId: 'conv-remote',
      profile: 'datadog',
      target: {
        id: 'gpu-box',
        label: 'GPU Box',
        transport: 'ssh',
        sshDestination: 'patrick@gpu-box',
        cwdMappings: [],
        createdAt: '2026-03-23T00:00:00.000Z',
        updatedAt: '2026-03-23T00:00:00.000Z',
      },
      remoteCwd: '/home/bits/project',
      localSessionFile: mirror.sessionFile,
      rpc: {
        child: {} as never,
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        getState: vi.fn(async () => ({ pendingMessageCount: 2 })),
        prompt: vi.fn(async () => undefined),
        steer: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
        onEvent: vi.fn(() => () => {}),
        onExit: vi.fn(() => () => {}),
      },
      listeners: new Set(),
      isStreaming: false,
      pendingMessageCount: 0,
    });

    subscribeRemoteLiveSession('conv-remote', (event) => {
      events.push(event as Record<string, unknown>);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toContainEqual({
      type: 'queue_state',
      steering: [],
      followUp: [{
        id: 'remote-pending',
        text: '2 queued remote prompts',
        imageCount: 0,
        restorable: false,
      }],
    });
  });
});
