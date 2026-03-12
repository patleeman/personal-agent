import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProjectScaffold,
  listProjectIds,
  listResolvedProjectRepoRoots,
  projectExists,
  resolveProfileProjectsDir,
  resolveProjectPaths,
  resolveProjectRepoRoot,
  resolveProjectTaskPath,
  validateTaskId,
  validateProjectId,
} from './projects.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-projects-'));
  tempDirs.push(dir);
  return dir;
}

describe('resolveProfileProjectsDir', () => {
  it('returns the profile-scoped projects directory', () => {
    const repo = createTempRepo();
    const result = resolveProfileProjectsDir({ repoRoot: repo, profile: 'datadog' });

    expect(result).toBe(join(repo, 'profiles', 'datadog', 'agent', 'projects'));
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
  it('builds the expected file layout for a project', () => {
    const repo = createTempRepo();
    const paths = resolveProjectPaths({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'artifact-model',
    });

    expect(paths.projectDir).toBe(join(repo, 'profiles', 'datadog', 'agent', 'projects', 'artifact-model'));
    expect(paths.projectFile).toBe(join(paths.projectDir, 'PROJECT.yaml'));
    expect(paths.tasksDir).toBe(join(paths.projectDir, 'tasks'));
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

    expect(path).toBe(join(repo, 'profiles', 'datadog', 'agent', 'projects', 'artifact-model', 'tasks', 'implement-activity.yaml'));
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

    writeFileSync(first.paths.projectFile, readFileSync(first.paths.projectFile, 'utf-8').replace(
      'summary: Project created. Refine the plan before executing the work.',
      'repoRoot: ../workspace/alpha\nsummary: Project created. Refine the plan before executing the work.',
    ));
    writeFileSync(second.paths.projectFile, readFileSync(second.paths.projectFile, 'utf-8').replace(
      'summary: Project created. Refine the plan before executing the work.',
      'repoRoot: ../workspace/alpha\nsummary: Project created. Refine the plan before executing the work.',
    ));

    expect(listResolvedProjectRepoRoots({
      repoRoot: repo,
      profile: 'datadog',
      projectIds: ['alpha', 'beta'],
    })).toEqual([join(repo, '..', 'workspace', 'alpha')]);
  });
});

describe('createProjectScaffold', () => {
  it('creates the initial project files and directories', () => {
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
      join(repo, 'profiles', 'datadog', 'agent', 'projects', 'artifact-model', 'PROJECT.yaml'),
    ]);

    expect(existsSync(result.paths.projectDir)).toBe(true);
    expect(existsSync(result.paths.tasksDir)).toBe(true);
    expect(existsSync(result.paths.artifactsDir)).toBe(true);

    const projectFile = readFileSync(result.paths.projectFile, 'utf-8');
    expect(projectFile).toContain('id: artifact-model');
    expect(projectFile).toContain('title: Artifact model');
    expect(projectFile).toContain('description: Create a durable artifact model for ongoing work.');
    expect(projectFile).toContain('currentMilestoneId: refine-plan');
  });

  it('rejects empty titles', () => {
    const repo = createTempRepo();

    expect(() => createProjectScaffold({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'artifact-model',
      title: '   ',
      description: 'Non-empty description',
    })).toThrow('Project title must not be empty');
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

    expect(() => createProjectScaffold({
      repoRoot: repo,
      profile: 'datadog',
      projectId: 'artifact-model',
      title: 'Updated objective',
      description: 'Updated objective',
    })).toThrow('Project already exists');
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
    expect(projectFile).toContain('description: Updated objective');
    expect(projectFile).toContain('updatedAt: 2026-03-10T13:00:00.000Z');
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
});

describe('projectExists', () => {
  it('returns true when the project directory exists', () => {
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
