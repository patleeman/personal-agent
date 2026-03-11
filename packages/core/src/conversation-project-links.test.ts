import { existsSync, mkdtempSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addConversationProjectLink,
  getConversationProjectLink,
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

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-conversation-links-'));
  tempDirs.push(dir);
  return dir;
}

describe('conversation link paths', () => {
  it('resolves the profile-scoped conversations directory', () => {
    const repo = createTempRepo();
    expect(resolveProfileConversationLinksDir({ repoRoot: repo, profile: 'assistant' }))
      .toBe(join(repo, 'profiles', 'assistant', 'agent', 'conversations'));
  });

  it('resolves a conversation link path', () => {
    const repo = createTempRepo();
    expect(resolveConversationLinkPath({ repoRoot: repo, profile: 'assistant', conversationId: 'conv-123' }))
      .toBe(join(repo, 'profiles', 'assistant', 'agent', 'conversations', 'conv-123.json'));
  });

  it('rejects invalid conversation ids', () => {
    expect(() => validateConversationId('bad/id')).toThrow('Invalid conversation id');
  });
});

describe('conversation project links', () => {
  it('writes and reads a conversation project link document', () => {
    const repo = createTempRepo();

    setConversationProjectLinks({
      repoRoot: repo,
      profile: 'assistant',
      conversationId: 'conv-123',
      relatedProjectIds: ['web-ui', 'artifact-model'],
      updatedAt: '2026-03-10T20:00:00.000Z',
    });

    const stored = getConversationProjectLink({
      repoRoot: repo,
      profile: 'assistant',
      conversationId: 'conv-123',
    });

    expect(stored).toEqual({
      conversationId: 'conv-123',
      updatedAt: '2026-03-10T20:00:00.000Z',
      relatedProjectIds: ['web-ui', 'artifact-model'],
    });
  });

  it('adds links idempotently and keeps the file on disk', () => {
    const repo = createTempRepo();

    addConversationProjectLink({ repoRoot: repo, profile: 'assistant', conversationId: 'conv-123', projectId: 'web-ui', updatedAt: '2026-03-10T20:00:00.000Z' });
    addConversationProjectLink({ repoRoot: repo, profile: 'assistant', conversationId: 'conv-123', projectId: 'web-ui', updatedAt: '2026-03-10T20:01:00.000Z' });
    addConversationProjectLink({ repoRoot: repo, profile: 'assistant', conversationId: 'conv-123', projectId: 'artifact-model', updatedAt: '2026-03-10T20:02:00.000Z' });

    const path = resolveConversationLinkPath({ repoRoot: repo, profile: 'assistant', conversationId: 'conv-123' });
    expect(existsSync(path)).toBe(true);
    expect(getConversationProjectLink({ repoRoot: repo, profile: 'assistant', conversationId: 'conv-123' }))
      .toEqual({
        conversationId: 'conv-123',
        updatedAt: '2026-03-10T20:02:00.000Z',
        relatedProjectIds: ['web-ui', 'artifact-model'],
      });
  });

  it('removes a project link and leaves an empty durable record when none remain', () => {
    const repo = createTempRepo();

    setConversationProjectLinks({
      repoRoot: repo,
      profile: 'assistant',
      conversationId: 'conv-123',
      relatedProjectIds: ['web-ui'],
      updatedAt: '2026-03-10T20:00:00.000Z',
    });

    const updated = removeConversationProjectLink({
      repoRoot: repo,
      profile: 'assistant',
      conversationId: 'conv-123',
      projectId: 'web-ui',
      updatedAt: '2026-03-10T20:05:00.000Z',
    });

    expect(updated).toEqual({
      conversationId: 'conv-123',
      updatedAt: '2026-03-10T20:05:00.000Z',
      relatedProjectIds: [],
    });
    expect(getConversationProjectLink({ repoRoot: repo, profile: 'assistant', conversationId: 'conv-123' }))
      .toEqual(updated);
  });
});
