import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDeferredFollowUpState,
  loadDeferredFollowUpState,
  saveDeferredFollowUpState,
  type DeferredFollowUpStateFile,
} from './deferred-followups-store.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('deferred-followups-store', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('creates an empty state shape', () => {
    expect(createEmptyDeferredFollowUpState()).toEqual({
      version: 1,
      followUps: {},
    });
  });

  it('returns empty state when file does not exist', () => {
    const path = join(createTempDir('deferred-store-missing-'), 'deferred-followups-state.json');

    expect(loadDeferredFollowUpState(path)).toEqual({
      version: 1,
      followUps: {},
    });
  });

  it('returns empty state and warns when JSON parsing fails', () => {
    const dir = createTempDir('deferred-store-invalid-json-');
    const path = join(dir, 'deferred-followups-state.json');
    writeFileSync(path, '{invalid json');

    const warn = vi.fn();
    const loaded = loadDeferredFollowUpState(path, { warn });

    expect(loaded).toEqual({
      version: 1,
      followUps: {},
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('deferred follow-up state load failed');
  });

  it('sanitizes loaded records and resets queued items to scheduled', () => {
    const dir = createTempDir('deferred-store-load-');
    const path = join(dir, 'deferred-followups-state.json');

    writeFileSync(path, JSON.stringify({
      version: 1,
      followUps: {
        valid: {
          id: 'valid',
          gateway: 'telegram',
          conversationId: '1::thread:22',
          sessionFile: '/tmp/sessions/1.thread-22.jsonl',
          prompt: 'Resume now',
          dueAt: '2026-03-08T12:00:00.000Z',
          createdAt: '2026-03-08T11:50:00.000Z',
          status: 'queued',
          queuedAt: '2026-03-08T12:00:00.000Z',
          attempts: 2,
          initiatedByUserId: '42',
          telegramChatType: 'supergroup',
        },
        malformed: {
          id: 'bad',
          gateway: 'telegram',
          conversationId: '1',
          sessionFile: '/tmp/sessions/1.jsonl',
          prompt: 'Resume',
          dueAt: 'not-a-date',
        },
      },
    }, null, 2));

    const loaded = loadDeferredFollowUpState(path);

    expect(Object.keys(loaded.followUps)).toEqual(['valid']);
    expect(loaded.followUps.valid).toMatchObject({
      id: 'valid',
      status: 'scheduled',
      queuedAt: undefined,
      attempts: 2,
      initiatedByUserId: '42',
      telegramChatType: 'supergroup',
    });
  });

  it('saves state files and creates parent directories', () => {
    const dir = createTempDir('deferred-store-save-');
    const path = join(dir, 'nested', 'state', 'deferred-followups-state.json');

    const state: DeferredFollowUpStateFile = {
      version: 1,
      followUps: {
        resume: {
          id: 'resume',
          gateway: 'discord',
          conversationId: 'channel-1',
          sessionFile: '/tmp/sessions/channel-1.jsonl',
          prompt: 'Resume and continue.',
          dueAt: '2026-03-08T12:00:00.000Z',
          createdAt: '2026-03-08T11:00:00.000Z',
          status: 'scheduled',
          attempts: 0,
        },
      },
    };

    saveDeferredFollowUpState(path, state);

    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(state);
  });
});
