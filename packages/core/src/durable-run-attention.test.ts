import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isDurableRunAttentionDismissed,
  loadDurableRunAttentionState,
  markDurableRunAttentionRead,
  markDurableRunAttentionUnread,
  resolveDurableRunAttentionStatePath,
} from './durable-run-attention.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('durable run attention state', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('tracks reviewed signatures per run id', () => {
    const stateRoot = createTempDir('durable-run-attention-');
    const statePath = resolveDurableRunAttentionStatePath({ stateRoot });

    expect(loadDurableRunAttentionState({ stateRoot })).toEqual({
      version: 1,
      runs: {},
    });

    markDurableRunAttentionRead({
      stateRoot,
      runId: 'run-123',
      attentionSignature: '{"status":"failed"}',
      readAt: '2026-03-24T12:00:00.000Z',
    });

    expect(statePath).toContain('durable-run-attention.json');
    expect(isDurableRunAttentionDismissed({
      stateRoot,
      runId: 'run-123',
      attentionSignature: '{"status":"failed"}',
    })).toBe(true);
    expect(isDurableRunAttentionDismissed({
      stateRoot,
      runId: 'run-123',
      attentionSignature: '{"status":"failed","attempt":2}',
    })).toBe(false);
  });

  it('can clear a reviewed run so the same signature surfaces again', () => {
    const stateRoot = createTempDir('durable-run-attention-');

    markDurableRunAttentionRead({
      stateRoot,
      runId: 'run-123',
      attentionSignature: '{"status":"failed"}',
      readAt: '2026-03-24T12:00:00.000Z',
    });

    markDurableRunAttentionUnread({
      stateRoot,
      runId: 'run-123',
    });

    expect(isDurableRunAttentionDismissed({
      stateRoot,
      runId: 'run-123',
      attentionSignature: '{"status":"failed"}',
    })).toBe(false);
  });
});
