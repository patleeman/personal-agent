import { mkdtempSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getConversationExecutionTarget,
  resolveConversationExecutionTargetPath,
  setConversationExecutionTarget,
} from './conversation-execution-targets.js';

const tempDirs: string[] = [];

function createTempStateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-core-conversation-execution-'));
  tempDirs.push(dir);
  return dir;
}

describe('conversation execution targets', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('stores and reads a per-conversation remote execution target', () => {
    const stateRoot = createTempStateRoot();

    const saved = setConversationExecutionTarget({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      targetId: 'gpu-box',
      updatedAt: '2026-03-19T15:20:00.000Z',
    });

    expect(resolveConversationExecutionTargetPath({ stateRoot, profile: 'assistant', conversationId: 'conv-123' })).toContain('conv-123.json');
    expect(saved).toEqual({
      conversationId: 'conv-123',
      targetId: 'gpu-box',
      updatedAt: '2026-03-19T15:20:00.000Z',
    });
    expect(getConversationExecutionTarget({ stateRoot, profile: 'assistant', conversationId: 'conv-123' })).toEqual(saved);
  });

  it('clears the stored target when switching a conversation back to local execution', () => {
    const stateRoot = createTempStateRoot();

    setConversationExecutionTarget({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      targetId: 'gpu-box',
    });

    expect(setConversationExecutionTarget({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      targetId: null,
    })).toBeNull();
    expect(getConversationExecutionTarget({ stateRoot, profile: 'assistant', conversationId: 'conv-123' })).toBeNull();
  });
});
