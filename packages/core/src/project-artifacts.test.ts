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
      title: 'Durable artifact model',
      description: 'Create a durable artifact model.',
      createdAt: '2026-03-10T12:00:00.000Z',
    });

    expect(project).toEqual({
      id: 'artifact-model',
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:00:00.000Z',
      title: 'Durable artifact model',
      description: 'Create a durable artifact model.',
      summary: 'Project created. Capture the durable requirements, plan, and next steps as the work takes shape.',
      requirements: {
        goal: 'Create a durable artifact model.',
        acceptanceCriteria: [],
      },
      status: 'created',
      blockers: [],
      currentFocus: 'Capture the first concrete work chunk.',
      recentProgress: [],
      planSummary: 'Break the work into milestones and tasks once the approach is clear.',
      completionSummary: undefined,
      plan: {
        milestones: [],
        tasks: [],
      },
    });
  });

  it('formats and parses project yaml as a round trip', () => {
    const document: ProjectDocument = {
      id: 'artifact-model',
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T13:00:00.000Z',
      title: 'Durable artifact model',
      description: 'Create a durable artifact model.',
      repoRoot: '/Users/patrick/workingdir/personal-agent',
      summary: 'Core storage is in place and the CLI surface is next.',
      requirements: {
        goal: 'Create a durable artifact model that stays easy to inspect and edit.',
        acceptanceCriteria: [
          'Projects serialize cleanly to YAML.',
          'Agents can recover the state without reading the whole repo.',
        ],
      },
      status: 'in_progress',
      blockers: ['Need to settle the activity entry shape'],
      currentFocus: 'Build the CLI inbox surface.',
      recentProgress: ['Added project scaffold', 'Added path helpers'],
      planSummary: 'Land the schema first, then wire the CLI surface around it.',
      completionSummary: 'Not complete yet. The schema is stable and the CLI work is next.',
      plan: {
        currentMilestoneId: 'cli-inbox',
        milestones: [
          { id: 'schema', title: 'Finalize the artifact schema', status: 'completed' },
          { id: 'helpers', title: 'Implement read/write helpers', status: 'completed' },
          { id: 'cli-inbox', title: 'Build the CLI inbox surface', status: 'in_progress', summary: 'Keep it compact and durable.' },
        ],
        tasks: [
          { id: 'wire-inbox', title: 'Wire the inbox command', status: 'in_progress', milestoneId: 'cli-inbox' },
        ],
      },
    };

    const yaml = formatProject(document);
    expect(yaml).toContain('title: Durable artifact model');
    expect(yaml).toContain('description: Create a durable artifact model.');
    expect(yaml).toContain('repoRoot: /Users/patrick/workingdir/personal-agent');
    expect(yaml).toContain('goal: Create a durable artifact model that stays easy to inspect and edit.');
    expect(yaml).toContain('acceptanceCriteria:');
    expect(yaml).toContain('planSummary: Land the schema first, then wire the CLI surface around it.');
    expect(yaml).toContain('completionSummary: Not complete yet. The schema is stable and the CLI work is next.');
    expect(yaml).toContain('currentMilestoneId: cli-inbox');

    expect(parseProject(yaml)).toEqual(document);
  });

  it('rejects project yaml with a missing required plan block', () => {
    const yaml = `id: artifact-model
createdAt: 2026-03-10T12:00:00.000Z
updatedAt: 2026-03-10T12:00:00.000Z
title: Durable artifact model
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
title: Durable artifact model
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
  tasks: []
`;

    expect(() => parseProject(yaml)).toThrow('Current milestone id missing does not exist');
  });

  it('defaults missing structured fields when parsing older project yaml', () => {
    const yaml = `id: artifact-model
createdAt: 2026-03-10T12:00:00.000Z
updatedAt: 2026-03-10T12:00:00.000Z
title: Durable artifact model
description: Create a durable artifact model.
summary: Project created.
status: created
blockers: []
currentFocus: Capture the first step.
recentProgress: []
plan:
  milestones: []
  tasks: []
`;

    expect(parseProject(yaml)).toEqual({
      id: 'artifact-model',
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:00:00.000Z',
      title: 'Durable artifact model',
      description: 'Create a durable artifact model.',
      summary: 'Project created.',
      requirements: {
        goal: 'Create a durable artifact model.',
        acceptanceCriteria: [],
      },
      status: 'created',
      blockers: [],
      currentFocus: 'Capture the first step.',
      recentProgress: [],
      planSummary: undefined,
      completionSummary: undefined,
      plan: {
        milestones: [],
        tasks: [],
      },
    });
  });

  it('writes and reads project files', () => {
    const dir = createTempDir();
    const path = join(dir, 'PROJECT.yaml');
    const document = createInitialProject({
      id: 'artifact-model',
      title: 'Durable artifact model',
      description: 'Create a durable artifact model.',
      createdAt: '2026-03-10T12:00:00.000Z',
    });

    writeProject(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('plan:');
    expect(readFileSync(path, 'utf-8')).toContain('requirements:');
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
      notificationState: 'queued',
    };

    const markdown = formatProjectActivityEntry(document);
    expect(markdown).toContain('# Activity');
    expect(markdown).toContain('relatedProjectIds: artifact-model, daily-review');

    expect(parseProjectActivityEntry(markdown)).toEqual(document);
  });

  it('ignores legacy relatedConversationIds frontmatter when parsing activity markdown', () => {
    const markdown = [
      '---',
      'id: daily-report',
      'createdAt: 2026-03-10T14:00:00.000Z',
      'profile: datadog',
      'kind: scheduled-task',
      'notificationState: queued',
      'relatedProjectIds: artifact-model, daily-review',
      'relatedConversationIds: conv-123',
      '---',
      '# Activity',
      '',
      '## Summary',
      '',
      'Daily report completed.',
      '',
      '## Details',
      '',
      'Wrote the daily report artifact and refreshed the executive summary.',
      '',
    ].join('\n');

    expect(parseProjectActivityEntry(markdown)).toEqual({
      id: 'daily-report',
      createdAt: '2026-03-10T14:00:00.000Z',
      profile: 'datadog',
      kind: 'scheduled-task',
      summary: 'Daily report completed.',
      details: 'Wrote the daily report artifact and refreshed the executive summary.',
      relatedProjectIds: ['artifact-model', 'daily-review'],
      notificationState: 'queued',
    });
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
      status: 'pending',
      title: 'Implement activity records',
      milestoneId: 'durable-activity',
    });

    expect(task).toEqual({
      id: 'implement-activity',
      status: 'pending',
      title: 'Implement activity records',
      milestoneId: 'durable-activity',
    });
  });

  it('formats and parses task yaml as a round trip', () => {
    const document: ProjectTaskDocument = {
      id: 'implement-activity',
      status: 'in_progress',
      title: 'Implement activity records',
      milestoneId: 'durable-activity',
    };

    const yaml = formatProjectTask(document);
    expect(yaml).toContain('status: in_progress');
    expect(yaml).toContain('milestoneId: durable-activity');

    expect(parseProjectTask(yaml)).toEqual(document);
  });

  it('writes and reads task files', () => {
    const dir = createTempDir();
    const path = join(dir, 'task.yaml');
    const document = createProjectTask({
      id: 'implement-activity',
      status: 'pending',
      title: 'Implement activity records',
      milestoneId: 'durable-activity',
    });

    writeProjectTask(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('title: Implement activity records');
    expect(readProjectTask(path)).toEqual(document);
  });
});
