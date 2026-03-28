import { existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createProjectScaffold, resolveProjectPaths } from '@personal-agent/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProjectRecord,
  createProjectTaskRecord,
  deleteProjectRecord,
  deleteProjectTaskRecord,
  moveProjectTaskRecord,
  readProjectDetailFromProject,
  readProjectSource,
  saveProjectSource,
  setProjectArchivedState,
  sortProjectTasks,
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
  process.env.PERSONAL_AGENT_STATE_ROOT = dir;
  process.env.PERSONAL_AGENT_PROFILES_ROOT = join(dir, 'sync', 'profiles');
  return dir;
}

describe('sortProjectTasks', () => {
  it('preserves task order from state.yaml', () => {
    const sorted = sortProjectTasks([
      { id: 'task-b', status: 'done', title: 'B' },
      { id: 'task-a', status: 'todo', title: 'A' },
    ]);

    expect(sorted.map((task) => task.id)).toEqual(['task-b', 'task-a']);
  });
});

describe('readProjectDetailFromProject', () => {
  it('returns the project document, files, notes, and flat tasks from project storage', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      title: 'Project UI',
      description: 'Ship the project UI',
      now: new Date('2026-03-11T01:00:00.000Z'),
    });

    createProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'in-progress-task',
      status: 'doing',
      title: 'Build the project detail card',
    });

    const detail = readProjectDetailFromProject({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
    });

    expect(detail.project.id).toBe('web-ui');
    expect(detail.project.title).toBe('Project UI');
    expect(detail.project.description).toBe('Ship the project UI');
    expect(detail.project.plan.milestones).toHaveLength(0);
    expect(detail.project.plan.tasks).toEqual([
      {
        id: 'in-progress-task',
        status: 'doing',
        title: 'Build the project detail card',
      },
    ]);
    expect(detail.taskCount).toBe(1);
    expect(detail.noteCount).toBe(0);
    expect(detail.fileCount).toBe(0);
    expect(detail.document?.content).toContain('Ship the project UI');
  });
});

describe('project editing helpers', () => {
  it('creates a project record with simplified editable fields', () => {
    const repoRoot = createTempRepo();

    const detail = createProjectRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'artifact-model',
      title: 'Artifact model',
      description: 'Build the artifact model',
      projectRepoRoot: '../workspace/artifact-model',
      summary: 'The storage model is taking shape.',
      status: 'active',
    });

    expect(detail.project.title).toBe('Artifact model');
    expect(detail.project.description).toBe('Build the artifact model');
    expect(detail.project.repoRoot).toBe(resolve(repoRoot, '../workspace/artifact-model'));
    expect(detail.project.summary).toBe('The storage model is taking shape.');
    expect(detail.project.status).toBe('active');
    expect(detail.document?.content).toContain('Build the artifact model');
  });

  it('updates simplified project fields', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'artifact-model',
      title: 'Artifact model',
      description: 'Build the artifact model',
    });

    const detail = updateProjectRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'artifact-model',
      title: 'Durable artifact model',
      description: 'Keep the durable record editable in place.',
      summary: 'state.yaml is now canonical.',
      projectRepoRoot: '../workspace/artifact-model',
      status: 'paused',
    });

    expect(detail.project.title).toBe('Durable artifact model');
    expect(detail.project.description).toBe('Keep the durable record editable in place.');
    expect(detail.project.summary).toBe('state.yaml is now canonical.');
    expect(detail.project.repoRoot).toBe(resolve(repoRoot, '../workspace/artifact-model'));
    expect(detail.project.status).toBe('paused');
    expect(detail.project.plan.milestones).toHaveLength(0);
  });

  it('creates, updates, reorders, and deletes flat task records', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      title: 'Project UI',
      description: 'Ship the project UI',
    });

    createProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'first-task',
      status: 'todo',
      title: 'First task',
    });
    createProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'second-task',
      status: 'doing',
      title: 'Second task',
    });

    const updated = updateProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'first-task',
      status: 'done',
      title: 'First task complete',
    });
    expect(updated.tasks[0]).toEqual({
      id: 'first-task',
      status: 'done',
      title: 'First task complete',
    });

    const moved = moveProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'second-task',
      direction: 'up',
    });
    expect(moved.tasks.map((task) => task.id)).toEqual(['second-task', 'first-task']);

    const deleted = deleteProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      taskId: 'first-task',
    });
    expect(deleted.tasks.map((task) => task.id)).toEqual(['second-task']);
  });

  it('archives and restores a project without changing its workflow status', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'archive-me',
      title: 'Archive me',
      description: 'Keep the history intact',
    });

    const archived = setProjectArchivedState({
      repoRoot,
      profile: 'datadog',
      projectId: 'archive-me',
      archived: true,
    });
    expect(archived.project.archivedAt).toBeTruthy();
    expect(archived.project.status).toBe('active');

    const restored = setProjectArchivedState({
      repoRoot,
      profile: 'datadog',
      projectId: 'archive-me',
      archived: false,
    });
    expect(restored.project.archivedAt).toBeUndefined();
    expect(restored.project.status).toBe('active');
  });

  it('reads and saves raw project yaml', () => {
    const repoRoot = createTempRepo();

    createProjectRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      title: 'Project UI',
      description: 'Ship the web UI',
      summary: 'A new project page.',
      status: 'active',
    });

    const projectSource = readProjectSource({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
    });

    const savedProject = saveProjectSource({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      content: projectSource.content.replace('status: active', 'status: paused'),
    });

    expect(savedProject.project.status).toBe('paused');
  });

  it('deletes a project directory recursively', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'delete-me',
      title: 'Delete me',
      description: 'Clean up the project dir.',
    });

    const result = deleteProjectRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'delete-me',
    });

    expect(result).toEqual({ ok: true, deletedProjectId: 'delete-me' });
    expect(existsSync(resolveProjectPaths({ repoRoot, profile: 'datadog', projectId: 'delete-me' }).projectDir)).toBe(false);
  });
});
