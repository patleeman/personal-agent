import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createWorkstreamScaffold,
  listWorkstreamIds,
  resolveProfileWorkstreamsDir,
  resolveWorkstreamPaths,
  resolveWorkstreamTaskRecordPath,
  validateTaskRecordId,
  validateWorkstreamId,
  workstreamExists,
} from './workstreams.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-workstreams-'));
  tempDirs.push(dir);
  return dir;
}

describe('resolveProfileWorkstreamsDir', () => {
  it('returns the profile-scoped workstreams directory', () => {
    const repo = createTempRepo();
    const result = resolveProfileWorkstreamsDir({ repoRoot: repo, profile: 'datadog' });

    expect(result).toBe(join(repo, 'profiles', 'datadog', 'agent', 'workstreams'));
  });

  it('rejects invalid profile names', () => {
    const repo = createTempRepo();
    expect(() => resolveProfileWorkstreamsDir({ repoRoot: repo, profile: '../escape' })).toThrow('Invalid profile name');
  });
});

describe('validateWorkstreamId', () => {
  it('accepts simple workstream ids', () => {
    expect(() => validateWorkstreamId('ship-workstreams')).not.toThrow();
    expect(() => validateWorkstreamId('abc123')).not.toThrow();
  });

  it('rejects invalid workstream ids', () => {
    expect(() => validateWorkstreamId('bad/id')).toThrow('Invalid workstream id');
    expect(() => validateWorkstreamId(' spaced ')).toThrow('Invalid workstream id');
    expect(() => validateWorkstreamId('')).toThrow('Invalid workstream id');
  });
});

describe('validateTaskRecordId', () => {
  it('accepts simple task record ids', () => {
    expect(() => validateTaskRecordId('implement-activity')).not.toThrow();
  });

  it('rejects invalid task record ids', () => {
    expect(() => validateTaskRecordId('bad/id')).toThrow('Invalid task record id');
  });
});

describe('resolveWorkstreamPaths', () => {
  it('builds the expected file layout for a workstream', () => {
    const repo = createTempRepo();
    const paths = resolveWorkstreamPaths({
      repoRoot: repo,
      profile: 'datadog',
      workstreamId: 'artifact-model',
    });

    expect(paths.workstreamDir).toBe(join(repo, 'profiles', 'datadog', 'agent', 'workstreams', 'artifact-model'));
    expect(paths.summaryFile).toBe(join(paths.workstreamDir, 'summary.md'));
    expect(paths.planFile).toBe(join(paths.workstreamDir, 'plan.md'));
    expect(paths.tasksDir).toBe(join(paths.workstreamDir, 'tasks'));
    expect(paths.artifactsDir).toBe(join(paths.workstreamDir, 'artifacts'));
  });

  it('builds the expected path for a workstream task record', () => {
    const repo = createTempRepo();
    const path = resolveWorkstreamTaskRecordPath({
      repoRoot: repo,
      profile: 'datadog',
      workstreamId: 'artifact-model',
      taskRecordId: 'implement-activity',
    });

    expect(path).toBe(join(repo, 'profiles', 'datadog', 'agent', 'workstreams', 'artifact-model', 'tasks', 'implement-activity.md'));
  });
});

describe('createWorkstreamScaffold', () => {
  it('creates the initial workstream files and directories', () => {
    const repo = createTempRepo();
    const result = createWorkstreamScaffold({
      repoRoot: repo,
      profile: 'datadog',
      workstreamId: 'artifact-model',
      objective: 'Create a durable artifact model for ongoing work.',
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    expect(result.writtenFiles).toEqual([
      join(repo, 'profiles', 'datadog', 'agent', 'workstreams', 'artifact-model', 'summary.md'),
      join(repo, 'profiles', 'datadog', 'agent', 'workstreams', 'artifact-model', 'plan.md'),
    ]);

    expect(existsSync(result.paths.workstreamDir)).toBe(true);
    expect(existsSync(result.paths.tasksDir)).toBe(true);
    expect(existsSync(result.paths.artifactsDir)).toBe(true);

    const summary = readFileSync(result.paths.summaryFile, 'utf-8');
    expect(summary).toContain('id: artifact-model');
    expect(summary).toContain('Create a durable artifact model for ongoing work.');
    expect(summary).toContain('## Current plan');
    expect(summary).toContain('See [plan.md](./plan.md).');

    const plan = readFileSync(result.paths.planFile, 'utf-8');
    expect(plan).toContain('# Plan');
    expect(plan).toContain('## Steps');
    expect(plan).toContain('- [ ] Verify the result');
  });

  it('rejects empty objectives', () => {
    const repo = createTempRepo();

    expect(() => createWorkstreamScaffold({
      repoRoot: repo,
      profile: 'datadog',
      workstreamId: 'artifact-model',
      objective: '   ',
    })).toThrow('Workstream objective must not be empty');
  });

  it('rejects duplicate creation by default', () => {
    const repo = createTempRepo();

    createWorkstreamScaffold({
      repoRoot: repo,
      profile: 'datadog',
      workstreamId: 'artifact-model',
      objective: 'Initial objective',
    });

    expect(() => createWorkstreamScaffold({
      repoRoot: repo,
      profile: 'datadog',
      workstreamId: 'artifact-model',
      objective: 'Updated objective',
    })).toThrow('Workstream already exists');
  });

  it('allows overwriting an existing scaffold when requested', () => {
    const repo = createTempRepo();
    const first = createWorkstreamScaffold({
      repoRoot: repo,
      profile: 'datadog',
      workstreamId: 'artifact-model',
      objective: 'Initial objective',
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    const second = createWorkstreamScaffold({
      repoRoot: repo,
      profile: 'datadog',
      workstreamId: 'artifact-model',
      objective: 'Updated objective',
      overwrite: true,
      now: new Date('2026-03-10T13:00:00.000Z'),
    });

    expect(second.paths.workstreamDir).toBe(first.paths.workstreamDir);
    const summary = readFileSync(second.paths.summaryFile, 'utf-8');
    expect(summary).toContain('Updated objective');
    expect(summary).toContain('updatedAt: 2026-03-10T13:00:00.000Z');
  });
});

describe('listWorkstreamIds', () => {
  it('returns sorted workstream directories and ignores files', () => {
    const repo = createTempRepo();
    const workstreamsDir = resolveProfileWorkstreamsDir({ repoRoot: repo, profile: 'datadog' });

    createWorkstreamScaffold({
      repoRoot: repo,
      profile: 'datadog',
      workstreamId: 'zebra',
      objective: 'Zebra objective',
    });
    createWorkstreamScaffold({
      repoRoot: repo,
      profile: 'datadog',
      workstreamId: 'alpha',
      objective: 'Alpha objective',
    });

    writeFileSync(join(workstreamsDir, 'README.md'), '# not a workstream\n');
    writeFileSync(join(workstreamsDir, 'bad name'), 'ignore me\n');

    expect(listWorkstreamIds({ repoRoot: repo, profile: 'datadog' })).toEqual(['alpha', 'zebra']);
  });
});

describe('workstreamExists', () => {
  it('returns true when the workstream directory exists', () => {
    const repo = createTempRepo();
    createWorkstreamScaffold({
      repoRoot: repo,
      profile: 'datadog',
      workstreamId: 'artifact-model',
      objective: 'Objective',
    });

    expect(workstreamExists({ repoRoot: repo, profile: 'datadog', workstreamId: 'artifact-model' })).toBe(true);
  });

  it('returns false when the workstream directory is missing', () => {
    const repo = createTempRepo();
    expect(workstreamExists({ repoRoot: repo, profile: 'datadog', workstreamId: 'artifact-model' })).toBe(false);
  });
});
