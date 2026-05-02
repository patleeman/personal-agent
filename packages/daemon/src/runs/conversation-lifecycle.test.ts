import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  canReopenConversation,
  type ConversationRecord,
  deriveConversationState,
  getConversationCloseAction,
  listConversationRecords,
  readConversationRecord,
  resolveConversationRecordPath,
  shouldAutoReopen,
  writeConversationRecord,
} from './conversation-lifecycle.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('conversation lifecycle helpers', () => {
  it('resolves conversation record paths under the profile conversation-memory directory', () => {
    expect(resolveConversationRecordPath('/state-root', 'assistant', 'conv-123')).toBe(
      join('/state-root', 'pi-agent', 'state', 'conversation-memory', 'assistant', 'conv-123.json'),
    );
  });

  it('returns null for missing or unreadable conversation records', () => {
    const stateRoot = createTempDir('conversation-lifecycle-');
    expect(readConversationRecord(stateRoot, 'assistant', 'missing')).toBeNull();

    const invalidPath = resolveConversationRecordPath(stateRoot, 'assistant', 'broken');
    mkdirSync(join(invalidPath, '..'), { recursive: true });
    writeFileSync(invalidPath, '{not json', 'utf-8');

    expect(readConversationRecord(stateRoot, 'assistant', 'broken')).toBeNull();
  });

  it('reads legacy conversation metadata and normalizes ids and child arrays', () => {
    const stateRoot = createTempDir('conversation-lifecycle-');
    const path = resolveConversationRecordPath(stateRoot, 'assistant', 'fallback-id');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        {
          id: 'legacy-id',
          state: 'dormant',
          createdAt: '2026-04-09T10:00:00.000Z',
          updatedAt: '2026-04-09T11:00:00.000Z',
          latestConversationTitle: 'Legacy title',
          latestAnchorPreview: 'Legacy summary',
          relatedProjectIds: [123, 'project-2'],
          childRunIds: [456, 'run-2'],
          parentId: 'parent-1',
        },
        null,
        2,
      ),
      'utf-8',
    );

    expect(readConversationRecord(stateRoot, 'assistant', 'fallback-id')).toEqual({
      id: 'legacy-id',
      state: 'dormant',
      createdAt: '2026-04-09T10:00:00.000Z',
      updatedAt: '2026-04-09T11:00:00.000Z',
      title: 'Legacy title',
      summary: 'Legacy summary',
      relatedProjectIds: ['123', 'project-2'],
      childRunIds: ['456', 'run-2'],
      parentId: 'parent-1',
    });
  });

  it('falls back to defaults when optional record fields are missing', () => {
    const stateRoot = createTempDir('conversation-lifecycle-');
    const path = resolveConversationRecordPath(stateRoot, 'assistant', 'conv-fallback');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({}), 'utf-8');

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T12:34:56.000Z'));

    expect(readConversationRecord(stateRoot, 'assistant', 'conv-fallback')).toEqual({
      id: 'conv-fallback',
      state: 'open',
      createdAt: '2026-04-10T12:34:56.000Z',
      updatedAt: '2026-04-10T12:34:56.000Z',
      title: undefined,
      summary: undefined,
      relatedProjectIds: [],
      childRunIds: [],
      parentId: undefined,
    });
  });

  it('falls back to valid timestamps when record dates are malformed', () => {
    const stateRoot = createTempDir('conversation-lifecycle-');
    const path = resolveConversationRecordPath(stateRoot, 'assistant', 'conv-invalid-time');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        createdAt: 'not-a-date',
        updatedAt: 'also-not-a-date',
      }),
      'utf-8',
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T12:34:56.000Z'));

    expect(readConversationRecord(stateRoot, 'assistant', 'conv-invalid-time')).toEqual(
      expect.objectContaining({
        createdAt: '2026-04-10T12:34:56.000Z',
        updatedAt: '2026-04-10T12:34:56.000Z',
      }),
    );
  });

  it('falls back to valid timestamps when record dates are non-ISO', () => {
    const stateRoot = createTempDir('conversation-lifecycle-');
    const path = resolveConversationRecordPath(stateRoot, 'assistant', 'conv-non-iso-time');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        createdAt: '1',
        updatedAt: '1',
      }),
      'utf-8',
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T12:34:56.000Z'));

    expect(readConversationRecord(stateRoot, 'assistant', 'conv-non-iso-time')).toEqual(
      expect.objectContaining({
        createdAt: '2026-04-10T12:34:56.000Z',
        updatedAt: '2026-04-10T12:34:56.000Z',
      }),
    );
  });

  it('writes records and preserves optional metadata fields', () => {
    const stateRoot = createTempDir('conversation-lifecycle-');
    const record: ConversationRecord = {
      id: 'conv-write',
      state: 'open',
      createdAt: '2026-04-09T10:00:00.000Z',
      updatedAt: '2026-04-09T11:00:00.000Z',
      title: 'Tracking run',
      summary: 'Most recent anchor preview',
      relatedProjectIds: ['project-1'],
      childRunIds: ['run-1', 'run-2'],
      parentId: 'parent-1',
    };

    writeConversationRecord(stateRoot, 'assistant', record);

    const path = resolveConversationRecordPath(stateRoot, 'assistant', 'conv-write');
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({
      version: 1,
      conversationId: 'conv-write',
      state: 'open',
      createdAt: '2026-04-09T10:00:00.000Z',
      updatedAt: '2026-04-09T11:00:00.000Z',
      latestConversationTitle: 'Tracking run',
      latestAnchorPreview: 'Most recent anchor preview',
      relatedProjectIds: ['project-1'],
      childRunIds: ['run-1', 'run-2'],
      parentId: 'parent-1',
    });
  });

  it('omits optional fields that are not present when writing records', () => {
    const stateRoot = createTempDir('conversation-lifecycle-');
    writeConversationRecord(stateRoot, 'assistant', {
      id: 'conv-minimal',
      state: 'closed',
      createdAt: '2026-04-09T10:00:00.000Z',
      updatedAt: '2026-04-09T11:00:00.000Z',
      relatedProjectIds: [],
      childRunIds: [],
    });

    const path = resolveConversationRecordPath(stateRoot, 'assistant', 'conv-minimal');
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({
      version: 1,
      conversationId: 'conv-minimal',
      state: 'closed',
      createdAt: '2026-04-09T10:00:00.000Z',
      updatedAt: '2026-04-09T11:00:00.000Z',
      relatedProjectIds: [],
      childRunIds: [],
    });
  });

  it('lists only readable json conversation records for a profile', () => {
    const stateRoot = createTempDir('conversation-lifecycle-');
    const profileDir = join(stateRoot, 'pi-agent', 'state', 'conversation-memory', 'assistant');
    mkdirSync(profileDir, { recursive: true });

    writeFileSync(
      join(profileDir, 'good.json'),
      JSON.stringify({
        conversationId: 'good',
        state: 'open',
        createdAt: '2026-04-09T10:00:00.000Z',
        updatedAt: '2026-04-09T11:00:00.000Z',
        relatedProjectIds: [],
        childRunIds: ['run-1'],
      }),
      'utf-8',
    );
    writeFileSync(join(profileDir, 'bad.json'), '{nope', 'utf-8');
    writeFileSync(join(profileDir, 'notes.txt'), 'ignore me', 'utf-8');
    mkdirSync(join(profileDir, 'nested'), { recursive: true });

    expect(listConversationRecords(stateRoot, 'assistant')).toEqual([
      {
        id: 'good',
        state: 'open',
        createdAt: '2026-04-09T10:00:00.000Z',
        updatedAt: '2026-04-09T11:00:00.000Z',
        title: undefined,
        summary: undefined,
        relatedProjectIds: [],
        childRunIds: ['run-1'],
        parentId: undefined,
      },
    ]);
    expect(listConversationRecords(stateRoot, 'missing-profile')).toEqual([]);
  });

  it('derives close actions and conversation states from child run statuses', () => {
    expect(getConversationCloseAction(true)).toBe('soft');
    expect(getConversationCloseAction(false)).toBe('hard');

    expect(deriveConversationState([])).toBe('closed');
    expect(deriveConversationState(['queued', 'waiting'])).toBe('dormant');
    expect(deriveConversationState(['completed', 'running'])).toBe('open');
    expect(deriveConversationState(['recovering'])).toBe('open');
    expect(deriveConversationState(['completed', 'failed', 'cancelled'])).toBe('closed');
  });

  it('allows reopening dormant or closed conversations and only auto-reopens dormant ones', () => {
    expect(canReopenConversation({ state: 'open' } as ConversationRecord)).toBe(false);
    expect(canReopenConversation({ state: 'dormant' } as ConversationRecord)).toBe(true);
    expect(canReopenConversation({ state: 'closed' } as ConversationRecord)).toBe(true);

    expect(shouldAutoReopen({ state: 'open' } as ConversationRecord)).toBe(false);
    expect(shouldAutoReopen({ state: 'closed' } as ConversationRecord)).toBe(false);
    expect(shouldAutoReopen({ state: 'dormant' } as ConversationRecord)).toBe(true);
  });
});
