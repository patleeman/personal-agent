import { existsSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProjectScaffold,
  listProjectIds,
  listProjectTaskIds,
  projectExists,
  resolveProfileProjectsDir,
  resolveProjectPaths,
  resolveProjectTaskFilePath,
  resolveProjectTaskSummaryFilePath,
  validateProjectId,
  validateProjectTaskId,
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

    const result = resolveProfileProjectsDir({ repoRoot: repo, profile: 'assistant' });

    expect(result).toBe(join(repo, 'profiles', 'assistant', 'agent', 'projects'));
  });
});

describe('project id validation', () => {
  it('accepts simple project ids', () => {
    expect(() => validateProjectId('web-ui')).not.toThrow();
  });

  it('rejects invalid project ids', () => {
    expect(() => validateProjectId('bad/id')).toThrow('Invalid project id');
    expect(() => validateProjectId(' spaced ')).toThrow('Invalid project id');
  });
});

describe('project task id validation', () => {
  it('accepts simple project task ids', () => {
    expect(() => validateProjectTaskId('project-shell')).not.toThrow();
  });

  it('rejects invalid project task ids', () => {
    expect(() => validateProjectTaskId('bad/id')).toThrow('Invalid project task id');
    expect(() => validateProjectTaskId(' spaced ')).toThrow('Invalid project task id');
  });
});

describe('resolveProjectPaths', () => {
  it('builds the expected file layout for a project', () => {
    const repo = createTempRepo();

    const paths = resolveProjectPaths({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'web-ui',
    });

    expect(paths.projectDir).toBe(join(repo, 'profiles', 'assistant', 'agent', 'projects', 'web-ui'));
    expect(paths.projectFile).toBe(join(paths.projectDir, 'project.md'));
    expect(paths.planFile).toBe(join(paths.projectDir, 'plan.md'));
    expect(paths.tasksDir).toBe(join(paths.projectDir, 'tasks'));
    expect(paths.artifactsDir).toBe(join(paths.projectDir, 'artifacts'));
  });

  it('builds the expected path for a project task and task summary', () => {
    const repo = createTempRepo();

    expect(resolveProjectTaskFilePath({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'web-ui',
      taskId: 'project-shell',
    })).toBe(join(repo, 'profiles', 'assistant', 'agent', 'projects', 'web-ui', 'tasks', 'project-shell.md'));

    expect(resolveProjectTaskSummaryFilePath({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'web-ui',
      taskId: 'project-shell',
    })).toBe(join(repo, 'profiles', 'assistant', 'agent', 'projects', 'web-ui', 'tasks', 'project-shell.summary.md'));
  });
});

describe('createProjectScaffold', () => {
  it('creates the initial project files and directories', () => {
    const repo = createTempRepo();

    const result = createProjectScaffold({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'web-ui',
      title: 'Web UI continuity shell',
      objective: 'Ship the first durable web UI shell.',
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    expect(result.writtenFiles).toEqual([
      join(repo, 'profiles', 'assistant', 'agent', 'projects', 'web-ui', 'project.md'),
      join(repo, 'profiles', 'assistant', 'agent', 'projects', 'web-ui', 'plan.md'),
    ]);
    expect(existsSync(result.paths.projectDir)).toBe(true);
    expect(existsSync(result.paths.tasksDir)).toBe(true);
    expect(existsSync(result.paths.artifactsDir)).toBe(true);
  });

  it('rejects duplicate creation by default', () => {
    const repo = createTempRepo();

    createProjectScaffold({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'web-ui',
      title: 'Web UI continuity shell',
      objective: 'Ship the first durable web UI shell.',
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    expect(() => createProjectScaffold({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'web-ui',
      title: 'Web UI continuity shell',
      objective: 'Ship the first durable web UI shell.',
    })).toThrow('Project already exists');
  });

  it('allows overwriting an existing scaffold when requested', () => {
    const repo = createTempRepo();

    const first = createProjectScaffold({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'web-ui',
      title: 'Web UI continuity shell',
      objective: 'Ship the first durable web UI shell.',
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    const second = createProjectScaffold({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'web-ui',
      title: 'Web UI continuity shell',
      objective: 'Ship the first durable web UI shell.',
      overwrite: true,
      now: new Date('2026-03-10T13:00:00.000Z'),
    });

    expect(second.paths.projectDir).toBe(first.paths.projectDir);
  });
});

describe('project listing helpers', () => {
  it('returns sorted project directories and ignores files', () => {
    const repo = createTempRepo();
    const projectsDir = resolveProfileProjectsDir({ repoRoot: repo, profile: 'assistant' });

    createProjectScaffold({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'zebra',
      title: 'Zebra',
      objective: 'Zebra project.',
      now: new Date('2026-03-10T12:00:00.000Z'),
    });
    createProjectScaffold({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'alpha',
      title: 'Alpha',
      objective: 'Alpha project.',
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    writeFileSync(join(projectsDir, 'README.md'), '# ignore me\n');

    expect(listProjectIds({ repoRoot: repo, profile: 'assistant' })).toEqual(['alpha', 'zebra']);
  });

  it('lists task ids and ignores summary files', () => {
    const repo = createTempRepo();
    const scaffold = createProjectScaffold({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'web-ui',
      title: 'Web UI continuity shell',
      objective: 'Ship the first durable web UI shell.',
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    writeFileSync(join(scaffold.paths.tasksDir, 'alpha.md'), '# task\n');
    writeFileSync(join(scaffold.paths.tasksDir, 'alpha.summary.md'), '# task summary\n');
    writeFileSync(join(scaffold.paths.tasksDir, 'beta.md'), '# task\n');

    expect(listProjectTaskIds({ repoRoot: repo, profile: 'assistant', projectId: 'web-ui' })).toEqual(['alpha', 'beta']);
  });
});

describe('projectExists', () => {
  it('returns true when the project directory exists', () => {
    const repo = createTempRepo();

    createProjectScaffold({
      repoRoot: repo,
      profile: 'assistant',
      projectId: 'web-ui',
      title: 'Web UI continuity shell',
      objective: 'Ship the first durable web UI shell.',
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    expect(projectExists({ repoRoot: repo, profile: 'assistant', projectId: 'web-ui' })).toBe(true);
  });

  it('returns false when the project directory is missing', () => {
    const repo = createTempRepo();

    expect(projectExists({ repoRoot: repo, profile: 'assistant', projectId: 'web-ui' })).toBe(false);
  });
});
