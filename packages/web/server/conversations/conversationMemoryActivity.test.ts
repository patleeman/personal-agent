import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getActivityConversationLink, listProfileActivityEntries } from '@personal-agent/core';
import {
  writeConversationMemoryDistillActivity,
  writeConversationMemoryDistillFailureActivity,
} from './conversationMemoryActivity.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('conversation memory activity', () => {
  it('writes a success activity and links it to the source conversation', () => {
    const stateRoot = createTempDir('pa-web-memory-activity-');

    const activityId = writeConversationMemoryDistillActivity({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      kind: 'conversation-node-distilled',
      summary: 'Created note reference in @team-preferences',
      details: 'Created a new note reference from this conversation.',
      relatedProjectIds: ['project-alpha'],
    });

    const entries = listProfileActivityEntries({ stateRoot, profile: 'assistant' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry).toMatchObject({
      id: activityId,
      kind: 'conversation-node-distilled',
      summary: 'Created note reference in @team-preferences',
      details: 'Created a new note reference from this conversation.',
      relatedProjectIds: ['project-alpha'],
      profile: 'assistant',
    });
    expect(getActivityConversationLink({ stateRoot, profile: 'assistant', activityId }))
      .toEqual(expect.objectContaining({ relatedConversationIds: ['conv-123'] }));
  });

  it('writes a failure activity with the distillation error', () => {
    const stateRoot = createTempDir('pa-web-memory-activity-');

    const activityId = writeConversationMemoryDistillFailureActivity({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-456',
      error: 'runner missing',
      relatedProjectIds: ['project-beta'],
    });

    const entries = listProfileActivityEntries({ stateRoot, profile: 'assistant' });
    expect(entries[0]?.entry).toMatchObject({
      id: activityId,
      kind: 'conversation-node-distill-failed',
      summary: 'Conversation node distillation failed',
      details: 'Distillation failed for this conversation.\nError: runner missing',
      relatedProjectIds: ['project-beta'],
    });
    expect(getActivityConversationLink({ stateRoot, profile: 'assistant', activityId }))
      .toEqual(expect.objectContaining({ relatedConversationIds: ['conv-456'] }));
  });
});
