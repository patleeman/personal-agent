import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createStoredAutomationMock,
  existsSyncMock,
  findTaskForProfileMock,
  invalidateAppTopicsMock,
  loadScheduledTasksForProfileMock,
  readFileSyncMock,
  startScheduledTaskRunMock,
  toScheduledTaskMetadataMock,
  updateStoredAutomationMock,
} = vi.hoisted(() => ({
  createStoredAutomationMock: vi.fn(),
  existsSyncMock: vi.fn(),
  findTaskForProfileMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  loadScheduledTasksForProfileMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  startScheduledTaskRunMock: vi.fn(),
  toScheduledTaskMetadataMock: vi.fn(),
  updateStoredAutomationMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
}));

vi.mock('@personal-agent/daemon', () => ({
  createStoredAutomation: createStoredAutomationMock,
  startScheduledTaskRun: startScheduledTaskRunMock,
  updateStoredAutomation: updateStoredAutomationMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
}));

vi.mock('./taskService.js', () => ({
  findTaskForProfile: findTaskForProfileMock,
  readRequiredTaskId: (value: unknown) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      throw new Error('taskId is required.');
    }
    return normalized;
  },
}));

vi.mock('./scheduledTasks.js', () => ({
  loadScheduledTasksForProfile: loadScheduledTasksForProfileMock,
  toScheduledTaskMetadata: toScheduledTaskMetadataMock,
}));

import {
  buildScheduledTaskDetail,
  createScheduledTaskCapability,
  listScheduledTasksCapability,
  readScheduledTaskCapability,
  readScheduledTaskLogCapability,
  runScheduledTaskCapability,
  updateScheduledTaskCapability,
} from './scheduledTaskCapability.js';

type TestTask = {
  id: string;
  title: string;
  legacyFilePath: string;
  schedule: { type: 'cron'; expression: string } | { type: 'at'; at: string };
  enabled: boolean;
  prompt: string;
  modelRef?: string;
  thinkingLevel?: string;
  cwd?: string;
  timeoutSeconds?: number;
};

function createTask(overrides: Partial<TestTask> = {}): TestTask {
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Task 1',
    legacyFilePath: overrides.legacyFilePath ?? `/tasks/${overrides.id ?? 'task-1'}.md`,
    schedule: overrides.schedule ?? { type: 'cron', expression: '0 * * * *' },
    enabled: overrides.enabled ?? true,
    prompt: overrides.prompt ?? 'Prompt body',
    modelRef: overrides.modelRef ?? 'gpt-4o',
    thinkingLevel: overrides.thinkingLevel ?? 'high',
    cwd: overrides.cwd ?? '/repo',
    timeoutSeconds: overrides.timeoutSeconds ?? 120,
  };
}

function createRuntime(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    running: true,
    lastStatus: 'success',
    lastRunAt: '2026-04-09T15:00:00.000Z',
    lastSuccessAt: '2026-04-09T15:00:00.000Z',
    lastAttemptCount: 2,
    lastLogPath: '/tmp/task.log',
    ...overrides,
  };
}

function toMetadata(task: TestTask) {
  return {
    id: task.id,
    title: task.title,
    scheduleType: task.schedule.type,
    enabled: task.enabled,
    cron: task.schedule.type === 'cron' ? task.schedule.expression : undefined,
    at: task.schedule.type === 'at' ? task.schedule.at : undefined,
    model: task.modelRef,
    thinkingLevel: task.thinkingLevel,
    cwd: task.cwd,
    timeoutSeconds: task.timeoutSeconds,
    promptBody: task.prompt,
  };
}

describe('scheduledTaskCapability', () => {
  beforeEach(() => {
    createStoredAutomationMock.mockReset();
    existsSyncMock.mockReset();
    findTaskForProfileMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    loadScheduledTasksForProfileMock.mockReset();
    readFileSyncMock.mockReset();
    startScheduledTaskRunMock.mockReset();
    toScheduledTaskMetadataMock.mockReset();
    updateStoredAutomationMock.mockReset();
    toScheduledTaskMetadataMock.mockImplementation((task: TestTask) => toMetadata(task));
  });

  it('lists scheduled tasks with runtime fallbacks', async () => {
    const cronTask = createTask({
      id: 'task-1',
      title: 'Cron task',
      prompt: 'First line\nSecond line',
    });
    const atTask = createTask({
      id: 'task-2',
      title: 'One-off task',
      enabled: false,
      prompt: 'One-off prompt',
      schedule: { type: 'at', at: '2026-04-10T00:00:00.000Z' },
    });
    loadScheduledTasksForProfileMock.mockReturnValue({
      tasks: [cronTask, atTask],
      runtimeState: {
        'task-1': createRuntime(),
      },
      runtimeEntries: [createRuntime({
        id: 'task-2',
        running: false,
        lastStatus: 'idle',
        lastRunAt: '2026-04-08T00:00:00.000Z',
      })],
    });

    await expect(listScheduledTasksCapability('assistant')).resolves.toEqual([
      {
        id: 'task-1',
        title: 'Cron task',
        filePath: '/tasks/task-1.md',
        scheduleType: 'cron',
        running: true,
        enabled: true,
        cron: '0 * * * *',
        at: undefined,
        prompt: 'First line',
        model: 'gpt-4o',
        thinkingLevel: 'high',
        cwd: '/repo',
        lastStatus: 'success',
        lastRunAt: '2026-04-09T15:00:00.000Z',
        lastSuccessAt: '2026-04-09T15:00:00.000Z',
        lastAttemptCount: 2,
      },
      {
        id: 'task-2',
        title: 'One-off task',
        filePath: '/tasks/task-2.md',
        scheduleType: 'at',
        running: false,
        enabled: false,
        cron: undefined,
        at: '2026-04-10T00:00:00.000Z',
        prompt: 'One-off prompt',
        model: 'gpt-4o',
        thinkingLevel: 'high',
        cwd: '/repo',
        lastStatus: 'idle',
        lastRunAt: '2026-04-08T00:00:00.000Z',
        lastSuccessAt: '2026-04-09T15:00:00.000Z',
        lastAttemptCount: 2,
      },
    ]);
  });

  it('builds, reads, creates, and updates task details', async () => {
    const createdTask = createTask({ id: 'task-created', title: 'Created task', prompt: 'Stored prompt' });
    const storedTask = createTask({ id: 'task-created', title: 'Saved task', prompt: 'Saved prompt' });

    expect(buildScheduledTaskDetail(storedTask, createRuntime({ id: 'task-created', running: false }))).toEqual({
      ...createRuntime({ id: 'task-created', running: false }),
      id: 'task-created',
      title: 'Saved task',
      filePath: '/tasks/task-created.md',
      scheduleType: 'cron',
      running: false,
      enabled: true,
      cron: '0 * * * *',
      at: undefined,
      model: 'gpt-4o',
      thinkingLevel: 'high',
      cwd: '/repo',
      timeoutSeconds: 120,
      prompt: 'Saved prompt',
      lastStatus: 'success',
      lastRunAt: '2026-04-09T15:00:00.000Z',
    });

    findTaskForProfileMock.mockReturnValueOnce({ task: storedTask, runtime: createRuntime({ id: 'task-created', running: false }) });
    await expect(readScheduledTaskCapability('assistant', 'task-created')).resolves.toEqual({
      ...createRuntime({ id: 'task-created', running: false }),
      id: 'task-created',
      title: 'Saved task',
      filePath: '/tasks/task-created.md',
      scheduleType: 'cron',
      running: false,
      enabled: true,
      cron: '0 * * * *',
      at: undefined,
      model: 'gpt-4o',
      thinkingLevel: 'high',
      cwd: '/repo',
      timeoutSeconds: 120,
      prompt: 'Saved prompt',
      lastStatus: 'success',
      lastRunAt: '2026-04-09T15:00:00.000Z',
    });

    createStoredAutomationMock.mockReturnValue(createdTask);
    findTaskForProfileMock.mockReturnValueOnce({
      task: storedTask,
      runtime: createRuntime({ id: 'task-created', running: false }),
    });
    await expect(createScheduledTaskCapability('assistant', {
      title: 'Created task',
      enabled: false,
      cron: '*/5 * * * *',
      model: 'claude',
      thinkingLevel: 'medium',
      cwd: '/tmp/work',
      timeoutSeconds: 45,
      prompt: 'Body',
    })).resolves.toEqual({
      ok: true,
      task: {
        ...createRuntime({ id: 'task-created', running: false }),
        id: 'task-created',
        title: 'Saved task',
        filePath: '/tasks/task-created.md',
        scheduleType: 'cron',
        running: false,
        enabled: true,
        cron: '0 * * * *',
        at: undefined,
        model: 'gpt-4o',
        thinkingLevel: 'high',
        cwd: '/repo',
        timeoutSeconds: 120,
        prompt: 'Saved prompt',
        lastStatus: 'success',
        lastRunAt: '2026-04-09T15:00:00.000Z',
      },
    });
    expect(createStoredAutomationMock).toHaveBeenCalledWith({
      profile: 'assistant',
      title: 'Created task',
      enabled: false,
      cron: '*/5 * * * *',
      at: undefined,
      modelRef: 'claude',
      thinkingLevel: 'medium',
      cwd: '/tmp/work',
      timeoutSeconds: 45,
      prompt: 'Body',
    });
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('tasks');

    const updatedTask = createTask({ id: 'task-created', title: 'Updated task', prompt: 'Updated prompt' });
    findTaskForProfileMock
      .mockReturnValueOnce({ task: storedTask, runtime: createRuntime({ id: 'task-created', running: false }) })
      .mockReturnValueOnce({ task: updatedTask, runtime: createRuntime({ id: 'task-created', running: true }) });
    updateStoredAutomationMock.mockReturnValue(updatedTask);

    await expect(updateScheduledTaskCapability('assistant', {
      taskId: 'task-created',
      title: 'Updated task',
      prompt: 'Updated prompt',
    })).resolves.toEqual({
      ok: true,
      task: {
        ...createRuntime({ id: 'task-created', running: true }),
        id: 'task-created',
        title: 'Updated task',
        filePath: '/tasks/task-created.md',
        scheduleType: 'cron',
        running: true,
        enabled: true,
        cron: '0 * * * *',
        at: undefined,
        model: 'gpt-4o',
        thinkingLevel: 'high',
        cwd: '/repo',
        timeoutSeconds: 120,
        prompt: 'Updated prompt',
        lastStatus: 'success',
        lastRunAt: '2026-04-09T15:00:00.000Z',
      },
    });
    expect(updateStoredAutomationMock).toHaveBeenCalledWith('task-created', expect.objectContaining({
      title: 'Updated task',
      prompt: 'Updated prompt',
    }));
    expect(invalidateAppTopicsMock).toHaveBeenCalledTimes(2);
  });

  it('reads task logs and reports missing logs', async () => {
    const task = createTask({ id: 'task-1' });

    findTaskForProfileMock.mockReturnValueOnce(undefined);
    await expect(readScheduledTaskLogCapability('assistant', 'task-1')).rejects.toThrow('No log available');

    findTaskForProfileMock.mockReturnValueOnce({ task, runtime: createRuntime() });
    existsSyncMock.mockReturnValue(false);
    await expect(readScheduledTaskLogCapability('assistant', 'task-1')).rejects.toThrow('No log available');

    findTaskForProfileMock.mockReturnValueOnce({ task, runtime: createRuntime() });
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('task log');
    await expect(readScheduledTaskLogCapability('assistant', 'task-1')).resolves.toEqual({
      log: 'task log',
      path: '/tmp/task.log',
    });
  });

  it('runs tasks and reports missing, blank, and rejected runs', async () => {
    findTaskForProfileMock.mockReturnValueOnce(undefined);
    await expect(runScheduledTaskCapability('assistant', 'task-1')).rejects.toThrow('Task not found');

    findTaskForProfileMock.mockReturnValueOnce({ task: createTask({ prompt: '   ' }), runtime: createRuntime() });
    await expect(runScheduledTaskCapability('assistant', 'task-1')).rejects.toThrow('Task has no prompt body');

    findTaskForProfileMock.mockReturnValueOnce({ task: createTask(), runtime: createRuntime() });
    startScheduledTaskRunMock.mockResolvedValueOnce({ accepted: false, reason: 'busy' });
    await expect(runScheduledTaskCapability('assistant', 'task-1')).rejects.toThrow('busy');

    findTaskForProfileMock.mockReturnValueOnce({ task: createTask(), runtime: createRuntime() });
    startScheduledTaskRunMock.mockResolvedValueOnce({ accepted: true, runId: 'run-1' });
    await expect(runScheduledTaskCapability('assistant', 'task-1')).resolves.toEqual({
      ok: true,
      accepted: true,
      runId: 'run-1',
    });
  });
});
