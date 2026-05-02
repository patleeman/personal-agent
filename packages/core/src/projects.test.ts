import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createProjectScaffold,
  listAllProjectIds,
  listProjectIds,
  listResolvedProjectRepoRoots,
  projectExists,
  readProjectOwnerProfile,
  resolveProfileProjectsDir,
  resolveProjectPaths,
  resolveProjectRepoRoot,
  resolveProjectTaskPath,
  validateProjectId,
  validateTaskId,
} from './projects.js';

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
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-projects-'));
  tempDirs.push(dir);
  process.env.PERSONAL_AGENT_STATE_ROOT = dir;
  process.env.PERSONAL_AGENT_PROFILES_ROOT = join(dir, 'sync', 'profiles');
  process.env.PERSONAL_AGENT_VAULT_ROOT = join(dir, 'sync');
  return dir;
}

describe('resolveProfileProjectsDir', () => {
  it('returns the durable projects directory for projects', () => {
    const repo = createTempRepo();
    const result = resolveProfileProjectsDir({ repoRoot: repo, profile: 'datadog' });

    expect(result).toBe(join(repo, 'sync', 'projects'));
  });

  it('rejects invalid profile names', () => {
    const repo = createTempRepo();
    expect(() => resolveProfileProjectsDir({ repoRoot: repo, profile: '../escape' })).toThrow('Invalid profile name');
  });
});

describe('validateProjectId', () => {
  it('accepts simple project ids', () => {
    expect(() => validateProjectId('ship-projects')).not.toThrow();
    expect(() => validateProjectId('abc123')).not.toThrow();
  });

  it('rejects invalid project ids', () => {
    expect(() => validateProjectId('bad/id')).toThrow('Invalid project id');
    expect(() => validateProjectId(' spaced ')).toThrow('Invalid project id');
    expect(() => validateProjectId('')).toThrow('Invalid project id');
  });
});

describe('validateTaskId', () => {
  it('accepts simple task ids', () => {
    expect(() => validateTaskId('implement-activity')).not.toThrow();
  });

  it('rejects invalid task ids', () => {
    expect(() => validateTaskId('bad/id')).toThrow('Invalid task id');
  });
});

describe('resolveProjectPaths', () => {
  it('builds the expected file layout for a project package', () => {
    const repo = createTempRepo();
    const paths = resolveProjectPaths({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'artifact-model',
    });

    expect(paths.projectDir).toBe(join(repo, 'sync', 'projects', 'artifact-model'));
    expect(paths.projectFile).toBe(join(paths.projectDir, 'state.yaml'));
    expect(paths.documentFile).toBe(join(paths.projectDir, 'project.md'));
    expect(paths.tasksDir).toBe(join(paths.projectDir, 'tasks'));
    expect(paths.attachmentsDir).toBe(join(paths.projectDir, 'attachments'));
    expect(paths.artifactsDir).toBe(join(paths.projectDir, 'artifacts'));
  });

  it('builds the expected path for a project task', () => {
    const repo = createTempRepo();
    const path = resolveProjectTaskPath({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'artifact-model',
      taskId: 'implement-activity',
    });

    expect(path).toBe(join(repo, 'sync', 'projects', 'artifact-model', 'tasks', 'implement-activity.yaml'));
  });
});

describe('resolveProjectRepoRoot', () => {
  it('normalizes relative and home-prefixed project repo roots', () => {
    const repo = createTempRepo();

    expect(resolveProjectRepoRoot({ repoRoot: repo, projectRepoRoot: '../workspace' })).toBe(join(repo, '..', 'workspace'));
    expect(resolveProjectRepoRoot({ repoRoot: repo, projectRepoRoot: '~/workspace' })).toContain('workspace');
    expect(resolveProjectRepoRoot({ repoRoot: repo, projectRepoRoot: '   ' })).toBeUndefined();
  });
});

describe('listResolvedProjectRepoRoots', () => {
  it('collects unique repo roots from referenced projects', () => {
    const repo = createTempRepo();

    const first = createProjectScaffold({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'alpha',
      title: 'Alpha objective',
      description: 'Alpha objective',
    });
    const second = createProjectScaffold({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'beta',
      title: 'Beta objective',
      description: 'Beta objective',
    });

    writeFileSync(
      first.paths.documentFile,
      readFileSync(first.paths.documentFile, 'utf-8').replace('  - type:project\n', '  - type:project\n  - cwd:../workspace/alpha\n'),
    );
    writeFileSync(
      second.paths.documentFile,
      readFileSync(second.paths.documentFile, 'utf-8').replace('  - type:project\n', '  - type:project\n  - cwd:../workspace/alpha\n'),
    );

    expect(
      listResolvedProjectRepoRoots({
        repoRoot: repo,
        profile: 'datadog',
        projectIds: ['alpha', 'beta'],
      }),
    ).toEqual([join(repo, '..', 'workspace', 'alpha')]);
  });

  it('resolves repo roots for referenced projects owned by another profile', () => {
    const repo = createTempRepo();
    const project = createProjectScaffold({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'shared-objective',
      title: 'Shared objective',
      description: 'Shared objective',
    });

    writeFileSync(
      project.paths.documentFile,
      readFileSync(project.paths.documentFile, 'utf-8').replace(
        '  - type:project\n',
        '  - type:project\n  - cwd:../workspace/shared-objective\n',
      ),
    );

    expect(
      listResolvedProjectRepoRoots({
        repoRoot: repo,
        profile: 'datadog',
        projectIds: ['shared-objective'],
      }),
    ).toEqual([join(repo, '..', 'workspace', 'shared-objective')]);
  });
});

describe('createProjectScaffold', () => {
  it('creates the initial project files and directories in the durable project package', () => {
    const repo = createTempRepo();
    const result = createProjectScaffold({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'artifact-model',
      title: 'Artifact model',
      description: 'Create a durable artifact model for ongoing work.',
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    expect(result.writtenFiles).toEqual([
      join(repo, 'sync', 'projects', 'artifact-model', 'state.yaml'),
      join(repo, 'sync', 'projects', 'artifact-model', 'project.md'),
    ]);

    expect(existsSync(result.paths.projectDir)).toBe(true);
    expect(existsSync(result.paths.tasksDir)).toBe(true);
    expect(existsSync(result.paths.attachmentsDir)).toBe(true);
    expect(existsSync(result.paths.artifactsDir)).toBe(true);
    expect(existsSync(join(repo, 'sync', 'projects'))).toBe(true);

    const projectFile = readFileSync(result.paths.projectFile, 'utf-8');
    const indexFile = readFileSync(result.paths.documentFile, 'utf-8');
    expect(projectFile).toContain('description: Create a durable artifact model for ongoing work.');
    expect(projectFile).toContain('milestones: []');
    expect(indexFile).toContain('id: artifact-model');
    expect(indexFile).toContain('title: Artifact model');
    expect(indexFile).toContain('summary: Create a durable artifact model for ongoing work.');
    expect(indexFile).toContain('type:project');
    expect(indexFile).toContain('profile:datadog');
  });

  it('rejects empty titles', () => {
    const repo = createTempRepo();

    expect(() =>
      createProjectScaffold({
        repoRoot: repo,
        profile: 'datadog',
        projectId: 'artifact-model',
        title: '   ',
        description: 'Non-empty description',
      }),
    ).toThrow('Project title must not be empty');
  });

  it('rejects duplicate creation by default', () => {
    const repo = createTempRepo();

    createProjectScaffold({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'artifact-model',
      title: 'Initial objective',
      description: 'Initial objective',
    });

    expect(() =>
      createProjectScaffold({
        repoRoot: repo,
        profile: 'datadog',
        projectId: 'artifact-model',
        title: 'Updated objective',
        description: 'Updated objective',
      }),
    ).toThrow('Project already exists');
  });

  it('allows overwriting an existing scaffold when requested', () => {
    const repo = createTempRepo();
    const first = createProjectScaffold({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'artifact-model',
      title: 'Initial objective',
      description: 'Initial objective',
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    const second = createProjectScaffold({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'artifact-model',
      title: 'Updated objective',
      description: 'Updated objective',
      overwrite: true,
      now: new Date('2026-03-10T13:00:00.000Z'),
    });

    expect(second.paths.projectDir).toBe(first.paths.projectDir);
    const projectFile = readFileSync(second.paths.projectFile, 'utf-8');
    const indexFile = readFileSync(second.paths.documentFile, 'utf-8');
    expect(projectFile).toContain('description: Updated objective');
    expect(indexFile).toContain('updatedAt: 2026-03-10T13:00:00.000Z');
  });
});

describe('listAllProjectIds', () => {
  it('returns every durable project id regardless of owner profile', () => {
    const repo = createTempRepo();

    createProjectScaffold({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'assistant-project',
      title: 'Assistant objective',
      description: 'Assistant objective',
    });
    createProjectScaffold({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'datadog-project',
      title: 'Datadog objective',
      description: 'Datadog objective',
    });

    expect(listAllProjectIds({ repoRoot: repo })).toEqual(['assistant-project', 'datadog-project']);
  });
});

describe('readProjectOwnerProfile', () => {
  it('returns the durable owner profile for a project id', () => {
    const repo = createTempRepo();

    createProjectScaffold({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'assistant-project',
      title: 'Assistant objective',
      description: 'Assistant objective',
    });

    expect(readProjectOwnerProfile({ repoRoot: repo, projectId: 'assistant-project' })).toBe('assistant');
  });
});

describe('listProjectIds', () => {
  it('returns sorted project directories and ignores files', () => {
    const repo = createTempRepo();
    const projectsDir = resolveProfileProjectsDir({ repoRoot: repo, profile: 'datadog' });

    createProjectScaffold({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'zebra',
      title: 'Zebra objective',
      description: 'Zebra objective',
    });
    createProjectScaffold({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'alpha',
      title: 'Alpha objective',
      description: 'Alpha objective',
    });

    writeFileSync(join(projectsDir, 'README.md'), '# not a project\n');
    writeFileSync(join(projectsDir, 'bad name'), 'ignore me\n');

    expect(listProjectIds({ repoRoot: repo, profile: 'datadog' })).toEqual(['alpha', 'zebra']);
  });

  it('filters out projects owned by other profiles', () => {
    const repo = createTempRepo();

    createProjectScaffold({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'assistant-project',
      title: 'Assistant objective',
      description: 'Assistant objective',
    });
    createProjectScaffold({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'datadog-project',
      title: 'Datadog objective',
      description: 'Datadog objective',
    });

    expect(listProjectIds({ repoRoot: repo, profile: 'datadog' })).toEqual(['datadog-project']);
  });
});

describe('projectExists', () => {
  it('returns true when the project node exists', () => {
    const repo = createTempRepo();
    createProjectScaffold({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'artifact-model',
      title: 'Objective',
      description: 'Objective',
    });

    expect(projectExists({ repoRoot: repo, profile: 'datadog', projectId: 'artifact-model' })).toBe(true);
  });

  it('returns false when the project directory is missing', () => {
    const repo = createTempRepo();
    expect(projectExists({ repoRoot: repo, profile: 'datadog', projectId: 'artifact-model' })).toBe(false);
  });
});
