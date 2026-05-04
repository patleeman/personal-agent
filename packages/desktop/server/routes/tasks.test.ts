import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clearTaskCallbackBindingMock,
  createStoredAutomationMock,
  deleteStoredAutomationMock,
  ensureAutomationThreadMock,
  existsSyncMock,
  findTaskForProfileMock,
  listAutomationActivityEntriesMock,
  loadAutomationSchedulerStateMock,
  invalidateAppTopicsMock,
  loadScheduledTasksForProfileMock,
  logErrorMock,
  readFileSyncMock,
  startScheduledTaskRunMock,
  toScheduledTaskMetadataMock,
  normalizeAutomationTargetTypeForSelectionMock,
  updateStoredAutomationMock,
  applyScheduledTaskThreadBindingMock,
  buildScheduledTaskThreadDetailMock,
  readScheduledTaskSchedulerHealthMock,
  resolveScheduledTaskThreadBindingMock,
} = vi.hoisted(() => ({
  clearTaskCallbackBindingMock: vi.fn(),
  createStoredAutomationMock: vi.fn(),
  deleteStoredAutomationMock: vi.fn(),
  ensureAutomationThreadMock: vi.fn(),
  existsSyncMock: vi.fn(),
  findTaskForProfileMock: vi.fn(),
  listAutomationActivityEntriesMock: vi.fn(),
  loadAutomationSchedulerStateMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  loadScheduledTasksForProfileMock: vi.fn(),
  logErrorMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  startScheduledTaskRunMock: vi.fn(),
  toScheduledTaskMetadataMock: vi.fn(),
  normalizeAutomationTargetTypeForSelectionMock: vi.fn((value: string | null | undefined) =>
    value === 'conversation' ? 'conversation' : 'background-agent',
  ),
  updateStoredAutomationMock: vi.fn(),
  applyScheduledTaskThreadBindingMock: vi.fn(),
  buildScheduledTaskThreadDetailMock: vi.fn(),
  readScheduledTaskSchedulerHealthMock: vi.fn(),
  resolveScheduledTaskThreadBindingMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
}));

vi.mock('@personal-agent/core', () => ({
  clearTaskCallbackBinding: clearTaskCallbackBindingMock,
}));

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

vi.mock('../middleware/index.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
  logError: logErrorMock,
}));

vi.mock('../automation/taskService.js', () => ({
  findTaskForProfile: findTaskForProfileMock,
}));

vi.mock('../automation/scheduledTasks.js', () => ({
  loadScheduledTasksForProfile: loadScheduledTasksForProfileMock,
  toScheduledTaskMetadata: toScheduledTaskMetadataMock,
}));

vi.mock('../automation/scheduledTaskCapability.js', () => ({
  readScheduledTaskSchedulerHealth: readScheduledTaskSchedulerHealthMock,
}));

vi.mock('../automation/scheduledTaskThreads.js', () => ({
  applyScheduledTaskThreadBinding: applyScheduledTaskThreadBindingMock,
  buildScheduledTaskThreadDetail: buildScheduledTaskThreadDetailMock,
  resolveScheduledTaskThreadBinding: resolveScheduledTaskThreadBindingMock,
}));

import { registerTaskRoutes } from './tasks.js';

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

describe('registerTaskRoutes', () => {
  beforeEach(() => {
    clearTaskCallbackBindingMock.mockReset();
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
    logErrorMock.mockReset();
    readFileSyncMock.mockReset();
    startScheduledTaskRunMock.mockReset();
    toScheduledTaskMetadataMock.mockReset();
    normalizeAutomationTargetTypeForSelectionMock.mockClear();
    updateStoredAutomationMock.mockReset();
    applyScheduledTaskThreadBindingMock.mockReset();
    buildScheduledTaskThreadDetailMock.mockReset();
    readScheduledTaskSchedulerHealthMock.mockReset();
    readScheduledTaskSchedulerHealthMock.mockReturnValue({
      status: 'unknown',
      staleAfterSeconds: 900,
      checkedAt: '2026-04-09T15:00:00.000Z',
    });
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

  function createHarness() {
    const handlers: Record<string, (req: unknown, res: unknown) => Promise<void> | void> = {};
    const router = {
      get: vi.fn((path: string, next: (req: unknown, res: unknown) => Promise<void> | void) => {
        handlers[`GET ${path}`] = next;
      }),
      post: vi.fn((path: string, next: (req: unknown, res: unknown) => Promise<void> | void) => {
        handlers[`POST ${path}`] = next;
      }),
      patch: vi.fn((path: string, next: (req: unknown, res: unknown) => Promise<void> | void) => {
        handlers[`PATCH ${path}`] = next;
      }),
      delete: vi.fn((path: string, next: (req: unknown, res: unknown) => Promise<void> | void) => {
        handlers[`DELETE ${path}`] = next;
      }),
    };

    registerTaskRoutes(router as never, { getCurrentProfile: () => 'assistant' });

    return {
      listHandler: handlers['GET /api/tasks']!,
      createHandler: handlers['POST /api/tasks']!,
      patchHandler: handlers['PATCH /api/tasks/:id']!,
      deleteHandler: handlers['DELETE /api/tasks/:id']!,
      logHandler: handlers['GET /api/tasks/:id/log']!,
      detailHandler: handlers['GET /api/tasks/:id']!,
      runHandler: handlers['POST /api/tasks/:id/run']!,
    };
  }

  function createResponse() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  }

  it('lists tasks using runtime state and runtime entry fallbacks and logs list failures', () => {
    const { listHandler } = createHarness();
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

    const res = createResponse();
    listHandler({}, res);

    expect(loadScheduledTasksForProfileMock).toHaveBeenCalledWith('assistant');
    expect(res.json).toHaveBeenCalledWith([
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

    loadScheduledTasksForProfileMock.mockImplementation(() => {
      throw new Error('list failed');
    });
    const failingRes = createResponse();
    listHandler({}, failingRes);
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: list failed' });
  });

  it('ensures dedicated threads before listing tasks when the binding is missing', () => {
    const { listHandler } = createHarness();
    loadScheduledTasksForProfileMock.mockReturnValue({
      tasks: [createTask({ id: 'task-ensure', title: 'Ensure thread', threadConversationId: '' })],
      runtimeState: {},
      runtimeEntries: [],
    });
    ensureAutomationThreadMock.mockReturnValue(createTask({ id: 'task-ensure', title: 'Ensure thread' }));

    const res = createResponse();
    listHandler({}, res);

    expect(ensureAutomationThreadMock).toHaveBeenCalledWith('task-ensure');
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'task-ensure',
        threadConversationId: 'automation.task-ensure',
        threadTitle: 'Automation: Ensure thread',
      }),
    ]);
  });

  it('creates tasks, invalidates topics, and falls back to stored or created task details', () => {
    const { createHandler } = createHarness();
    const createdTask = createTask({ id: 'task-created', title: 'Created task', prompt: 'Stored prompt' });
    const storedTask = createTask({ id: 'task-created', title: 'Saved task', prompt: 'Saved prompt' });

    createStoredAutomationMock.mockReturnValue(createdTask);
    findTaskForProfileMock.mockReturnValueOnce({
      task: storedTask,
      runtime: createRuntime({ id: 'task-created', running: false }),
    });

    const res = createResponse();
    createHandler(
      {
        body: {
          title: 'Created task',
          enabled: false,
          cron: '*/5 * * * *',
          model: 'claude',
          thinkingLevel: 'medium',
          cwd: '/tmp/work',
          timeoutSeconds: 45,
          prompt: 'Body',
        },
      },
      res,
    );

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
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
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

    findTaskForProfileMock.mockReturnValueOnce(undefined);
    const fallbackRes = createResponse();
    createHandler({ body: {} }, fallbackRes);
    expect(fallbackRes.json).toHaveBeenCalledWith({
      ok: true,
      task: {
        id: 'task-created',
        title: 'Created task',
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
        prompt: 'Stored prompt',
        activity: [],
        lastStatus: undefined,
        lastRunAt: undefined,
        threadMode: 'dedicated',
        threadConversationId: 'automation.task-created',
        threadTitle: 'Automation: Created task',
      },
    });

    createStoredAutomationMock.mockImplementationOnce(() => {
      throw new Error('create failed');
    });
    const failingRes = createResponse();
    createHandler({ body: {} }, failingRes);
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: create failed' });
  });

  it('patches tasks, 404s missing ids, and logs patch failures', () => {
    const { patchHandler } = createHarness();
    const task = createTask({ id: 'task-1' });
    const updatedTask = createTask({ id: 'task-1', title: 'Updated task', prompt: 'Updated prompt' });

    findTaskForProfileMock.mockReturnValueOnce(undefined);
    const missingRes = createResponse();
    patchHandler({ params: { id: 'missing' }, body: {} }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Task not found' });

    findTaskForProfileMock
      .mockReturnValueOnce({ task, runtime: createRuntime() })
      .mockReturnValueOnce({ task: updatedTask, runtime: createRuntime({ id: 'task-1', running: false }) });
    updateStoredAutomationMock.mockReturnValue(updatedTask);

    const res = createResponse();
    patchHandler({ params: { id: 'task-1' }, body: { title: 'Updated task', prompt: 'Updated prompt' } }, res);
    expect(updateStoredAutomationMock).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        title: 'Updated task',
        prompt: 'Updated prompt',
      }),
    );
    expect(applyScheduledTaskThreadBindingMock).toHaveBeenNthCalledWith(1, 'task-1', {
      threadMode: 'dedicated',
      threadConversationId: undefined,
      threadSessionFile: undefined,
      cwd: '/repo',
    });
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('tasks');
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      task: {
        ...createRuntime({ id: 'task-1', running: false }),
        id: 'task-1',
        title: 'Updated task',
        filePath: '/tasks/task-1.md',
        scheduleType: 'cron',
        running: false,
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
        threadConversationId: 'automation.task-1',
        threadTitle: 'Automation: Updated task',
      },
    });

    findTaskForProfileMock.mockReturnValueOnce({ task, runtime: createRuntime() });
    updateStoredAutomationMock.mockImplementationOnce(() => {
      throw new Error('patch failed');
    });
    const failingRes = createResponse();
    patchHandler({ params: { id: 'task-1' }, body: {} }, failingRes);
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: patch failed' });
  });

  it('deletes tasks, clears callback bindings, and handles missing ids', () => {
    const { deleteHandler } = createHarness();
    const task = createTask({ id: 'task-1' });

    findTaskForProfileMock.mockReturnValueOnce(undefined);
    const missingRes = createResponse();
    deleteHandler({ params: { id: 'missing' } }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Task not found' });

    findTaskForProfileMock.mockReturnValueOnce({ task, runtime: createRuntime() });
    deleteStoredAutomationMock.mockReturnValueOnce(true);
    const successRes = createResponse();
    deleteHandler({ params: { id: 'task-1' } }, successRes);
    expect(deleteStoredAutomationMock).toHaveBeenCalledWith('task-1', { profile: 'assistant' });
    expect(clearTaskCallbackBindingMock).toHaveBeenCalledWith({ profile: 'assistant', taskId: 'task-1' });
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('tasks');
    expect(successRes.json).toHaveBeenCalledWith({ ok: true, deleted: true });

    findTaskForProfileMock.mockReturnValueOnce({ task, runtime: createRuntime() });
    deleteStoredAutomationMock.mockImplementationOnce(() => {
      throw new Error('delete failed');
    });
    const failingRes = createResponse();
    deleteHandler({ params: { id: 'task-1' } }, failingRes);
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: delete failed' });
  });

  it('reads task logs and details, handling missing tasks, missing files, and errors', () => {
    const { logHandler, detailHandler } = createHarness();
    const task = createTask({ id: 'task-1' });

    findTaskForProfileMock.mockReturnValueOnce(undefined);
    const missingLogRes = createResponse();
    logHandler({ params: { id: 'task-1' } }, missingLogRes);
    expect(missingLogRes.status).toHaveBeenCalledWith(404);
    expect(missingLogRes.json).toHaveBeenCalledWith({ error: 'No log available' });

    findTaskForProfileMock.mockReturnValueOnce({ task, runtime: createRuntime() });
    existsSyncMock.mockReturnValue(false);
    const absentFileRes = createResponse();
    logHandler({ params: { id: 'task-1' } }, absentFileRes);
    expect(absentFileRes.status).toHaveBeenCalledWith(404);

    findTaskForProfileMock.mockReturnValueOnce({ task, runtime: createRuntime() });
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('task log');
    const logRes = createResponse();
    logHandler({ params: { id: 'task-1' } }, logRes);
    expect(logRes.json).toHaveBeenCalledWith({ log: 'task log', path: '/tmp/task.log' });

    findTaskForProfileMock.mockReturnValueOnce({ task, runtime: createRuntime() });
    readFileSyncMock.mockImplementationOnce(() => {
      throw new Error('read failed');
    });
    const failingLogRes = createResponse();
    logHandler({ params: { id: 'task-1' } }, failingLogRes);
    expect(failingLogRes.status).toHaveBeenCalledWith(500);

    findTaskForProfileMock.mockReturnValueOnce(undefined);
    const missingDetailRes = createResponse();
    detailHandler({ params: { id: 'task-1' } }, missingDetailRes);
    expect(missingDetailRes.status).toHaveBeenCalledWith(404);
    expect(missingDetailRes.json).toHaveBeenCalledWith({ error: 'Task not found' });

    findTaskForProfileMock.mockReturnValueOnce({ task, runtime: createRuntime({ running: false }) });
    const detailRes = createResponse();
    detailHandler({ params: { id: 'task-1' } }, detailRes);
    expect(detailRes.json).toHaveBeenCalledWith({
      ...createRuntime({ running: false }),
      id: 'task-1',
      title: 'Task 1',
      filePath: '/tasks/task-1.md',
      scheduleType: 'cron',
      running: false,
      enabled: true,
      cron: '0 * * * *',
      at: undefined,
      model: 'gpt-4o',
      thinkingLevel: 'high',
      cwd: '/repo',
      timeoutSeconds: 120,
      prompt: 'Prompt body',
      activity: [],
      lastStatus: 'success',
      lastRunAt: '2026-04-09T15:00:00.000Z',
      threadMode: 'dedicated',
      threadConversationId: 'automation.task-1',
      threadTitle: 'Automation: Task 1',
    });

    findTaskForProfileMock.mockImplementationOnce(() => {
      throw new Error('detail failed');
    });
    const failingDetailRes = createResponse();
    detailHandler({ params: { id: 'task-1' } }, failingDetailRes);
    expect(failingDetailRes.status).toHaveBeenCalledWith(500);
    expect(failingDetailRes.json).toHaveBeenCalledWith({ error: 'Error: detail failed' });
  });

  it('runs tasks from the main routes, handling missing, blank, rejected, success, and error cases', async () => {
    const { runHandler } = createHarness();

    findTaskForProfileMock.mockReturnValueOnce(undefined);
    const missingRes = createResponse();
    await runHandler({ params: { id: 'task-1' } }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(404);

    findTaskForProfileMock.mockReturnValueOnce({ task: createTask({ prompt: '   ' }), runtime: createRuntime() });
    const blankRes = createResponse();
    await runHandler({ params: { id: 'task-1' } }, blankRes);
    expect(blankRes.status).toHaveBeenCalledWith(400);

    findTaskForProfileMock.mockReturnValueOnce({ task: createTask(), runtime: createRuntime() });
    startScheduledTaskRunMock.mockResolvedValueOnce({ accepted: false, reason: 'busy' });
    const rejectedRes = createResponse();
    await runHandler({ params: { id: 'task-1' } }, rejectedRes);
    expect(rejectedRes.status).toHaveBeenCalledWith(503);
    expect(rejectedRes.json).toHaveBeenCalledWith({ error: 'busy' });

    findTaskForProfileMock.mockReturnValueOnce({ task: createTask(), runtime: createRuntime() });
    startScheduledTaskRunMock.mockResolvedValueOnce({ accepted: true, runId: 'run-1' });
    const successRes = createResponse();
    await runHandler({ params: { id: 'task-1' } }, successRes);
    expect(successRes.json).toHaveBeenCalledWith({ ok: true, accepted: true, runId: 'run-1' });

    findTaskForProfileMock.mockImplementationOnce(() => {
      throw new Error('run failed');
    });
    const failingRes = createResponse();
    await runHandler({ params: { id: 'task-1' } }, failingRes);
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: run failed' });
  });
});
