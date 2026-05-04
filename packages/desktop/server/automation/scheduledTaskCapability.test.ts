import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clearTaskCallbackBindingMock,
  getTaskCallbackBindingMock,
  setTaskCallbackBindingMock,
  createStoredAutomationMock,
  deleteStoredAutomationMock,
  ensureAutomationThreadMock,
  existsSyncMock,
  findTaskForProfileMock,
  listAutomationActivityEntriesMock,
  loadAutomationSchedulerStateMock,
  invalidateAppTopicsMock,
  loadScheduledTasksForProfileMock,
  readFileSyncMock,
  startScheduledTaskRunMock,
  toScheduledTaskMetadataMock,
  normalizeAutomationTargetTypeForSelectionMock,
  updateStoredAutomationMock,
  applyScheduledTaskThreadBindingMock,
  buildScheduledTaskThreadDetailMock,
  resolveScheduledTaskThreadBindingMock,
} = vi.hoisted(() => ({
  clearTaskCallbackBindingMock: vi.fn(),
  getTaskCallbackBindingMock: vi.fn(),
  setTaskCallbackBindingMock: vi.fn(),
  createStoredAutomationMock: vi.fn(),
  deleteStoredAutomationMock: vi.fn(),
  ensureAutomationThreadMock: vi.fn(),
  existsSyncMock: vi.fn(),
  findTaskForProfileMock: vi.fn(),
  listAutomationActivityEntriesMock: vi.fn(),
  loadAutomationSchedulerStateMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  loadScheduledTasksForProfileMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  startScheduledTaskRunMock: vi.fn(),
  toScheduledTaskMetadataMock: vi.fn(),
  normalizeAutomationTargetTypeForSelectionMock: vi.fn((value: string | null | undefined) =>
    value === 'conversation' ? 'conversation' : 'background-agent',
  ),
  updateStoredAutomationMock: vi.fn(),
  applyScheduledTaskThreadBindingMock: vi.fn(),
  buildScheduledTaskThreadDetailMock: vi.fn(),
  resolveScheduledTaskThreadBindingMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
}));

vi.mock('@personal-agent/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@personal-agent/core')>();
  return {
    ...actual,
    clearTaskCallbackBinding: clearTaskCallbackBindingMock,
    getTaskCallbackBinding: getTaskCallbackBindingMock,
    setTaskCallbackBinding: setTaskCallbackBindingMock,
  };
});

vi.mock('@personal-agent/daemon', () => ({
  createStoredAutomation: createStoredAutomationMock,
  deleteStoredAutomation: deleteStoredAutomationMock,
  ensureAutomationThread: ensureAutomationThreadMock,
  listAutomationActivityEntries: listAutomationActivityEntriesMock,
  loadAutomationSchedulerState: loadAutomationSchedulerStateMock,
  normalizeAutomationTargetTypeForSelection: normalizeAutomationTargetTypeForSelectionMock,
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

vi.mock('./scheduledTaskThreads.js', () => ({
  applyScheduledTaskThreadBinding: applyScheduledTaskThreadBindingMock,
  buildScheduledTaskThreadDetail: buildScheduledTaskThreadDetailMock,
  resolveScheduledTaskThreadBinding: resolveScheduledTaskThreadBindingMock,
}));

import {
  buildScheduledTaskDetail,
  createScheduledTaskCapability,
  deleteScheduledTaskCapability,
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
  threadMode?: 'dedicated' | 'existing' | 'none';
  threadConversationId?: string;
  threadTitle?: string;
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
    threadMode: overrides.threadMode ?? 'dedicated',
    threadConversationId: overrides.threadConversationId ?? `automation.${overrides.id ?? 'task-1'}`,
    threadTitle: overrides.threadTitle ?? `Automation: ${overrides.title ?? 'Task 1'}`,
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
    clearTaskCallbackBindingMock.mockReset();
    getTaskCallbackBindingMock.mockReset();
    setTaskCallbackBindingMock.mockReset();
    getTaskCallbackBindingMock.mockReturnValue(undefined);
    createStoredAutomationMock.mockReset();
    deleteStoredAutomationMock.mockReset();
    ensureAutomationThreadMock.mockReset();
    existsSyncMock.mockReset();
    findTaskForProfileMock.mockReset();
    listAutomationActivityEntriesMock.mockReset();
    listAutomationActivityEntriesMock.mockReturnValue([]);
    loadAutomationSchedulerStateMock.mockReset();
    loadAutomationSchedulerStateMock.mockReturnValue({});
    invalidateAppTopicsMock.mockReset();
    loadScheduledTasksForProfileMock.mockReset();
    readFileSyncMock.mockReset();
    startScheduledTaskRunMock.mockReset();
    toScheduledTaskMetadataMock.mockReset();
    normalizeAutomationTargetTypeForSelectionMock.mockClear();
    updateStoredAutomationMock.mockReset();
    applyScheduledTaskThreadBindingMock.mockReset();
    buildScheduledTaskThreadDetailMock.mockReset();
    resolveScheduledTaskThreadBindingMock.mockReset();
    toScheduledTaskMetadataMock.mockImplementation((task: TestTask) => toMetadata(task));
    applyScheduledTaskThreadBindingMock.mockImplementation(
      (taskId: string, input: { threadMode?: string | null; threadConversationId?: string | null; threadSessionFile?: string | null }) => {
        const sourceTask = [...updateStoredAutomationMock.mock.results, ...createStoredAutomationMock.mock.results]
          .map((result) => result.value as TestTask | undefined)
          .filter((task): task is TestTask => Boolean(task) && task.id === taskId)
          .at(-1);
        return createTask({
          ...sourceTask,
          id: taskId,
          threadMode: (input.threadMode as TestTask['threadMode']) ?? 'dedicated',
          threadConversationId: input.threadConversationId ?? `automation.${taskId}`,
        });
      },
    );
    buildScheduledTaskThreadDetailMock.mockImplementation((task: TestTask) => ({
      threadMode: task.threadMode ?? 'dedicated',
      ...(task.threadConversationId ? { threadConversationId: task.threadConversationId } : {}),
      ...(task.threadTitle ? { threadTitle: task.threadTitle } : {}),
    }));
    resolveScheduledTaskThreadBindingMock.mockImplementation(
      (input: { threadMode?: string | null; threadConversationId?: string | null }) => ({
        mode: (input.threadMode as TestTask['threadMode']) ?? 'dedicated',
        conversationId: input.threadConversationId ?? undefined,
        sessionFile: input.threadConversationId ? `/sessions/${input.threadConversationId}.jsonl` : undefined,
      }),
    );
    ensureAutomationThreadMock.mockImplementation((taskId: string) => createTask({ id: taskId }));
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
      runtimeEntries: [
        createRuntime({
          id: 'task-2',
          running: false,
          lastStatus: 'idle',
          lastRunAt: '2026-04-08T00:00:00.000Z',
        }),
      ],
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
        threadConversationId: 'automation.task-1',
        threadTitle: 'Automation: Cron task',
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
        threadConversationId: 'automation.task-2',
        threadTitle: 'Automation: One-off task',
        lastStatus: 'idle',
        lastRunAt: '2026-04-08T00:00:00.000Z',
        lastSuccessAt: '2026-04-09T15:00:00.000Z',
        lastAttemptCount: 2,
      },
    ]);
  });

  it('ensures dedicated threads before listing tasks when the binding is missing', async () => {
    loadScheduledTasksForProfileMock.mockReturnValue({
      tasks: [createTask({ id: 'task-ensure', title: 'Ensure thread', threadConversationId: '' })],
      runtimeState: {},
      runtimeEntries: [],
    });
    ensureAutomationThreadMock.mockReturnValue(createTask({ id: 'task-ensure', title: 'Ensure thread' }));

    await expect(listScheduledTasksCapability('assistant')).resolves.toEqual([
      expect.objectContaining({
        id: 'task-ensure',
        threadConversationId: 'automation.task-ensure',
        threadTitle: 'Automation: Ensure thread',
      }),
    ]);
    expect(ensureAutomationThreadMock).toHaveBeenCalledWith('task-ensure');
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
      activity: [],
      lastStatus: 'success',
      lastRunAt: '2026-04-09T15:00:00.000Z',
      threadMode: 'dedicated',
      threadConversationId: 'automation.task-created',
      threadTitle: 'Automation: Saved task',
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
      activity: [],
      lastStatus: 'success',
      lastRunAt: '2026-04-09T15:00:00.000Z',
      threadMode: 'dedicated',
      threadConversationId: 'automation.task-created',
      threadTitle: 'Automation: Saved task',
    });

    createStoredAutomationMock.mockReturnValue(createdTask);
    findTaskForProfileMock.mockReturnValueOnce({
      task: storedTask,
      runtime: createRuntime({ id: 'task-created', running: false }),
    });
    await expect(
      createScheduledTaskCapability('assistant', {
        title: 'Created task',
        enabled: false,
        cron: '*/5 * * * *',
        model: 'claude',
        thinkingLevel: 'medium',
        cwd: '/tmp/work',
        timeoutSeconds: 45,
        prompt: 'Body',
      }),
    ).resolves.toEqual({
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
        activity: [],
        lastStatus: 'success',
        lastRunAt: '2026-04-09T15:00:00.000Z',
        threadMode: 'dedicated',
        threadConversationId: 'automation.task-created',
        threadTitle: 'Automation: Saved task',
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
      targetType: 'background-agent',
    });
    expect(applyScheduledTaskThreadBindingMock).toHaveBeenNthCalledWith(1, 'task-created', {
      threadMode: 'dedicated',
      threadConversationId: undefined,
      threadSessionFile: undefined,
      cwd: '/tmp/work',
    });
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('tasks');

    const updatedTask = createTask({ id: 'task-created', title: 'Updated task', prompt: 'Updated prompt' });
    findTaskForProfileMock
      .mockReturnValueOnce({ task: storedTask, runtime: createRuntime({ id: 'task-created', running: false }) })
      .mockReturnValueOnce({ task: updatedTask, runtime: createRuntime({ id: 'task-created', running: true }) });
    updateStoredAutomationMock.mockReturnValue(updatedTask);

    await expect(
      updateScheduledTaskCapability('assistant', {
        taskId: 'task-created',
        title: 'Updated task',
        prompt: 'Updated prompt',
      }),
    ).resolves.toEqual({
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
        activity: [],
        lastStatus: 'success',
        lastRunAt: '2026-04-09T15:00:00.000Z',
        threadMode: 'dedicated',
        threadConversationId: 'automation.task-created',
        threadTitle: 'Automation: Updated task',
      },
    });
    expect(updateStoredAutomationMock).toHaveBeenCalledWith(
      'task-created',
      expect.objectContaining({
        title: 'Updated task',
        prompt: 'Updated prompt',
      }),
    );
    expect(applyScheduledTaskThreadBindingMock).toHaveBeenNthCalledWith(2, 'task-created', {
      threadMode: 'dedicated',
      threadConversationId: undefined,
      threadSessionFile: undefined,
      cwd: '/repo',
    });
    expect(invalidateAppTopicsMock).toHaveBeenCalledTimes(2);
  });

  it('deletes tasks and clears callback bindings', async () => {
    const task = createTask({ id: 'task-1' });

    findTaskForProfileMock.mockReturnValueOnce(undefined);
    await expect(deleteScheduledTaskCapability('assistant', 'task-1')).rejects.toThrow('Task not found');

    findTaskForProfileMock.mockReturnValueOnce({ task, runtime: createRuntime() });
    deleteStoredAutomationMock.mockReturnValueOnce(true);
    await expect(deleteScheduledTaskCapability('assistant', 'task-1')).resolves.toEqual({
      ok: true,
      deleted: true,
    });
    expect(deleteStoredAutomationMock).toHaveBeenCalledWith('task-1', { profile: 'assistant' });
    expect(clearTaskCallbackBindingMock).toHaveBeenCalledWith({ profile: 'assistant', taskId: 'task-1' });
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('tasks');
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
