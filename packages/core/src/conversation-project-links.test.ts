import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  addConversationProjectLink,
  getConversationProjectLink,
  listConversationProjectLinks,
  removeConversationProjectLink,
  resolveConversationLinkPath,
  resolveProfileConversationLinksDir,
  setConversationProjectLinks,
  validateConversationId,
} from './conversation-project-links.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('conversation link paths', () => {
  it('resolves the profile-scoped conversations directory under local runtime state', () => {
    const stateRoot = createTempDir('personal-agent-conversation-links-state-');
    expect(resolveProfileConversationLinksDir({ stateRoot, profile: 'assistant' })).toBe(
      join(stateRoot, 'pi-agent', 'state', 'conversation-project-links', 'assistant'),
    );
  });

  it('resolves a conversation link path under local runtime state', () => {
    const stateRoot = createTempDir('personal-agent-conversation-links-state-');
    expect(resolveConversationLinkPath({ stateRoot, profile: 'assistant', conversationId: 'conv-123' })).toBe(
      join(stateRoot, 'pi-agent', 'state', 'conversation-project-links', 'assistant', 'conv-123.json'),
    );
  });

  it('rejects invalid conversation ids', () => {
    expect(() => validateConversationId('bad/id')).toThrow('Invalid conversation id');
  });
});

describe('conversation project links', () => {
  it('writes and reads a conversation project link document', () => {
    const stateRoot = createTempDir('personal-agent-conversation-links-state-');

    setConversationProjectLinks({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      relatedProjectIds: ['desktop-ui', 'artifact-model'],
      updatedAt: '2026-03-10T20:00:00.000Z',
    });

    const stored = getConversationProjectLink({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
    });

    expect(stored).toEqual({
      conversationId: 'conv-123',
      updatedAt: '2026-03-10T20:00:00.000Z',
      relatedProjectIds: ['desktop-ui', 'artifact-model'],
    });
  });

  it('adds links idempotently and keeps the file on disk', () => {
    const stateRoot = createTempDir('personal-agent-conversation-links-state-');

    addConversationProjectLink({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      projectId: 'desktop-ui',
      updatedAt: '2026-03-10T20:00:00.000Z',
    });
    addConversationProjectLink({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      projectId: 'desktop-ui',
      updatedAt: '2026-03-10T20:01:00.000Z',
    });
    addConversationProjectLink({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      projectId: 'artifact-model',
      updatedAt: '2026-03-10T20:02:00.000Z',
    });

    const path = resolveConversationLinkPath({ stateRoot, profile: 'assistant', conversationId: 'conv-123' });
    expect(existsSync(path)).toBe(true);
    expect(getConversationProjectLink({ stateRoot, profile: 'assistant', conversationId: 'conv-123' })).toEqual({
      conversationId: 'conv-123',
      updatedAt: '2026-03-10T20:02:00.000Z',
      relatedProjectIds: ['desktop-ui', 'artifact-model'],
    });
  });

  it('removes a project link and leaves an empty durable record when none remain', () => {
    const stateRoot = createTempDir('personal-agent-conversation-links-state-');

    setConversationProjectLinks({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      relatedProjectIds: ['desktop-ui'],
      updatedAt: '2026-03-10T20:00:00.000Z',
    });

    const updated = removeConversationProjectLink({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      projectId: 'desktop-ui',
      updatedAt: '2026-03-10T20:05:00.000Z',
    });

    expect(updated).toEqual({
      conversationId: 'conv-123',
      updatedAt: '2026-03-10T20:05:00.000Z',
      relatedProjectIds: [],
    });
    expect(getConversationProjectLink({ stateRoot, profile: 'assistant', conversationId: 'conv-123' })).toEqual(updated);
  });

  it('returns null instead of throwing when a conversation link file is malformed', () => {
    const stateRoot = createTempDir('personal-agent-conversation-links-state-');

    setConversationProjectLinks({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      relatedProjectIds: ['desktop-ui'],
      updatedAt: '2026-03-10T20:00:00.000Z',
    });

    writeFileSync(
      resolveConversationLinkPath({ stateRoot, profile: 'assistant', conversationId: 'conv-123' }),
      '{"conversationId":"conv-123"',
    );

    expect(getConversationProjectLink({ stateRoot, profile: 'assistant', conversationId: 'conv-123' })).toBeNull();
  });

  it('skips malformed conversation link files when listing links', () => {
    const stateRoot = createTempDir('personal-agent-conversation-links-state-');

    setConversationProjectLinks({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      relatedProjectIds: ['desktop-ui'],
      updatedAt: '2026-03-10T20:00:00.000Z',
    });
    writeFileSync(
      resolveConversationLinkPath({ stateRoot, profile: 'assistant', conversationId: 'conv-456' }),
      '{"conversationId":"conv-456"',
    );

    expect(listConversationProjectLinks({ stateRoot, profile: 'assistant' })).toEqual([
      {
        conversationId: 'conv-123',
        updatedAt: '2026-03-10T20:00:00.000Z',
        relatedProjectIds: ['desktop-ui'],
      },
    ]);
  });
});
