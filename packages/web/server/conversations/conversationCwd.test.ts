import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectScaffold } from '@personal-agent/core';
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

function setProjectRepoRoot(documentFile: string, repoRoot: string): void {
  const current = readFileSync(documentFile, 'utf-8');
  if (current.includes(`cwd:${repoRoot}`)) {
    return;
  }
  writeFileSync(documentFile, current.replace(
    '  - type:project\n',
    `  - type:project\n  - cwd:${repoRoot}\n`,
  ));
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
  it('prefers an explicit cwd over referenced project repo roots', () => {
    const repoRoot = createTempRepo();

    expect(resolveConversationCwd({
      repoRoot,
      profile: 'datadog',
      explicitCwd: '../explicit-worktree',
      defaultCwd: '/tmp/default-cwd',
      referencedProjectIds: ['missing-project'],
    })).toBe(resolve('/tmp/default-cwd', '../explicit-worktree'));
  });

  it('inherits cwd from a single referenced project repo root', () => {
    const repoRoot = createTempRepo();
    const scaffold = createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      title: 'Ship the web UI',
      description: 'Ship the web UI',
    });
    setProjectRepoRoot(scaffold.paths.documentFile, '../workspace/web-ui');

    expect(resolveConversationCwd({
      repoRoot,
      profile: 'datadog',
      defaultCwd: '/tmp/default-cwd',
      referencedProjectIds: ['web-ui'],
    })).toBe(resolve(repoRoot, '../workspace/web-ui'));
  });

  it('falls back to the default cwd when referenced projects point at different repo roots', () => {
    const repoRoot = createTempRepo();
    const first = createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      title: 'Ship the web UI',
      description: 'Ship the web UI',
    });
    const second = createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'api',
      title: 'Ship the API',
      description: 'Ship the API',
    });

    setProjectRepoRoot(first.paths.documentFile, '../workspace/web-ui');
    setProjectRepoRoot(second.paths.documentFile, '../workspace/api');

    expect(resolveConversationCwd({
      repoRoot,
      profile: 'datadog',
      defaultCwd: '/tmp/default-cwd',
      referencedProjectIds: ['web-ui', 'api'],
    })).toBe('/tmp/default-cwd');
  });

  it('ignores referenced projects without repo roots when deriving cwd', () => {
    const repoRoot = createTempRepo();
    const first = createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      title: 'Ship the web UI',
      description: 'Ship the web UI',
    });
    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'notes',
      title: 'Track notes',
      description: 'Track notes',
    });

    setProjectRepoRoot(first.paths.documentFile, '../workspace/web-ui');

    expect(resolveConversationCwd({
      repoRoot,
      profile: 'datadog',
      defaultCwd: '/tmp/default-cwd',
      referencedProjectIds: ['notes', 'web-ui'],
    })).toBe(resolve(repoRoot, '../workspace/web-ui'));
  });
});
