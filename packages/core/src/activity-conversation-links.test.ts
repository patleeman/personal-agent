import { existsSync, mkdtempSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearActivityConversationLinks,
  getActivityConversationLink,
  resolveActivityConversationLinkPath,
  resolveProfileActivityConversationLinksDir,
  setActivityConversationLinks,
} from './activity-conversation-links.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('activity conversation link paths', () => {
  it('resolves the profile-scoped activity conversations directory under local runtime state', () => {
    const stateRoot = createTempDir('personal-agent-activity-conversation-links-state-');
    expect(resolveProfileActivityConversationLinksDir({ stateRoot, profile: 'assistant' })).toBe(
      join(stateRoot, 'pi-agent', 'state', 'activity-conversation-links', 'assistant'),
    );
  });

  it('resolves an activity conversation link path under local runtime state', () => {
    const stateRoot = createTempDir('personal-agent-activity-conversation-links-state-');
    expect(resolveActivityConversationLinkPath({ stateRoot, profile: 'assistant', activityId: 'daily-report' })).toBe(
      join(stateRoot, 'pi-agent', 'state', 'activity-conversation-links', 'assistant', 'daily-report.json'),
    );
  });
});

describe('activity conversation links', () => {
  it('writes and reads an activity conversation link document', () => {
    const stateRoot = createTempDir('personal-agent-activity-conversation-links-state-');

    setActivityConversationLinks({
      stateRoot,
      profile: 'assistant',
      activityId: 'daily-report',
      relatedConversationIds: ['conv-123', 'conv-456', 'conv-123'],
      updatedAt: '2026-03-12T11:00:00.000Z',
    });

    expect(getActivityConversationLink({ stateRoot, profile: 'assistant', activityId: 'daily-report' })).toEqual({
      activityId: 'daily-report',
      updatedAt: '2026-03-12T11:00:00.000Z',
      relatedConversationIds: ['conv-123', 'conv-456'],
    });
  });

  it('clears the durable link file when no conversation ids remain', () => {
    const stateRoot = createTempDir('personal-agent-activity-conversation-links-state-');

    setActivityConversationLinks({
      stateRoot,
      profile: 'assistant',
      activityId: 'daily-report',
      relatedConversationIds: ['conv-123'],
      updatedAt: '2026-03-12T11:00:00.000Z',
    });

    const path = resolveActivityConversationLinkPath({ stateRoot, profile: 'assistant', activityId: 'daily-report' });
    expect(existsSync(path)).toBe(true);

    clearActivityConversationLinks({ stateRoot, profile: 'assistant', activityId: 'daily-report' });

    expect(existsSync(path)).toBe(false);
    expect(getActivityConversationLink({ stateRoot, profile: 'assistant', activityId: 'daily-report' })).toBeNull();
  });
});
