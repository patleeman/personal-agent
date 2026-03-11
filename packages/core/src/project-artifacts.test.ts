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
  readProject,
  readProjectActivityEntry,
  readProjectTask,
  writeProject,
  writeProjectActivityEntry,
  writeProjectTask,
  type ProjectActivityEntryDocument,
  type ProjectDocument,
  type ProjectTaskDocument,
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
  it('creates the default project document', () => {
    const project = createInitialProject({
      id: 'artifact-model',
      description: 'Create a durable artifact model.',
      createdAt: '2026-03-10T12:00:00.000Z',
    });

    expect(project).toEqual({
      id: 'artifact-model',
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:00:00.000Z',
      description: 'Create a durable artifact model.',
      summary: 'Project created. Refine the plan before executing the work.',
      status: 'created',
      blockers: [],
      currentFocus: 'Refine the project plan.',
      recentProgress: [],
      plan: {
        currentMilestoneId: 'refine-plan',
        milestones: [
          { id: 'refine-plan', title: 'Refine the plan', status: 'in_progress' },
          { id: 'execute-work', title: 'Execute the work', status: 'pending' },
          { id: 'verify-result', title: 'Verify the result', status: 'pending' },
        ],
      },
    });
  });

  it('formats and parses project yaml as a round trip', () => {
    const document: ProjectDocument = {
      id: 'artifact-model',
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T13:00:00.000Z',
      description: 'Create a durable artifact model.',
      summary: 'Core storage is in place and the CLI surface is next.',
      status: 'in_progress',
      blockers: ['Need to settle the activity entry shape'],
      currentFocus: 'Build the CLI inbox surface.',
      recentProgress: ['Added project scaffold', 'Added path helpers'],
      plan: {
        currentMilestoneId: 'cli-inbox',
        milestones: [
          { id: 'schema', title: 'Finalize the artifact schema', status: 'completed' },
          { id: 'helpers', title: 'Implement read/write helpers', status: 'completed' },
          { id: 'cli-inbox', title: 'Build the CLI inbox surface', status: 'in_progress', summary: 'Keep it compact and durable.' },
        ],
      },
    };

    const yaml = formatProject(document);
    expect(yaml).toContain('description: Create a durable artifact model.');
    expect(yaml).toContain('currentMilestoneId: cli-inbox');

    expect(parseProject(yaml)).toEqual(document);
  });

  it('rejects project yaml with a missing required plan block', () => {
    const yaml = `id: artifact-model
createdAt: 2026-03-10T12:00:00.000Z
updatedAt: 2026-03-10T12:00:00.000Z
description: Create a durable artifact model.
summary: Project created.
status: created
blockers: []
recentProgress: []
`;

    expect(() => parseProject(yaml)).toThrow('Missing required key plan in Project');
  });

  it('rejects a current milestone id that is not present in the milestone list', () => {
    const yaml = `id: artifact-model
createdAt: 2026-03-10T12:00:00.000Z
updatedAt: 2026-03-10T12:00:00.000Z
description: Create a durable artifact model.
summary: Project created.
status: created
blockers: []
recentProgress: []
plan:
  currentMilestoneId: missing
  milestones:
    - id: refine-plan
      title: Refine the plan
      status: in_progress
`;

    expect(() => parseProject(yaml)).toThrow('Current milestone id missing does not exist');
  });

  it('writes and reads project files', () => {
    const dir = createTempDir();
    const path = join(dir, 'PROJECT.yaml');
    const document = createInitialProject({
      id: 'artifact-model',
      description: 'Create a durable artifact model.',
      createdAt: '2026-03-10T12:00:00.000Z',
    });

    writeProject(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('plan:');
    expect(readProject(path)).toEqual(document);
  });
});

describe('project activity artifacts', () => {
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

  it('formats and parses activity markdown as a round trip', () => {
    const document: ProjectActivityEntryDocument = {
      id: 'daily-report',
      createdAt: '2026-03-10T14:00:00.000Z',
      profile: 'datadog',
      kind: 'scheduled-task',
      summary: 'Daily report completed.',
      details: 'Wrote the daily report artifact and refreshed the executive summary.',
      relatedProjectIds: ['artifact-model', 'daily-review'],
      relatedConversationIds: ['conv-123'],
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
      relatedProjectIds: ['artifact-model'],
    });

    writeProjectActivityEntry(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('## Summary');
    expect(readProjectActivityEntry(path)).toEqual(document);
  });
});

describe('project task artifacts', () => {
  it('creates the default task document', () => {
    const task = createProjectTask({
      id: 'implement-activity',
      createdAt: '2026-03-10T15:00:00.000Z',
      status: 'pending',
      title: 'Implement activity records',
    });

    expect(task.updatedAt).toBe('2026-03-10T15:00:00.000Z');
    expect(task.status).toBe('pending');
  });

  it('formats and parses task yaml as a round trip', () => {
    const document: ProjectTaskDocument = {
      id: 'implement-activity',
      createdAt: '2026-03-10T15:00:00.000Z',
      updatedAt: '2026-03-10T16:00:00.000Z',
      status: 'running',
      title: 'Implement activity records',
      order: 2,
      summary: 'Wire daemon task runs into durable activity output.',
      milestoneId: 'durable-activity',
      acceptanceCriteria: [
        'scheduled task runs emit activity entries',
        'activity entries link back to the project',
      ],
      plan: [
        'update the daemon task module',
        'write project activity entries',
      ],
      notes: 'Start with the scheduled-task path.',
    };

    const yaml = formatProjectTask(document);
    expect(yaml).toContain('status: running');
    expect(yaml).toContain('order: 2');
    expect(yaml).toContain('acceptanceCriteria:');

    expect(parseProjectTask(yaml)).toEqual(document);
  });

  it('writes and reads task files', () => {
    const dir = createTempDir();
    const path = join(dir, 'task.yaml');
    const document = createProjectTask({
      id: 'implement-activity',
      createdAt: '2026-03-10T15:00:00.000Z',
      status: 'pending',
      title: 'Implement activity records',
      summary: 'Start with the daemon scheduled-task path.',
      acceptanceCriteria: ['activity entries exist after a task run'],
      plan: ['update the daemon module'],
    });

    writeProjectTask(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('title: Implement activity records');
    expect(readProjectTask(path)).toEqual(document);
  });
});
