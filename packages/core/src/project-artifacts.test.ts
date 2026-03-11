import { mkdtempSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createInitialProjectDocument,
  createInitialProjectPlan,
  createProjectTask,
  createProjectTaskSummary,
  formatProjectDocument,
  formatProjectPlan,
  formatProjectTask,
  formatProjectTaskSummary,
  parseProjectDocument,
  parseProjectPlan,
  parseProjectTask,
  parseProjectTaskSummary,
  readProjectDocument,
  readProjectPlan,
  readProjectTask,
  readProjectTaskSummary,
  writeProjectDocument,
  writeProjectPlan,
  writeProjectTask,
  writeProjectTaskSummary,
  type ProjectDocument,
  type ProjectPlanDocument,
  type ProjectTaskDocument,
  type ProjectTaskSummaryDocument,
} from './project-artifacts.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-project-artifacts-'));
  tempDirs.push(dir);
  return dir;
}

describe('project artifacts', () => {
  it('creates the default project document', () => {
    const project = createInitialProjectDocument({
      id: 'web-ui',
      title: 'Web UI continuity shell',
      objective: 'Ship the first durable web UI shell.',
      createdAt: '2026-03-10T12:00:00.000Z',
    });

    expect(project).toEqual({
      id: 'web-ui',
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T12:00:00.000Z',
      status: 'active',
      title: 'Web UI continuity shell',
      objective: 'Ship the first durable web UI shell.',
      currentStatus: 'Project created.',
      blockers: 'None.',
      nextActions: 'Break the work into tasks and start execution.',
    });
  });

  it('formats and parses project markdown as a round trip', () => {
    const document: ProjectDocument = {
      id: 'web-ui',
      createdAt: '2026-03-10T12:00:00.000Z',
      updatedAt: '2026-03-10T13:00:00.000Z',
      status: 'blocked',
      title: 'Web UI continuity shell',
      objective: 'Ship the first durable web UI shell.',
      currentStatus: 'Project shell exists, but task detail editing is not implemented yet.',
      blockers: 'Need a project-backed task model.',
      nextActions: 'Implement project task documents and route the UI through them.',
      relatedConversationIds: ['conv-web-ui'],
    };

    const markdown = formatProjectDocument(document);
    expect(markdown).toContain('# Project');
    expect(markdown).toContain('relatedConversationIds: conv-web-ui');

    expect(parseProjectDocument(markdown)).toEqual(document);
  });

  it('writes and reads project files', () => {
    const dir = createTempDir();
    const path = join(dir, 'project.md');
    const document = createInitialProjectDocument({
      id: 'web-ui',
      title: 'Web UI continuity shell',
      objective: 'Ship the first durable web UI shell.',
      createdAt: '2026-03-10T12:00:00.000Z',
    });

    writeProjectDocument(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('## Current status');
    expect(readProjectDocument(path)).toEqual(document);
  });
});

describe('project plan artifacts', () => {
  it('creates the default plan document', () => {
    const plan = createInitialProjectPlan({
      id: 'web-ui',
      objective: 'Ship the first durable web UI shell.',
      updatedAt: '2026-03-10T12:00:00.000Z',
    });

    expect(plan.steps).toEqual([
      { text: 'Refine the project plan', completed: false },
      { text: 'Break the project into tasks', completed: false },
      { text: 'Execute and verify the work', completed: false },
    ]);
  });

  it('formats and parses plan markdown as a round trip', () => {
    const document: ProjectPlanDocument = {
      id: 'web-ui',
      updatedAt: '2026-03-10T13:00:00.000Z',
      objective: 'Ship the first durable web UI shell.',
      steps: [
        { text: 'Replace workstreams with projects', completed: true },
        { text: 'Introduce first-class project tasks', completed: false },
        { text: 'Expose project detail in the web UI', completed: false },
      ],
    };

    const markdown = formatProjectPlan(document);
    expect(markdown).toContain('# Plan');
    expect(markdown).toContain('- [x] Replace workstreams with projects');

    expect(parseProjectPlan(markdown)).toEqual(document);
  });

  it('writes and reads plan files', () => {
    const dir = createTempDir();
    const path = join(dir, 'plan.md');
    const document = createInitialProjectPlan({
      id: 'web-ui',
      objective: 'Ship the first durable web UI shell.',
      updatedAt: '2026-03-10T12:00:00.000Z',
    });

    writeProjectPlan(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('## Steps');
    expect(readProjectPlan(path)).toEqual(document);
  });
});

describe('project task artifacts', () => {
  it('creates the default project task document', () => {
    const task = createProjectTask({
      id: 'project-shell',
      createdAt: '2026-03-10T14:00:00.000Z',
      title: 'Create project shell',
      objective: 'Replace workstreams with projects in the durable model.',
      acceptanceCriteria: ['Project helpers exist', 'Project routes exist'],
    });

    expect(task.status).toBe('backlog');
    expect(task.updatedAt).toBe('2026-03-10T14:00:00.000Z');
  });

  it('formats and parses task markdown as a round trip', () => {
    const document: ProjectTaskDocument = {
      id: 'project-shell',
      createdAt: '2026-03-10T14:00:00.000Z',
      updatedAt: '2026-03-10T15:00:00.000Z',
      status: 'running',
      title: 'Create project shell',
      objective: 'Replace workstreams with projects in the durable model.',
      acceptanceCriteria: ['Project helpers exist', 'Project routes exist'],
      dependencies: ['core-project-foundation'],
      notes: 'Keep this slice read-only in the UI for now.',
      relatedConversationIds: ['conv-web-ui'],
    };

    const markdown = formatProjectTask(document);
    expect(markdown).toContain('# Task');
    expect(markdown).toContain('status: running');

    expect(parseProjectTask(markdown)).toEqual(document);
  });

  it('writes and reads task files', () => {
    const dir = createTempDir();
    const path = join(dir, 'project-shell.md');
    const document = createProjectTask({
      id: 'project-shell',
      createdAt: '2026-03-10T14:00:00.000Z',
      title: 'Create project shell',
      objective: 'Replace workstreams with projects in the durable model.',
      acceptanceCriteria: ['Project helpers exist'],
    });

    writeProjectTask(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('## Acceptance criteria');
    expect(readProjectTask(path)).toEqual(document);
  });
});

describe('project task summary artifacts', () => {
  it('creates a task summary document', () => {
    const summary = createProjectTaskSummary({
      taskId: 'project-shell',
      createdAt: '2026-03-10T16:00:00.000Z',
      outcome: 'Created the first project file model.',
      summary: 'Added project, plan, task, and task summary document helpers.',
    });

    expect(summary.updatedAt).toBe('2026-03-10T16:00:00.000Z');
  });

  it('formats and parses task summary markdown as a round trip', () => {
    const document: ProjectTaskSummaryDocument = {
      taskId: 'project-shell',
      createdAt: '2026-03-10T16:00:00.000Z',
      updatedAt: '2026-03-10T17:00:00.000Z',
      outcome: 'Created the first project file model.',
      summary: 'Added project, plan, task, and task summary document helpers.',
      criteriaValidation: [
        { criterion: 'Project helpers exist', status: 'pass', evidence: 'Added packages/core/src/projects.ts' },
        { criterion: 'Project routes exist', status: 'pending', evidence: 'Planned for next slice' },
      ],
      keyChanges: ['Added project core artifact helpers', 'Added project path helpers'],
      artifacts: ['PROJECTS.md'],
      followUps: ['Wire the web UI through project routes'],
    };

    const markdown = formatProjectTaskSummary(document);
    expect(markdown).toContain('# Task Summary');
    expect(markdown).toContain('- [pass] Project helpers exist :: Added packages/core/src/projects.ts');

    expect(parseProjectTaskSummary(markdown)).toEqual(document);
  });

  it('writes and reads task summary files', () => {
    const dir = createTempDir();
    const path = join(dir, 'project-shell.summary.md');
    const document = createProjectTaskSummary({
      taskId: 'project-shell',
      createdAt: '2026-03-10T16:00:00.000Z',
      outcome: 'Created the first project file model.',
      summary: 'Added project, plan, task, and task summary document helpers.',
      followUps: ['Wire the web UI through project routes'],
    });

    writeProjectTaskSummary(path, document);

    expect(readFileSync(path, 'utf-8')).toContain('## Outcome');
    expect(readProjectTaskSummary(path)).toEqual(document);
  });
});
