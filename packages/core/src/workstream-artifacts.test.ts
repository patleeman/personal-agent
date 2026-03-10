import { mkdtempSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createInitialWorkstreamPlan,
  createInitialWorkstreamSummary,
  createWorkstreamActivityEntry,
  formatWorkstreamActivityEntry,
  formatWorkstreamPlan,
  formatWorkstreamSummary,
  parseWorkstreamActivityEntry,
  parseWorkstreamPlan,
  parseWorkstreamSummary,
  readWorkstreamActivityEntry,
  readWorkstreamPlan,
  readWorkstreamSummary,
  writeWorkstreamActivityEntry,
  writeWorkstreamPlan,
  writeWorkstreamSummary,
  type WorkstreamActivityEntryDocument,
  type WorkstreamPlanDocument,
  type WorkstreamSummaryDocument,
} from './workstream-artifacts.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-artifacts-'));
  tempDirs.push(dir);
  return dir;
}

describe('workstream summary artifacts', () => {
  it('creates the default summary document', () => {
    const summary = createInitialWorkstreamSummary({
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
    const document: WorkstreamSummaryDocument = {
      id: 'artifact-model',
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T13:00:00.000Z',
      objective: 'Create a durable artifact model.',
      currentPlan: 'Finalize the initial schema and lock it in.',
      status: '- In progress',
      blockers: '- Need to settle the activity entry shape',
      completedItems: '- Added workstream scaffold\n- Added path helpers',
      openTasks: '- Implement artifact IO helpers',
    };

    const markdown = formatWorkstreamSummary(document);
    expect(markdown).toContain('# Summary');
    expect(markdown).toContain('## Completed items');

    expect(parseWorkstreamSummary(markdown)).toEqual(document);
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

    expect(() => parseWorkstreamSummary(markdown)).toThrow('Missing required section in Summary markdown: Current plan');
  });

  it('writes and reads summary files', () => {
    const dir = createTempDir();
    const path = join(dir, 'summary.md');
    const document = createInitialWorkstreamSummary({
      id: 'artifact-model',
      objective: 'Create a durable artifact model.',
      createdAt: '2026-03-10T12:00:00.000Z',
    });

    writeWorkstreamSummary(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('## Status');
    expect(readWorkstreamSummary(path)).toEqual(document);
  });
});

describe('workstream plan artifacts', () => {
  it('creates the default plan document', () => {
    const plan = createInitialWorkstreamPlan({
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
    const document: WorkstreamPlanDocument = {
      id: 'artifact-model',
      updatedAt: '2026-03-10T13:00:00.000Z',
      objective: 'Create a durable artifact model.',
      steps: [
        { text: 'Finalize the artifact schema', completed: true },
        { text: 'Implement summary IO helpers', completed: false },
        { text: 'Implement plan IO helpers', completed: false },
      ],
    };

    const markdown = formatWorkstreamPlan(document);
    expect(markdown).toContain('# Plan');
    expect(markdown).toContain('- [x] Finalize the artifact schema');

    expect(parseWorkstreamPlan(markdown)).toEqual(document);
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

    expect(() => parseWorkstreamPlan(markdown)).toThrow('Invalid checklist step');
  });

  it('writes and reads plan files', () => {
    const dir = createTempDir();
    const path = join(dir, 'plan.md');
    const document = createInitialWorkstreamPlan({
      id: 'artifact-model',
      objective: 'Create a durable artifact model.',
      updatedAt: '2026-03-10T12:00:00.000Z',
    });

    writeWorkstreamPlan(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('## Steps');
    expect(readWorkstreamPlan(path)).toEqual(document);
  });
});

describe('workstream activity artifacts', () => {
  it('creates the default activity document', () => {
    const entry = createWorkstreamActivityEntry({
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
    const document: WorkstreamActivityEntryDocument = {
      id: 'daily-report',
      createdAt: '2026-03-10T14:00:00.000Z',
      profile: 'datadog',
      kind: 'scheduled-task',
      summary: 'Daily report completed.',
      details: 'Wrote the daily report artifact and refreshed the executive summary.',
      relatedWorkstreamIds: ['artifact-model', 'daily-review'],
      relatedConversationIds: ['conv-123'],
      notificationState: 'queued',
    };

    const markdown = formatWorkstreamActivityEntry(document);
    expect(markdown).toContain('# Activity');
    expect(markdown).toContain('relatedWorkstreamIds: artifact-model, daily-review');

    expect(parseWorkstreamActivityEntry(markdown)).toEqual(document);
  });

  it('writes and reads activity files', () => {
    const dir = createTempDir();
    const path = join(dir, 'activity.md');
    const document = createWorkstreamActivityEntry({
      id: 'daily-report',
      createdAt: '2026-03-10T14:00:00.000Z',
      profile: 'datadog',
      kind: 'scheduled-task',
      summary: 'Daily report completed.',
      relatedWorkstreamIds: ['artifact-model'],
    });

    writeWorkstreamActivityEntry(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('## Summary');
    expect(readWorkstreamActivityEntry(path)).toEqual(document);
  });
});
