import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectScaffold, resolveProjectPaths } from '@personal-agent/core';
import { listProjectIndex } from './projects.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-project-index-'));
  tempDirs.push(dir);
  process.env.PERSONAL_AGENT_STATE_ROOT = dir;
  process.env.PERSONAL_AGENT_PROFILES_ROOT = join(dir, 'sync', 'profiles');
  return dir;
}

describe('listProjectIndex', () => {
  it('returns valid projects and surfaces invalid project files separately', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'assistant',
      projectId: 'valid-project',
      title: 'Valid project',
      description: 'Loads correctly',
    });

    const brokenPaths = resolveProjectPaths({
      repoRoot,
      profile: 'assistant',
      projectId: 'broken-project',
    });
    mkdirSync(brokenPaths.projectDir, { recursive: true });
    writeFileSync(brokenPaths.projectFile, `id: broken-project
createdAt: 2026-03-15T02:31:40.000Z
updatedAt: 2026-03-15T02:31:40.000Z
title: Broken project
description: Invalid YAML payload.
summary: Parser should reject this file.
status: created
blockers: []
currentFocus: Fix the YAML.
recentProgress:
  - Captured the initial direction: this becomes a mapping, not a string.
plan:
  milestones: []
  tasks: []
`);

    const index = listProjectIndex({ repoRoot, profile: 'assistant' });

    expect(index.projects.map((project) => project.id)).toEqual(['valid-project']);
    expect(index.invalidProjects).toHaveLength(1);
    expect(index.invalidProjects[0]).toMatchObject({
      projectId: 'broken-project',
      path: brokenPaths.projectFile,
    });
    expect(index.invalidProjects[0]?.error).toContain('must be a string');
  });

  it('reports project directories that are missing state.yaml', () => {
    const repoRoot = createTempRepo();
    const missingPaths = resolveProjectPaths({
      repoRoot,
      profile: 'assistant',
      projectId: 'missing-project',
    });

    mkdirSync(missingPaths.projectDir, { recursive: true });

    const index = listProjectIndex({ repoRoot, profile: 'assistant' });

    expect(index.projects).toEqual([]);
    expect(index.invalidProjects).toEqual([
      {
        projectId: 'missing-project',
        path: missingPaths.projectFile,
        error: 'state.yaml not found.',
      },
    ]);
  });
});
