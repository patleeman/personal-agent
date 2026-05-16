import { mkdtempSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createInitialProject,
  createProjectActivityEntry,
  createProjectTask,
  formatProject,
  formatProjectActivityEntry,
  formatProjectTask,
  parseProject,
  parseProjectActivityEntry,
  parseProjectTask,
  type ProjectActivityEntryDocument,
  type ProjectDocument,
  type ProjectTaskDocument,
  readProject,
  readProjectActivityEntry,
  readProjectTask,
  writeProject,
  writeProjectActivityEntry,
  writeProjectTask,
} from './project-artifacts.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-artifacts-'));
  tempDirs.push(dir);
  return dir;
}

describe('project artifacts', () => {
  it('rejects invalid project timestamps when creating the default document', () => {
    expect(() =>
      createInitialProject({
        id: 'artifact-model',
        ownerProfile: 'assistant',
        title: 'Durable artifact model',
        description: 'Create a durable artifact model.',
        createdAt: 'not-a-date',
      }),
    ).toThrow('Invalid Project createdAt');
  });

  it('creates the simplified default project document', () => {
    const project = createInitialProject({
      id: 'artifact-model',
      ownerProfile: 'assistant',
      title: 'Durable artifact model',
      description: 'Create a durable artifact model.',
      createdAt: '2026-03-10T12:00:00.000Z',
    });

    expect(project).toMatchObject({
      id: 'artifact-model',
      ownerProfile: 'assistant',
      title: 'Durable artifact model',
      description: 'Create a durable artifact model.',
      summary: 'Create a durable artifact model.',
      status: 'active',
      plan: {
        milestones: [],
        tasks: [],
      },
    });
  });

  it('rejects invalid project timestamps when formatting', () => {
    const document = createInitialProject({
      id: 'artifact-model',
      ownerProfile: 'assistant',
      title: 'Durable artifact model',
      description: 'Create a durable artifact model.',
      createdAt: '2026-03-10T12:00:00.000Z',
    });

    expect(() => formatProject({ ...document, updatedAt: 'not-a-date' })).toThrow('Invalid Project updatedAt');
  });

  it('formats project yaml as the canonical state record', () => {
    const document: ProjectDocument = {
      id: 'artifact-model',
      ownerProfile: 'assistant',
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T13:00:00.000Z',
      archivedAt: '2026-03-10T14:00:00.000Z',
      title: 'Durable artifact model',
      description: 'Create a durable artifact model.',
      repoRoot: '/Users/patrick/workingdir/personal-agent',
      summary: 'Core storage is in place and the CLI surface is next.',
      requirements: {
        goal: 'Create a durable artifact model that stays easy to inspect and edit.',
        acceptanceCriteria: ['Projects serialize cleanly to YAML.', 'Agents can recover the state without reading the whole repo.'],
      },
      status: 'active',
      blockers: ['Need to settle the activity entry shape'],
      currentFocus: 'Build the CLI activity surface.',
      recentProgress: ['Added project scaffold', 'Added path helpers'],
      planSummary: 'Land the schema first, then wire the CLI surface around it.',
      completionSummary: 'Not complete yet. The schema is stable and the CLI work is next.',
      plan: {
        milestones: [{ id: 'schema', title: 'Finalize the artifact schema', status: 'completed' }],
        tasks: [{ id: 'wire-activity', title: 'Wire the activity command', status: 'doing', milestoneId: 'schema' }],
      },
    };

    const yaml = formatProject(document);
    expect(yaml).toContain('archivedAt: 2026-03-10T14:00:00.000Z');
    expect(yaml).toContain('repoRoot: /Users/patrick/workingdir/personal-agent');
    expect(yaml).toContain('status: active');
    expect(yaml).toContain('plan:');
    expect(yaml).toContain('tasks:');
    expect(yaml).toContain('requirements:');
    expect(yaml).toContain('planSummary: Land the schema first, then wire the CLI surface around it.');
    expect(yaml).toContain('completionSummary: Not complete yet. The schema is stable and the CLI work is next.');
    expect(yaml).toContain('milestones:');
    expect(yaml).toContain('milestoneId: schema');

    expect(parseProject(yaml, document)).toMatchObject({
      archivedAt: '2026-03-10T14:00:00.000Z',
      repoRoot: '/Users/patrick/workingdir/personal-agent',
      status: 'active',
      requirements: {
        goal: 'Create a durable artifact model that stays easy to inspect and edit.',
        acceptanceCriteria: ['Projects serialize cleanly to YAML.', 'Agents can recover the state without reading the whole repo.'],
      },
      currentFocus: 'Build the CLI activity surface.',
      blockers: ['Need to settle the activity entry shape'],
      recentProgress: ['Added project scaffold', 'Added path helpers'],
      planSummary: 'Land the schema first, then wire the CLI surface around it.',
      completionSummary: 'Not complete yet. The schema is stable and the CLI work is next.',
      plan: {
        milestones: [{ id: 'schema', title: 'Finalize the artifact schema', status: 'completed' }],
        tasks: [{ id: 'wire-activity', title: 'Wire the activity command', status: 'doing', milestoneId: 'schema' }],
      },
    });
  });

  it('defaults a missing plan block when parsing legacy yaml', () => {
    const yaml = `id: artifact-model
createdAt: 2026-03-10T12:00:00.000Z
updatedAt: 2026-03-10T12:00:00.000Z
title: Durable artifact model
description: Create a durable artifact model.
summary: Project created.
status: created
`;

    expect(parseProject(yaml)).toMatchObject({
      id: 'artifact-model',
      title: 'Durable artifact model',
      description: 'Create a durable artifact model.',
      summary: 'Project created.',
      status: 'created',
      plan: {
        milestones: [],
        tasks: [],
      },
    });
  });

  it('writes and reads canonical project files', () => {
    const dir = createTempDir();
    const path = join(dir, 'state.yaml');
    const document = createInitialProject({
      id: 'artifact-model',
      ownerProfile: 'assistant',
      title: 'Durable artifact model',
      description: 'Create a durable artifact model.',
      createdAt: '2026-03-10T12:00:00.000Z',
    });

    writeProject(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('status: active');
    expect(readFileSync(path, 'utf-8')).toContain('plan:');
    expect(readFileSync(path, 'utf-8')).toContain('requirements:');
    expect(readFileSync(join(dir, 'project.md'), 'utf-8')).toContain('kind: project');
    expect(readProject(path)).toMatchObject({
      id: 'artifact-model',
      summary: 'Create a durable artifact model.',
      status: 'active',
    });
  });
});

describe('project activity artifacts', () => {
  it('rejects invalid activity timestamps', () => {
    expect(() =>
      createProjectActivityEntry({
        id: 'daily-report',
        createdAt: 'not-a-date',
        profile: 'datadog',
        kind: 'scheduled-task',
        summary: 'Daily report completed.',
      }),
    ).toThrow('Invalid Activity createdAt');
  });

  it('creates the default activity document', () => {
    const entry = createProjectActivityEntry({
      id: 'daily-report',
      createdAt: '2026-03-10T14:00:00.000Z',
      profile: 'datadog',
      kind: 'scheduled-task',
      summary: 'Daily report completed.',
    });

    expect(entry.notificationState).toBe('none');
    expect(entry.kind).toBe('scheduled-task');
  });

  it('rejects invalid activity timestamps when formatting', () => {
    const document = createProjectActivityEntry({
      id: 'daily-report',
      createdAt: '2026-03-10T14:00:00.000Z',
      profile: 'datadog',
      kind: 'scheduled-task',
      summary: 'Daily report completed.',
    });

    expect(() => formatProjectActivityEntry({ ...document, createdAt: 'not-a-date' })).toThrow('Invalid Activity createdAt');
  });

  it('formats and parses activity markdown as a round trip', () => {
    const document: ProjectActivityEntryDocument = {
      id: 'daily-report',
      createdAt: '2026-03-10T14:00:00.000Z',
      profile: 'datadog',
      kind: 'scheduled-task',
      summary: 'Daily report completed.',
      details: 'Wrote the daily report artifact and refreshed the executive summary.',
      relatedProjectIds: ['artifact-model', 'daily-review'],
      notificationState: 'queued',
    };

    const markdown = formatProjectActivityEntry(document);
    expect(markdown).toContain('# Activity');
    expect(markdown).toContain('relatedProjectIds: artifact-model, daily-review');
    expect(parseProjectActivityEntry(markdown)).toEqual(document);
  });

  it('writes and reads activity files', () => {
    const dir = createTempDir();
    const path = join(dir, 'activity.md');
    const document = createProjectActivityEntry({
      id: 'daily-report',
      createdAt: '2026-03-10T14:00:00.000Z',
      profile: 'datadog',
      kind: 'scheduled-task',
      summary: 'Daily report completed.',
    });

    writeProjectActivityEntry(path, document);
    expect(readProjectActivityEntry(path)).toEqual(document);
  });
});

describe('project task artifacts', () => {
  it('creates the default task document', () => {
    const task = createProjectTask({
      id: 'wire-activity',
      status: 'doing',
      title: 'Wire the activity command',
      milestoneId: 'legacy-milestone',
    });

    expect(task).toEqual({
      id: 'wire-activity',
      status: 'doing',
      title: 'Wire the activity command',
      milestoneId: 'legacy-milestone',
    });
  });

  it('formats and parses task yaml as a round trip', () => {
    const document: ProjectTaskDocument = {
      id: 'wire-activity',
      status: 'doing',
      title: 'Wire the activity command',
    };

    const yaml = formatProjectTask(document);
    expect(parseProjectTask(yaml)).toEqual(document);
  });

  it('writes and reads task files', () => {
    const dir = createTempDir();
    const path = join(dir, 'task.yaml');
    const document = createProjectTask({
      id: 'wire-activity',
      status: 'doing',
      title: 'Wire the activity command',
    });

    writeProjectTask(path, document);
    expect(readProjectTask(path)).toEqual(document);
  });
});
