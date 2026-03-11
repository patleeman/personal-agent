import { existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectScaffold, resolveProjectPaths } from '@personal-agent/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addProjectMilestone,
  createProjectRecord,
  createProjectTaskRecord,
  deleteProjectMilestone,
  deleteProjectRecord,
  deleteProjectTaskRecord,
  moveProjectMilestone,
  moveProjectTaskRecord,
  readProjectDetailFromProject,
  readProjectSource,
  readProjectTaskSource,
  saveProjectSource,
  saveProjectTaskSource,
  sortProjectTasks,
  updateProjectMilestone,
  updateProjectRecord,
  updateProjectTaskRecord,
} from './projects.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-projects-'));
  tempDirs.push(dir);
  return dir;
}

describe('sortProjectTasks', () => {
  it('orders active and blocked tasks before completed work by default', () => {
    const sorted = sortProjectTasks([
      {
        id: 'completed-task',
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T03:00:00.000Z',
        status: 'completed',
        title: 'Done',
      },
      {
        id: 'blocked-task',
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T02:00:00.000Z',
        status: 'blocked',
        title: 'Blocked',
      },
      {
        id: 'pending-task',
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T04:00:00.000Z',
        status: 'pending',
        title: 'Pending',
      },
    ]);

    expect(sorted.map((task) => task.id)).toEqual(['blocked-task', 'pending-task', 'completed-task']);
  });

  it('prefers explicit task order when present', () => {
    const sorted = sortProjectTasks([
      {
        id: 'task-b',
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T03:00:00.000Z',
        status: 'completed',
        title: 'B',
        order: 1,
      },
      {
        id: 'task-a',
        createdAt: '2026-03-11T00:00:00.000Z',
        updatedAt: '2026-03-11T02:00:00.000Z',
        status: 'blocked',
        title: 'A',
        order: 0,
      },
    ]);

    expect(sorted.map((task) => task.id)).toEqual(['task-a', 'task-b']);
  });
});

describe('readProjectDetailFromProject', () => {
  it('returns the project document and sorted yaml tasks from project storage', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      objective: 'Ship the project UI',
      now: new Date('2026-03-11T01:00:00.000Z'),
    });

    createProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'completed-task',
      status: 'completed',
      title: 'Polish the list page',
    });

    createProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'running-task',
      status: 'running',
      title: 'Build the project detail card',
      summary: 'Render project overview and milestones together.',
      acceptanceCriteria: ['the rail shows a single coherent project view'],
    });

    const detail = readProjectDetailFromProject({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
    });

    expect(detail.project.id).toBe('web-ui');
    expect(detail.project.description).toBe('Ship the project UI');
    expect(detail.project.plan.milestones).toHaveLength(3);
    expect(detail.taskCount).toBe(2);
    expect(detail.artifactCount).toBe(0);
    expect(detail.tasks.map((task) => task.id)).toEqual(['completed-task', 'running-task']);
    expect(detail.tasks[1]).toEqual(expect.objectContaining({
      status: 'running',
      summary: 'Render project overview and milestones together.',
      acceptanceCriteria: ['the rail shows a single coherent project view'],
    }));
  });
});

describe('project editing helpers', () => {
  it('creates a project record with editable fields', () => {
    const repoRoot = createTempRepo();

    const detail = createProjectRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'artifact-model',
      description: 'Build the artifact model',
      summary: 'The storage model is taking shape.',
      status: 'in_progress',
      currentFocus: 'Define PROJECT.yaml.',
      blockers: ['Need to settle task shape'],
      recentProgress: ['Created the scaffold'],
    });

    expect(detail.project.description).toBe('Build the artifact model');
    expect(detail.project.summary).toBe('The storage model is taking shape.');
    expect(detail.project.status).toBe('in_progress');
    expect(detail.project.currentFocus).toBe('Define PROJECT.yaml.');
    expect(detail.project.blockers).toEqual(['Need to settle task shape']);
    expect(detail.project.recentProgress).toEqual(['Created the scaffold']);
  });

  it('updates project fields and current milestone', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'artifact-model',
      objective: 'Build the artifact model',
    });

    const detail = updateProjectRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'artifact-model',
      description: 'Build the durable artifact model',
      summary: 'PROJECT.yaml is now canonical.',
      currentMilestoneId: 'execute-work',
      blockers: [],
      recentProgress: ['Migrated the project schema'],
    });

    expect(detail.project.description).toBe('Build the durable artifact model');
    expect(detail.project.summary).toBe('PROJECT.yaml is now canonical.');
    expect(detail.project.plan.currentMilestoneId).toBe('execute-work');
    expect(detail.project.recentProgress).toEqual(['Migrated the project schema']);
  });

  it('adds and updates milestones', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      objective: 'Ship the web UI',
    });

    addProjectMilestone({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      id: 'polish',
      title: 'Polish the project page',
      status: 'pending',
      summary: 'Reduce visual density and expose editing affordances.',
      makeCurrent: true,
    });

    const updated = updateProjectMilestone({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      milestoneId: 'polish',
      status: 'in_progress',
      summary: 'Editing flows are now the focus.',
    });

    const milestone = updated.project.plan.milestones.find((entry) => entry.id === 'polish');
    expect(milestone).toEqual({
      id: 'polish',
      title: 'Polish the project page',
      status: 'in_progress',
      summary: 'Editing flows are now the focus.',
    });
    expect(updated.project.plan.currentMilestoneId).toBe('polish');
  });

  it('creates and updates task records', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      objective: 'Ship the web UI',
    });

    addProjectMilestone({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      id: 'editing',
      title: 'Add editing flows',
      status: 'in_progress',
      makeCurrent: true,
    });

    createProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'add-project-editor',
      title: 'Add a project editor',
      status: 'pending',
      summary: 'Let users edit the project document.',
      milestoneId: 'editing',
      acceptanceCriteria: ['users can edit project fields'],
      plan: ['add API routes', 'build the form'],
      notes: 'Keep it flat.',
    });

    const updated = updateProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'add-project-editor',
      status: 'running',
      acceptanceCriteria: ['users can edit project fields', 'changes persist to YAML'],
      notes: 'The UI should stay calm.',
    });

    const task = updated.tasks.find((entry) => entry.id === 'add-project-editor');
    expect(task).toEqual(expect.objectContaining({
      status: 'running',
      milestoneId: 'editing',
      acceptanceCriteria: ['users can edit project fields', 'changes persist to YAML'],
      notes: 'The UI should stay calm.',
    }));
  });

  it('deletes and reorders milestones', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      objective: 'Ship the web UI',
    });

    addProjectMilestone({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      id: 'editing',
      title: 'Add editing flows',
      status: 'in_progress',
    });

    let detail = moveProjectMilestone({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      milestoneId: 'editing',
      direction: 'up',
    });

    expect(detail.project.plan.milestones[2]?.id).toBe('editing');

    detail = deleteProjectMilestone({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      milestoneId: 'editing',
    });

    expect(detail.project.plan.milestones.some((milestone) => milestone.id === 'editing')).toBe(false);
  });

  it('deletes and reorders tasks using persisted task order', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      objective: 'Ship the web UI',
    });

    createProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'task-a',
      title: 'Task A',
      status: 'pending',
    });
    createProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'task-b',
      title: 'Task B',
      status: 'pending',
    });
    createProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'task-c',
      title: 'Task C',
      status: 'pending',
    });

    let detail = moveProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'task-c',
      direction: 'up',
    });

    expect(detail.tasks.map((task) => task.id)).toEqual(['task-a', 'task-c', 'task-b']);

    detail = deleteProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'task-c',
    });

    expect(detail.tasks.map((task) => task.id)).toEqual(['task-a', 'task-b']);
  });

  it('deletes a project directory recursively', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      objective: 'Ship the web UI',
    });

    createProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'task-a',
      title: 'Task A',
      status: 'pending',
    });

    const paths = resolveProjectPaths({ repoRoot, profile: 'datadog', projectId: 'web-ui' });
    expect(existsSync(paths.projectDir)).toBe(true);

    const result = deleteProjectRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
    });

    expect(result).toEqual({ ok: true, deletedProjectId: 'web-ui' });
    expect(existsSync(paths.projectDir)).toBe(false);
  });

  it('reads and saves raw project and task yaml', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      objective: 'Ship the web UI',
    });

    createProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'task-a',
      title: 'Task A',
      status: 'pending',
    });

    const projectSource = readProjectSource({ repoRoot, profile: 'datadog', projectId: 'web-ui' });
    expect(projectSource.path).toContain('PROJECT.yaml');

    const savedProject = saveProjectSource({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      content: projectSource.content.replace('status: created', 'status: blocked'),
    });
    expect(savedProject.project.status).toBe('blocked');

    const taskSource = readProjectTaskSource({ repoRoot, profile: 'datadog', projectId: 'web-ui', taskId: 'task-a' });
    expect(taskSource.path).toContain('task-a.yaml');

    const savedTask = saveProjectTaskSource({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'task-a',
      content: taskSource.content.replace('status: pending', 'status: running'),
    });
    expect(savedTask.tasks.find((task) => task.id === 'task-a')?.status).toBe('running');
  });
});
