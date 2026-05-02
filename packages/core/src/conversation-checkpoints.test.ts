import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteConversationCheckpoint,
  getConversationCheckpoint,
  listConversationCheckpoints,
  resolveConversationCheckpointMetaPath,
  resolveConversationCheckpointSnapshotFile,
  resolveConversationCheckpointSnapshotPath,
  resolveConversationCheckpointSnapshotsDir,
  resolveProfileConversationCheckpointsDir,
  saveConversationCheckpoint,
  validateConversationCheckpointId,
} from './conversation-checkpoints.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempStateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-conversation-checkpoints-'));
  tempDirs.push(dir);
  return dir;
}

describe('conversation checkpoint paths', () => {
  it('resolves profile checkpoint directories and files', () => {
    const stateRoot = createTempStateRoot();

    expect(resolveProfileConversationCheckpointsDir({ stateRoot, profile: 'datadog' }))
      .toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-checkpoints', 'datadog'));

    expect(resolveConversationCheckpointSnapshotsDir({ stateRoot, profile: 'datadog' }))
      .toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-checkpoints', 'datadog', 'snapshots'));

    expect(resolveConversationCheckpointMetaPath({ stateRoot, profile: 'datadog', checkpointId: 'ckpt-1' }))
      .toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-checkpoints', 'datadog', 'meta', 'ckpt-1.json'));

    expect(resolveConversationCheckpointSnapshotPath({ stateRoot, profile: 'datadog', checkpointId: 'ckpt-1' }))
      .toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-checkpoints', 'datadog', 'snapshots', 'ckpt-1.jsonl'));
  });

  it('rejects invalid checkpoint ids', () => {
    expect(() => validateConversationCheckpointId('bad/id')).toThrow('Invalid checkpoint id');
  });
});

describe('conversation checkpoint storage', () => {
  it('creates and lists checkpoints, with source filtering', () => {
    const stateRoot = createTempStateRoot();

    const first = saveConversationCheckpoint({
      stateRoot,
      profile: 'datadog',
      checkpointId: 'ckpt-alpha',
      title: 'Before strategy split',
      note: 'keep as baseline',
      source: {
        conversationId: 'conv-123',
        conversationTitle: 'Auth debugging',
        cwd: '/tmp/workspace',
        relatedProjectIds: ['auth-platform'],
      },
      anchor: {
        messageId: 'msg-3',
        role: 'assistant',
        timestamp: '2026-03-13T17:00:00.000Z',
        preview: 'Summarized the current plan.',
      },
      snapshotContent: [
        JSON.stringify({ type: 'session', id: 'conv-123', timestamp: '2026-03-13T16:50:00.000Z', cwd: '/tmp/workspace' }),
        JSON.stringify({ type: 'message', id: 'msg-1', message: { role: 'user', content: [{ type: 'text', text: 'one' }] } }),
        JSON.stringify({ type: 'message', id: 'msg-2', message: { role: 'assistant', content: [{ type: 'text', text: 'two' }] } }),
        JSON.stringify({ type: 'message', id: 'msg-3', message: { role: 'assistant', content: [{ type: 'text', text: 'three' }] } }),
      ].join('\n'),
      snapshotMessageCount: 3,
      updatedAt: '2026-03-13T17:00:00.000Z',
    });

    const second = saveConversationCheckpoint({
      stateRoot,
      profile: 'datadog',
      checkpointId: 'ckpt-beta',
      title: 'Different conversation checkpoint',
      source: {
        conversationId: 'conv-456',
        relatedProjectIds: [],
      },
      anchor: {
        messageId: 'msg-9',
        role: 'user',
        timestamp: '2026-03-13T17:10:00.000Z',
        preview: 'Try another approach',
      },
      snapshotContent: [
        JSON.stringify({ type: 'session', id: 'conv-456', timestamp: '2026-03-13T17:05:00.000Z', cwd: '/tmp/other' }),
        JSON.stringify({ type: 'message', id: 'msg-9', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } }),
      ].join('\n'),
      snapshotMessageCount: 1,
      updatedAt: '2026-03-13T17:10:00.000Z',
    });

    expect(first.snapshot.messageCount).toBe(3);
    expect(first.snapshot.lineCount).toBe(4);
    expect(first.snapshot.bytes).toBeGreaterThan(20);
    expect(first.snapshotMissing).toBe(false);

    expect(resolveConversationCheckpointSnapshotFile({
      stateRoot,
      profile: 'datadog',
      checkpoint: first,
    })).toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-checkpoints', 'datadog', 'snapshots', 'ckpt-alpha.jsonl'));

    expect(listConversationCheckpoints({ stateRoot, profile: 'datadog' }).map((checkpoint) => checkpoint.id))
      .toEqual([second.id, first.id]);

    expect(listConversationCheckpoints({ stateRoot, profile: 'datadog', conversationId: 'conv-123' }).map((checkpoint) => checkpoint.id))
      .toEqual([first.id]);
  });

  it('reports missing snapshots and deletes checkpoints with snapshot files', () => {
    const stateRoot = createTempStateRoot();

    saveConversationCheckpoint({
      stateRoot,
      profile: 'datadog',
      checkpointId: 'ckpt-cleanup',
      title: 'Cleanup checkpoint',
      source: {
        conversationId: 'conv-123',
        relatedProjectIds: [],
      },
      anchor: {
        messageId: 'msg-1',
        role: 'user',
        timestamp: '2026-03-13T17:00:00.000Z',
        preview: 'hello',
      },
      snapshotContent: [
        JSON.stringify({ type: 'session', id: 'conv-123', timestamp: '2026-03-13T16:50:00.000Z', cwd: '/tmp/workspace' }),
        JSON.stringify({ type: 'message', id: 'msg-1', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } }),
      ].join('\n'),
      snapshotMessageCount: 1,
    });

    const snapshotPath = resolveConversationCheckpointSnapshotPath({
      stateRoot,
      profile: 'datadog',
      checkpointId: 'ckpt-cleanup',
    });

    rmSync(snapshotPath, { force: true });

    const missingSnapshot = getConversationCheckpoint({
      stateRoot,
      profile: 'datadog',
      checkpointId: 'ckpt-cleanup',
    });

    expect(missingSnapshot?.snapshotMissing).toBe(true);

    expect(deleteConversationCheckpoint({
      stateRoot,
      profile: 'datadog',
      checkpointId: 'ckpt-cleanup',
    })).toBe(true);

    expect(getConversationCheckpoint({
      stateRoot,
      profile: 'datadog',
      checkpointId: 'ckpt-cleanup',
    })).toBeNull();
  });
});
