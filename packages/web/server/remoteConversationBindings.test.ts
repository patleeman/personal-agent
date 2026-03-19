import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getRemoteConversationBinding,
  resolveRemoteConversationBindingPath,
  setRemoteConversationBinding,
} from './remoteConversationBindings.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('remote conversation bindings', () => {
  it('persists remote session metadata for one conversation', () => {
    const stateRoot = createTempDir('pa-remote-conversation-binding-');

    const saved = setRemoteConversationBinding({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-123',
      targetId: 'gpu-box',
      remoteCwd: '/srv/workspace',
      localSessionFile: '/tmp/local-session.jsonl',
      remoteSessionFile: '/home/bits/.local/state/personal-agent/pi-agent/sessions/remote.jsonl',
      updatedAt: '2026-03-19T18:10:00.000Z',
    });

    expect(resolveRemoteConversationBindingPath({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-123',
    })).toContain('remote-conversations');

    expect(saved).toEqual({
      version: 1,
      conversationId: 'conv-123',
      targetId: 'gpu-box',
      remoteCwd: '/srv/workspace',
      localSessionFile: '/tmp/local-session.jsonl',
      remoteSessionFile: '/home/bits/.local/state/personal-agent/pi-agent/sessions/remote.jsonl',
      updatedAt: '2026-03-19T18:10:00.000Z',
    });

    expect(getRemoteConversationBinding({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-123',
    })).toEqual(saved);
  });
});
