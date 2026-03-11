import { mkdtempSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createInitialProjectPlan,
  createInitialProjectSummary,
  createProjectActivityEntry,
  createProjectTask,
  formatProjectActivityEntry,
  formatProjectPlan,
  formatProjectSummary,
  formatProjectTask,
  parseProjectActivityEntry,
  parseProjectPlan,
  parseProjectSummary,
  parseProjectTask,
  readProjectActivityEntry,
  readProjectPlan,
  readProjectSummary,
  readProjectTask,
  writeProjectActivityEntry,
  writeProjectPlan,
  writeProjectSummary,
  writeProjectTask,
  type ProjectActivityEntryDocument,
  type ProjectPlanDocument,
  type ProjectSummaryDocument,
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

describe('project summary artifacts', () => {
  it('creates the default summary document', () => {
    const summary = createInitialProjectSummary({
      id: 'artifact-model',
      objective: 'Create a durable artifact model.',
      createdAt: '2026-03-10T12:00:00.000Z',
    });

    expect(summary).toEqual({
      id: 'artifact-model',
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:00:00.000Z',
      objective: 'Create a durable artifact model.',
      currentPlan: 'See [plan.md](./plan.md).',
      status: '- Created',
      blockers: '- None',
      completedItems: '- None',
      openTasks: '- None',
    });
  });

  it('formats and parses summary markdown as a round trip', () => {
    const document: ProjectSummaryDocument = {
      id: 'artifact-model',
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T13:00:00.000Z',
      objective: 'Create a durable artifact model.',
      currentPlan: 'Finalize the initial schema and lock it in.',
      status: '- In progress',
      blockers: '- Need to settle the activity entry shape',
      completedItems: '- Added project scaffold\n- Added path helpers',
      openTasks: '- Implement artifact IO helpers',
    };

    const markdown = formatProjectSummary(document);
    expect(markdown).toContain('# Summary');
    expect(markdown).toContain('## Completed items');

    expect(parseProjectSummary(markdown)).toEqual(document);
  });

  it('rejects summary markdown missing required sections', () => {
    const markdown = `---
id: artifact-model
createdAt: 2026-03-10T12:00:00.000Z
updatedAt: 2026-03-10T12:00:00.000Z
---
# Summary

## Objective

Create a durable artifact model.
`;

    expect(() => parseProjectSummary(markdown)).toThrow('Missing required section in Summary markdown: Current plan');
  });

  it('writes and reads summary files', () => {
    const dir = createTempDir();
    const path = join(dir, 'summary.md');
    const document = createInitialProjectSummary({
      id: 'artifact-model',
      objective: 'Create a durable artifact model.',
      createdAt: '2026-03-10T12:00:00.000Z',
    });

    writeProjectSummary(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('## Status');
    expect(readProjectSummary(path)).toEqual(document);
  });
});

describe('project plan artifacts', () => {
  it('creates the default plan document', () => {
    const plan = createInitialProjectPlan({
      id: 'artifact-model',
      objective: 'Create a durable artifact model.',
      updatedAt: '2026-03-10T12:00:00.000Z',
    });

    expect(plan.steps).toEqual([
      { text: 'Refine the plan', completed: false },
      { text: 'Execute the work', completed: false },
      { text: 'Verify the result', completed: false },
    ]);
  });

  it('formats and parses plan markdown as a round trip', () => {
    const document: ProjectPlanDocument = {
      id: 'artifact-model',
      updatedAt: '2026-03-10T13:00:00.000Z',
      objective: 'Create a durable artifact model.',
      steps: [
        { text: 'Finalize the artifact schema', completed: true },
        { text: 'Implement summary IO helpers', completed: false },
        { text: 'Implement plan IO helpers', completed: false },
      ],
    };

    const markdown = formatProjectPlan(document);
    expect(markdown).toContain('# Plan');
    expect(markdown).toContain('- [x] Finalize the artifact schema');

    expect(parseProjectPlan(markdown)).toEqual(document);
  });

  it('rejects invalid plan checklist items', () => {
    const markdown = `---
id: artifact-model
updatedAt: 2026-03-10T13:00:00.000Z
---
# Plan

## Objective

Create a durable artifact model.

## Steps

- finalize the artifact schema
`;

    expect(() => parseProjectPlan(markdown)).toThrow('Invalid checklist step');
  });

  it('writes and reads plan files', () => {
    const dir = createTempDir();
    const path = join(dir, 'plan.md');
    const document = createInitialProjectPlan({
      id: 'artifact-model',
      objective: 'Create a durable artifact model.',
      updatedAt: '2026-03-10T12:00:00.000Z',
    });

    writeProjectPlan(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('## Steps');
    expect(readProjectPlan(path)).toEqual(document);
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

  it('formats and parses task markdown as a round trip', () => {
    const document: ProjectTaskDocument = {
      id: 'implement-activity',
      createdAt: '2026-03-10T15:00:00.000Z',
      updatedAt: '2026-03-10T16:00:00.000Z',
      status: 'running',
      title: 'Implement activity records',
      summary: 'Wire daemon task runs into durable activity output.',
    };

    const markdown = formatProjectTask(document);
    expect(markdown).toContain('# Task');
    expect(markdown).toContain('status: running');

    expect(parseProjectTask(markdown)).toEqual(document);
  });

  it('writes and reads task files', () => {
    const dir = createTempDir();
    const path = join(dir, 'task.md');
    const document = createProjectTask({
      id: 'implement-activity',
      createdAt: '2026-03-10T15:00:00.000Z',
      status: 'pending',
      title: 'Implement activity records',
      summary: 'Start with the daemon scheduled-task path.',
    });

    writeProjectTask(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('## Title');
    expect(readProjectTask(path)).toEqual(document);
  });
});
