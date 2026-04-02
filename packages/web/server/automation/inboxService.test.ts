import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProjectActivityEntry,
  loadProfileActivityReadState,
  saveProfileActivityReadState,
  setActivityConversationLinks,
  summarizeConversationAttention,
  writeProfileActivityEntry,
} from '@personal-agent/core';
import {
  clearInboxForCurrentProfile,
  listActivityForCurrentProfile,
} from './inboxService.js';

const tempDirs: string[] = [];
const originalStateRoot = process.env.PERSONAL_AGENT_STATE_ROOT;

function createTempStateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-web-inbox-service-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  if (originalStateRoot === undefined) {
    delete process.env.PERSONAL_AGENT_STATE_ROOT;
  } else {
    process.env.PERSONAL_AGENT_STATE_ROOT = originalStateRoot;
  }

  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('inboxService clearInboxForCurrentProfile', () => {
  it('deletes surfaced standalone activity and clears archived conversation attention', () => {
    const stateRoot = createTempStateRoot();
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const standaloneCreatedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const linkedCreatedAt = new Date(Date.now() - 60 * 1000).toISOString();

    writeProfileActivityEntry({
      stateRoot,
      profile: 'assistant',
      entry: createProjectActivityEntry({
        id: 'standalone',
        createdAt: standaloneCreatedAt,
        profile: 'assistant',
        kind: 'follow-up',
        summary: 'Standalone item',
      }),
    });

    writeProfileActivityEntry({
      stateRoot,
      profile: 'assistant',
      entry: createProjectActivityEntry({
        id: 'linked',
        createdAt: linkedCreatedAt,
        profile: 'assistant',
        kind: 'follow-up',
        summary: 'Linked item',
      }),
    });

    setActivityConversationLinks({
      stateRoot,
      profile: 'assistant',
      activityId: 'linked',
      relatedConversationIds: ['conv-1'],
      updatedAt: linkedCreatedAt,
    });

    saveProfileActivityReadState({
      stateRoot,
      profile: 'assistant',
      ids: ['standalone'],
    });

    const result = clearInboxForCurrentProfile({
      profile: 'assistant',
      sessions: [{ id: 'conv-1', messageCount: 4, needsAttention: true }],
      openConversationIds: [],
    });

    expect(result.deletedActivityIds).toEqual(['standalone']);
    expect(result.clearedConversationIds).toEqual(['conv-1']);
    expect(listActivityForCurrentProfile('assistant').map((entry) => entry.id)).toEqual(['linked']);
    expect(loadProfileActivityReadState({ stateRoot, profile: 'assistant' })).toEqual(new Set());

    const attention = summarizeConversationAttention({
      stateRoot,
      profile: 'assistant',
      conversations: [{ conversationId: 'conv-1', messageCount: 4 }],
      unreadActivityEntries: [
        { id: 'linked', createdAt: linkedCreatedAt, relatedConversationIds: ['conv-1'] },
      ],
    });

    expect(attention[0]?.needsAttention).toBe(false);
    expect(attention[0]?.unreadActivityIds).toEqual([]);
  });
});
