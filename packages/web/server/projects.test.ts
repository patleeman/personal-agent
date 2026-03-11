import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createProjectScaffold,
  createProjectTask,
  resolveProjectTaskPath,
  writeProjectTask,
} from '@personal-agent/core';
import { afterEach, describe, expect, it } from 'vitest';
import { readProjectDetailFromProject, sortProjectTasks } from './projects.js';

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
  it('orders active and blocked tasks before completed work', () => {
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
});

describe('readProjectDetailFromProject', () => {
  it('returns summary, plan, and sorted tasks from project storage', () => {
    const repoRoot = createTempRepo();

    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
      objective: 'Ship the project UI',
      now: new Date('2026-03-11T01:00:00.000Z'),
    });

    writeProjectTask(
      resolveProjectTaskPath({ repoRoot, profile: 'datadog', projectId: 'web-ui', taskId: 'completed-task' }),
      createProjectTask({
        id: 'completed-task',
        createdAt: '2026-03-11T01:10:00.000Z',
        updatedAt: '2026-03-11T03:10:00.000Z',
        status: 'completed',
        title: 'Polish the list page',
      }),
    );

    writeProjectTask(
      resolveProjectTaskPath({ repoRoot, profile: 'datadog', projectId: 'web-ui', taskId: 'running-task' }),
      createProjectTask({
        id: 'running-task',
        createdAt: '2026-03-11T01:20:00.000Z',
        updatedAt: '2026-03-11T04:10:00.000Z',
        status: 'running',
        title: 'Build the project detail card',
        summary: 'Render summary, plan, and tasks together.',
      }),
    );

    const detail = readProjectDetailFromProject({
      repoRoot,
      profile: 'datadog',
      projectId: 'web-ui',
    });

    expect(detail.id).toBe('web-ui');
    expect(detail.summary.objective).toBe('Ship the project UI');
    expect(detail.plan.steps).toHaveLength(3);
    expect(detail.taskCount).toBe(2);
    expect(detail.artifactCount).toBe(0);
    expect(detail.tasks.map((task) => task.id)).toEqual(['running-task', 'completed-task']);
    expect(detail.tasks[0]).toEqual(expect.objectContaining({
      status: 'running',
      summary: 'Render summary, plan, and tasks together.',
    }));
  });
});
