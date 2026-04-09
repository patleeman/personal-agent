import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedTaskDefinition } from './tasks-parser.js';

const {
  scheduleRunMock,
  resolveDurableRunsRootMock,
  resolveDurableRunPathsMock,
} = vi.hoisted(() => ({
  scheduleRunMock: vi.fn(),
  resolveDurableRunsRootMock: vi.fn(),
  resolveDurableRunPathsMock: vi.fn(),
}));

vi.mock('../runs/schedule-run.js', () => ({
  scheduleRun: scheduleRunMock,
}));

vi.mock('../runs/store.js', () => ({
  resolveDurableRunsRoot: resolveDurableRunsRootMock,
  resolveDurableRunPaths: resolveDurableRunPathsMock,
}));

import { getTaskRunPaths, scheduleTask, taskToScheduleInput } from './schedule-task.js';

function createTask(overrides: Partial<ParsedTaskDefinition> = {}): ParsedTaskDefinition {
  return {
    key: 'daily-status',
    id: 'daily-status',
    filePath: '/tmp/daily-status.task.md',
    fileName: 'daily-status.task.md',
    title: 'Daily status',
    enabled: true,
    schedule: {
      type: 'cron',
      expression: '0 9 * * 1-5',
      parsed: {
        expression: '0 9 * * 1-5',
        minutes: [0],
        hours: [9],
        dayOfMonth: null,
        month: null,
        dayOfWeek: [1, 2, 3, 4, 5],
      },
    },
    prompt: 'Summarize yesterday and plan today.',
    profile: 'assistant',
    modelRef: 'gpt-5.4',
    timeoutSeconds: 1800,
    ...overrides,
  } as ParsedTaskDefinition;
}

describe('schedule-task helpers', () => {
  beforeEach(() => {
    scheduleRunMock.mockReset();
    resolveDurableRunsRootMock.mockReset();
    resolveDurableRunPathsMock.mockReset();
  });

  it('converts cron tasks into scheduleRun inputs', () => {
    const task = createTask();

    expect(taskToScheduleInput(task)).toEqual({
      trigger: { type: 'cron', expression: '0 9 * * 1-5' },
      target: {
        type: 'agent',
        prompt: 'Summarize yesterday and plan today.',
        profile: 'assistant',
        model: 'gpt-5.4',
      },
      source: {
        type: 'task',
        id: 'daily-status',
        filePath: '/tmp/daily-status.task.md',
      },
      metadata: {
        taskId: 'daily-status',
        taskFilePath: '/tmp/daily-status.task.md',
        timeoutSeconds: 1800,
      },
    });
  });

  it('converts one-time tasks and allows explicit profile/model overrides', () => {
    const task = createTask({
      schedule: {
        type: 'at',
        at: '2026-03-20T09:30:00.000Z',
        atMs: Date.parse('2026-03-20T09:30:00.000Z'),
      },
      profile: 'shared',
      modelRef: 'old-model',
    });

    expect(taskToScheduleInput(task, { profile: 'assistant', model: 'gpt-5.5' })).toEqual(expect.objectContaining({
      trigger: { type: 'at', at: new Date('2026-03-20T09:30:00.000Z') },
      target: expect.objectContaining({
        profile: 'assistant',
        model: 'gpt-5.5',
      }),
    }));
  });

  it('falls back to an immediate trigger when the task has no parsed schedule', () => {
    const task = createTask({ schedule: undefined as never });

    expect(taskToScheduleInput(task).trigger).toEqual({ type: 'now' });
  });

  it('schedules a task through scheduleRun and returns the durable runs root', async () => {
    const task = createTask();
    scheduleRunMock.mockResolvedValue({ runId: 'run-123' });
    resolveDurableRunsRootMock.mockReturnValue('/tmp/daemon/runs');

    await expect(scheduleTask('/tmp/daemon', task, { profile: 'override' })).resolves.toEqual({
      runId: 'run-123',
      runsRoot: '/tmp/daemon/runs',
    });

    expect(scheduleRunMock).toHaveBeenCalledWith('/tmp/daemon', expect.objectContaining({
      target: expect.objectContaining({ profile: 'override' }),
      source: expect.objectContaining({ id: 'daily-status' }),
    }));
    expect(resolveDurableRunsRootMock).toHaveBeenCalledWith('/tmp/daemon');
  });

  it('resolves task run paths from the daemon root and run id', () => {
    resolveDurableRunsRootMock.mockReturnValue('/tmp/daemon/runs');
    resolveDurableRunPathsMock.mockReturnValue({ manifestPath: '/tmp/daemon/runs/run-123/manifest.json' });

    expect(getTaskRunPaths('/tmp/daemon', 'run-123')).toEqual({
      manifestPath: '/tmp/daemon/runs/run-123/manifest.json',
    });
    expect(resolveDurableRunsRootMock).toHaveBeenCalledWith('/tmp/daemon');
    expect(resolveDurableRunPathsMock).toHaveBeenCalledWith('/tmp/daemon/runs', 'run-123');
  });
});
