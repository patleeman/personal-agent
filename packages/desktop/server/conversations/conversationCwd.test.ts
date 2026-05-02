import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveConversationCwd, resolveRequestedCwd } from './conversationCwd.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-cwd-'));
  tempDirs.push(dir);
  process.env.PERSONAL_AGENT_STATE_ROOT = dir;
  process.env.PERSONAL_AGENT_PROFILES_ROOT = join(dir, 'sync', 'profiles');
  return dir;
}

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resolveRequestedCwd', () => {
  it('expands home and resolves relative cwd values', () => {
    expect(resolveRequestedCwd('../workspace', '/tmp/base')).toBe('/tmp/workspace');
    expect(resolveRequestedCwd('~/workspace')).toContain('workspace');
    expect(resolveRequestedCwd('   ')).toBeUndefined();
  });
});

describe('resolveConversationCwd', () => {
  it('prefers an explicit cwd', () => {
    const repoRoot = createTempRepo();

    expect(
      resolveConversationCwd({
        repoRoot,
        profile: 'datadog',
        explicitCwd: '../explicit-worktree',
        defaultCwd: '/tmp/default-cwd',
      }),
    ).toBe(resolve('/tmp/default-cwd', '../explicit-worktree'));
  });

  it('falls back to the default cwd when no explicit cwd is set', () => {
    const repoRoot = createTempRepo();

    expect(
      resolveConversationCwd({
        repoRoot,
        profile: 'datadog',
        defaultCwd: '/tmp/default-cwd',
      }),
    ).toBe('/tmp/default-cwd');
  });
});
