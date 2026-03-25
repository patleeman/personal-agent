import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectScaffold, readProject, writeProject } from '@personal-agent/core';
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
    const project = readProject(scaffold.paths.projectFile);
    writeProject(scaffold.paths.projectFile, {
      ...project,
      repoRoot: '../workspace/web-ui',
    });

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

    writeProject(first.paths.projectFile, {
      ...readProject(first.paths.projectFile),
      repoRoot: '../workspace/web-ui',
    });
    writeProject(second.paths.projectFile, {
      ...readProject(second.paths.projectFile),
      repoRoot: '../workspace/api'
    });

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

    writeProject(first.paths.projectFile, {
      ...readProject(first.paths.projectFile),
      repoRoot: '../workspace/web-ui',
    });

    expect(resolveConversationCwd({
      repoRoot,
      profile: 'datadog',
      defaultCwd: '/tmp/default-cwd',
      referencedProjectIds: ['notes', 'web-ui'],
    })).toBe(resolve(repoRoot, '../workspace/web-ui'));
  });
});
