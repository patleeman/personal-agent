import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRunAgentExtension } from './runAgentExtension.js';

const {
  listDurableRunsMock,
  getDurableRunMock,
  getDurableRunLogMock,
  cancelDurableRunMock,
  rerunDurableRunMock,
  followUpDurableRunMock,
  pingDaemonMock,
  startBackgroundRunMock,
  createStoredAutomationMock,
  applyScheduledTaskThreadBindingMock,
  setTaskCallbackBindingMock,
  invalidateAppTopicsMock,
} = vi.hoisted(() => ({
  listDurableRunsMock: vi.fn(),
  getDurableRunMock: vi.fn(),
  getDurableRunLogMock: vi.fn(),
  cancelDurableRunMock: vi.fn(),
  rerunDurableRunMock: vi.fn(),
  followUpDurableRunMock: vi.fn(),
  pingDaemonMock: vi.fn(),
  startBackgroundRunMock: vi.fn(),
  createStoredAutomationMock: vi.fn(),
  applyScheduledTaskThreadBindingMock: vi.fn(),
  setTaskCallbackBindingMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
}));

vi.mock('../automation/durableRuns.js', () => ({
  listDurableRuns: listDurableRunsMock,
  getDurableRun: getDurableRunMock,
  getDurableRunLog: getDurableRunLogMock,
  cancelDurableRun: cancelDurableRunMock,
  rerunDurableRun: rerunDurableRunMock,
  followUpDurableRun: followUpDurableRunMock,
}));

vi.mock('@personal-agent/daemon', () => ({
  pingDaemon: pingDaemonMock,
  startBackgroundRun: startBackgroundRunMock,
  createStoredAutomation: createStoredAutomationMock,
}));

vi.mock('../automation/scheduledTaskThreads.js', () => ({
  applyScheduledTaskThreadBinding: applyScheduledTaskThreadBindingMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
}));

vi.mock('@personal-agent/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@personal-agent/core')>();
  return {
    ...actual,
    parseDeferredResumeDelayMs: (value: string) => {
      if (value === '30m') return 30 * 60 * 1000;
      if (value === '10m') return 10 * 60 * 1000;
      if (value === 'bad') return undefined;
      return undefined;
    },
    setTaskCallbackBinding: setTaskCallbackBindingMock,
  };
});

function registerRunTool() {
  let registeredTool:
    | {
        execute: (
          ...args: unknown[]
        ) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }>;
      }
    | undefined;

  createRunAgentExtension({
    getCurrentProfile: () => 'assistant',
    repoRoot: '/repo',
    profilesRoot: '/profiles',
  })({
    registerTool: (tool: unknown) => {
      registeredTool = tool as {
        execute: (
          ...args: unknown[]
        ) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }>;
      };
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Run tool was not registered.');
  }

  return registeredTool;
}

function createToolContext(conversationId = 'conv-123', sessionFile = '/tmp/sessions/conv-123.jsonl') {
  return {
    cwd: '/tmp/workspace',
    sessionManager: {
      getSessionId: () => conversationId,
      getSessionFile: () => sessionFile,
    },
  };
}

beforeEach(() => {
  listDurableRunsMock.mockReset();
  getDurableRunMock.mockReset();
  getDurableRunLogMock.mockReset();
  cancelDurableRunMock.mockReset();
  pingDaemonMock.mockReset();
  startBackgroundRunMock.mockReset();
  createStoredAutomationMock.mockReset();
  applyScheduledTaskThreadBindingMock.mockReset();
  setTaskCallbackBindingMock.mockReset();
  invalidateAppTopicsMock.mockReset();
  rerunDurableRunMock.mockReset();
  followUpDurableRunMock.mockReset();

  createStoredAutomationMock.mockImplementation((input: Record<string, unknown>) => ({
    id: String(input.id ?? 'automation-1'),
    title: String(input.title ?? input.id ?? 'automation-1'),
    prompt: String(input.prompt ?? ''),
    schedule: input.cron
      ? { type: 'cron', expression: String(input.cron) }
      : { type: 'at', at: String(input.at ?? '2026-04-10T09:00:00.000Z') },
  }));
  applyScheduledTaskThreadBindingMock.mockImplementation((taskId: string) => ({
    id: taskId,
    prompt: 'Watch the deployment and report back.',
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('run agent extension', () => {
  it('lists durable runs', async () => {
    listDurableRunsMock.mockResolvedValue({
      summary: { total: 1 },
      runs: [{ runId: 'run-123', manifest: { kind: 'background-run', source: { type: 'tool' } }, status: { status: 'running' } }],
    });

    const runTool = registerRunTool();
    const result = await runTool.execute('tool-1', { action: 'list' }, undefined, undefined, createToolContext());

    expect(result.isError).not.toBe(true);
    expect(result.content[0]?.text).toContain('run-123');
    expect(result.content[0]?.text).toContain('background-run');
    expect(result.details).toMatchObject({
      action: 'list',
      runCount: 1,
      runIds: ['run-123'],
      runs: [
        {
          runId: 'run-123',
          status: 'running',
          kind: 'background-run',
          source: 'tool',
        },
      ],
    });
  });

  it('formats durable run details and log output', async () => {
    getDurableRunMock.mockResolvedValue({
      run: {
        runId: 'run-123',
        manifest: { kind: 'background-run', source: { type: 'tool', id: 'conv-123' } },
        recoveryAction: 'attention',
        paths: { outputLogPath: '/tmp/run-123.log' },
        status: { status: 'failed', lastError: 'boom' },
      },
    });
    getDurableRunLogMock.mockResolvedValue({
      path: '/tmp/run-123.log',
      log: '',
    });

    const runTool = registerRunTool();
    const detail = await runTool.execute('tool-1', { action: 'get', runId: 'run-123' }, undefined, undefined, createToolContext());
    const logs = await runTool.execute(
      'tool-2',
      { action: 'logs', runId: 'run-123', tail: 5_000 },
      undefined,
      undefined,
      createToolContext(),
    );
    const fractionalLogs = await runTool.execute(
      'tool-3',
      { action: 'logs', runId: 'run-123', tail: 5.5 },
      undefined,
      undefined,
      createToolContext(),
    );
    const unsafeLogs = await runTool.execute(
      'tool-4',
      { action: 'logs', runId: 'run-123', tail: Number.MAX_SAFE_INTEGER + 1 },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(detail.isError).not.toBe(true);
    expect(detail.content[0]?.text).toContain('source: tool (conv-123)');
    expect(detail.content[0]?.text).toContain('last error: boom');
    expect(getDurableRunLogMock).toHaveBeenCalledWith('run-123', 1_000);
    expect(getDurableRunLogMock).toHaveBeenNthCalledWith(3, 'run-123', 120);
    expect(getDurableRunLogMock).toHaveBeenLastCalledWith('run-123', 120);
    expect(logs.content[0]?.text).toContain('(empty log)');
    expect(fractionalLogs.content[0]?.text).toContain('(empty log)');
    expect(unsafeLogs.content[0]?.text).toContain('(empty log)');
  });

  it('starts a background run through the daemon without conversation callbacks by default', async () => {
    pingDaemonMock.mockResolvedValue(true);
    startBackgroundRunMock.mockResolvedValue({
      accepted: true,
      runId: 'run-456',
      logPath: '/tmp/run-456.log',
    });

    const runTool = registerRunTool();
    const result = await runTool.execute(
      'tool-1',
      {
        action: 'start',
        taskSlug: 'code-review',
        command: 'echo hello',
      },
      undefined,
      undefined,
      createToolContext('conv-999', '/tmp/sessions/conv-999.jsonl'),
    );

    expect(result.isError).not.toBe(true);
    expect(startBackgroundRunMock).toHaveBeenCalledWith({
      taskSlug: 'code-review',
      cwd: '/tmp/workspace',
      shellCommand: 'echo hello',
      source: {
        type: 'tool',
        id: 'conv-999',
        filePath: '/tmp/sessions/conv-999.jsonl',
      },
    });
    expect(result.content[0]?.text).toContain('Started durable run run-456');
    expect(result.details).toMatchObject({
      action: 'start',
      deliverResultToConversation: false,
    });
  });

  it('starts a durable agent run through the daemon without conversation callbacks by default', async () => {
    pingDaemonMock.mockResolvedValue(true);
    startBackgroundRunMock.mockResolvedValue({
      accepted: true,
      runId: 'run-agent-123',
      logPath: '/tmp/run-agent-123.log',
    });

    const runTool = registerRunTool();
    const result = await runTool.execute(
      'tool-1',
      {
        action: 'start_agent',
        taskSlug: 'fix-build',
        prompt: 'Fix the build errors and report back.',
        model: 'openai-codex/gpt-5.4',
        profile: 'datadog',
      },
      undefined,
      undefined,
      createToolContext('conv-agent', '/tmp/sessions/conv-agent.jsonl'),
    );

    expect(result.isError).not.toBe(true);
    expect(startBackgroundRunMock).toHaveBeenCalledWith({
      taskSlug: 'fix-build',
      cwd: '/tmp/workspace',
      agent: {
        prompt: 'Fix the build errors and report back.',
        model: 'openai-codex/gpt-5.4',
        profile: 'datadog',
      },
      source: {
        type: 'tool',
        id: 'conv-agent',
        filePath: '/tmp/sessions/conv-agent.jsonl',
      },
      checkpointPayload: {},
    });
    expect(result.content[0]?.text).toContain('Started durable agent run run-agent-123');
    expect(result.details).toMatchObject({
      action: 'start_agent',
      deliverResultToConversation: false,
    });
  });

  it('creates a saved automation for scheduled agent prompts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T08:30:00Z'));
    pingDaemonMock.mockResolvedValue(true);
    createStoredAutomationMock.mockReturnValue({
      id: 'monitor-build',
      title: 'monitor-build',
      prompt: 'Watch the deployment and report back.',
      schedule: { type: 'at', at: '2026-04-10T09:00:00.000Z' },
    });
    applyScheduledTaskThreadBindingMock.mockReturnValue({ id: 'monitor-build', prompt: 'Watch the deployment and report back.' });

    try {
      const runTool = registerRunTool();
      const result = await runTool.execute(
        'tool-1',
        {
          action: 'start_agent',
          taskSlug: '  monitor-build  ',
          prompt: '  Watch the deployment and report back.  ',
          model: '   ',
          profile: '   ',
          cwd: '  /tmp/other-workspace  ',
          defer: ' 30m ',
        },
        undefined,
        undefined,
        createToolContext('conv-loop', ''),
      );

      expect(result.isError).not.toBe(true);
      expect(createStoredAutomationMock).toHaveBeenCalledWith({
        id: 'monitor-build',
        profile: 'assistant',
        title: 'monitor-build',
        enabled: true,
        cron: undefined,
        at: '2026-04-10T09:00:00.000Z',
        modelRef: undefined,
        cwd: '/tmp/other-workspace',
        prompt: 'Watch the deployment and report back.',
        targetType: 'background-agent',
      });
      expect(applyScheduledTaskThreadBindingMock).toHaveBeenCalledWith('monitor-build', {
        threadMode: 'none',
        cwd: '/tmp/other-workspace',
      });
      expect(startBackgroundRunMock).not.toHaveBeenCalled();
      expect(result.content[0]?.text).toContain('Saved automation @monitor-build');
      expect(result.details).toMatchObject({
        action: 'start_agent',
        scheduled: true,
        automationId: 'monitor-build',
        at: '2026-04-10T09:00:00.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects malformed scheduled agent at timestamps', async () => {
    pingDaemonMock.mockResolvedValue(true);

    const runTool = registerRunTool();
    const result = await runTool.execute(
      'tool-1',
      {
        action: 'start_agent',
        taskSlug: 'monitor-build',
        prompt: 'Watch the deployment and report back.',
        at: '9999',
      },
      undefined,
      undefined,
      createToolContext('conv-loop', ''),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid at timestamp: 9999');
    expect(createStoredAutomationMock).not.toHaveBeenCalled();
    expect(startBackgroundRunMock).not.toHaveBeenCalled();
  });

  it('rejects overflowed scheduled agent at timestamps', async () => {
    pingDaemonMock.mockResolvedValue(true);

    const runTool = registerRunTool();
    const result = await runTool.execute(
      'tool-1',
      {
        action: 'start_agent',
        taskSlug: 'monitor-build',
        prompt: 'Watch the deployment and report back.',
        at: '2026-02-31T09:00:00.000Z',
      },
      undefined,
      undefined,
      createToolContext('conv-loop', ''),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid at timestamp: 2026-02-31T09:00:00.000Z');
    expect(createStoredAutomationMock).not.toHaveBeenCalled();
    expect(startBackgroundRunMock).not.toHaveBeenCalled();
  });

  it('binds scheduled automations back to the current conversation when requested', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T08:00:00Z'));
    pingDaemonMock.mockResolvedValue(true);
    createStoredAutomationMock.mockReturnValue({
      id: 'deploy-watch',
      title: 'deploy-watch',
      prompt: 'Watch the deployment and report back.',
      schedule: { type: 'cron', expression: '0 9 * * 1-5' },
    });
    applyScheduledTaskThreadBindingMock.mockReturnValue({ id: 'deploy-watch', prompt: 'Watch the deployment and report back.' });

    try {
      const runTool = registerRunTool();
      const result = await runTool.execute(
        'tool-1',
        {
          action: 'start_agent',
          taskSlug: 'deploy-watch',
          prompt: 'Watch the deployment and report back.',
          cron: '0 9 * * 1-5',
          deliverResultToConversation: true,
        },
        undefined,
        undefined,
        createToolContext('conv-callback', '/tmp/sessions/conv-callback.jsonl'),
      );

      expect(result.isError).not.toBe(true);
      expect(applyScheduledTaskThreadBindingMock).toHaveBeenCalledWith('deploy-watch', {
        threadMode: 'existing',
        threadConversationId: 'conv-callback',
        threadSessionFile: '/tmp/sessions/conv-callback.jsonl',
        cwd: '/tmp/workspace',
      });
      expect(setTaskCallbackBindingMock).toHaveBeenCalledWith({
        profile: 'assistant',
        taskId: 'deploy-watch',
        conversationId: 'conv-callback',
        sessionFile: '/tmp/sessions/conv-callback.jsonl',
        deliverOnSuccess: true,
        deliverOnFailure: true,
        notifyOnSuccess: 'passive',
        notifyOnFailure: 'disruptive',
        requireAck: false,
        autoResumeIfOpen: true,
      });
      expect(result.content[0]?.text).toContain('Saved automation @deploy-watch');
      expect(startBackgroundRunMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('can opt into delivering run results back to the current conversation', async () => {
    pingDaemonMock.mockResolvedValue(true);
    startBackgroundRunMock.mockResolvedValue({
      accepted: true,
      runId: 'run-agent-callback',
      logPath: '/tmp/run-agent-callback.log',
    });

    const runTool = registerRunTool();
    const result = await runTool.execute(
      'tool-1',
      {
        action: 'start_agent',
        taskSlug: 'deploy-watch',
        prompt: 'Watch the deployment and report back.',
        deliverResultToConversation: true,
      },
      undefined,
      undefined,
      createToolContext('conv-callback', '/tmp/sessions/conv-callback.jsonl'),
    );

    expect(result.isError).not.toBe(true);
    expect(startBackgroundRunMock).toHaveBeenCalledWith({
      taskSlug: 'deploy-watch',
      cwd: '/tmp/workspace',
      agent: {
        prompt: 'Watch the deployment and report back.',
        profile: 'assistant',
      },
      source: {
        type: 'tool',
        id: 'conv-callback',
        filePath: '/tmp/sessions/conv-callback.jsonl',
      },
      callbackConversation: {
        conversationId: 'conv-callback',
        sessionFile: '/tmp/sessions/conv-callback.jsonl',
        profile: 'assistant',
        repoRoot: '/repo',
      },
      checkpointPayload: {
        resumeParentOnExit: true,
      },
    });
    expect(result.details).toMatchObject({
      action: 'start_agent',
      deliverResultToConversation: true,
    });
  });

  it('rejects unsafe loop iteration limits before starting durable agent runs', async () => {
    pingDaemonMock.mockResolvedValue(true);

    const runTool = registerRunTool();
    const fractional = await runTool.execute(
      'tool-1',
      {
        action: 'start_agent',
        taskSlug: 'loop-watch',
        prompt: 'Keep watching.',
        loop: true,
        loopMaxIterations: 2.5,
      },
      undefined,
      undefined,
      createToolContext(),
    );
    const unsafe = await runTool.execute(
      'tool-2',
      {
        action: 'start_agent',
        taskSlug: 'loop-watch',
        prompt: 'Keep watching.',
        loop: true,
        loopMaxIterations: Number.MAX_SAFE_INTEGER + 1,
      },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(fractional.isError).toBe(true);
    expect(fractional.content[0]?.text).toContain('loopMaxIterations must be a positive integer.');
    expect(unsafe.isError).toBe(true);
    expect(unsafe.content[0]?.text).toContain('loopMaxIterations must be a positive integer.');
    expect(startBackgroundRunMock).not.toHaveBeenCalled();
  });

  it('requires a persisted conversation when opting into result delivery', async () => {
    pingDaemonMock.mockResolvedValue(true);

    const runTool = registerRunTool();
    const result = await runTool.execute(
      'tool-1',
      {
        action: 'start_agent',
        taskSlug: 'deploy-watch',
        prompt: 'Watch the deployment and report back.',
        deliverResultToConversation: true,
      },
      undefined,
      undefined,
      createToolContext('conv-no-file', ''),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('deliverResultToConversation requires an active persisted conversation.');
    expect(startBackgroundRunMock).not.toHaveBeenCalled();
  });

  it('reruns a stopped durable run through the daemon', async () => {
    pingDaemonMock.mockResolvedValue(true);
    rerunDurableRunMock.mockResolvedValue({
      accepted: true,
      runId: 'run-rerun-123',
      sourceRunId: 'run-original-123',
      logPath: '/tmp/run-rerun-123.log',
    });

    const runTool = registerRunTool();
    const result = await runTool.execute(
      'tool-1',
      {
        action: 'rerun',
        runId: 'run-original-123',
      },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(result.isError).not.toBe(true);
    expect(rerunDurableRunMock).toHaveBeenCalledWith('run-original-123');
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('runs');
    expect(result.content[0]?.text).toContain('Started rerun run-rerun-123 from run-original-123');
  });

  it('continues a stopped background agent run through the daemon', async () => {
    pingDaemonMock.mockResolvedValue(true);
    followUpDurableRunMock.mockResolvedValue({
      accepted: true,
      runId: 'run-followup-123',
      sourceRunId: 'run-original-123',
      logPath: '/tmp/run-followup-123.log',
    });

    const runTool = registerRunTool();
    const result = await runTool.execute(
      'tool-1',
      {
        action: 'follow_up',
        runId: 'run-original-123',
        prompt: 'Continue from the failed migration step and finish validation.',
      },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(result.isError).not.toBe(true);
    expect(followUpDurableRunMock).toHaveBeenCalledWith(
      'run-original-123',
      'Continue from the failed migration step and finish validation.',
    );
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('runs');
    expect(result.content[0]?.text).toContain('Started follow-up run run-followup-123 from run-original-123');
  });

  it('uses the default follow-up prompt and returns tool errors when continuation fails', async () => {
    pingDaemonMock.mockResolvedValue(true);
    followUpDurableRunMock.mockResolvedValue({
      accepted: false,
      reason: 'cannot continue',
    });

    const runTool = registerRunTool();
    const result = await runTool.execute(
      'tool-1',
      {
        action: 'follow_up',
        runId: 'run-original-123',
      },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(result.isError).toBe(true);
    expect(followUpDurableRunMock).toHaveBeenCalledWith('run-original-123', 'Continue from where you left off.');
    expect(result.content[0]?.text).toContain('cannot continue');
  });

  it('cancels a durable run and invalidates run snapshots', async () => {
    pingDaemonMock.mockResolvedValue(true);
    cancelDurableRunMock.mockResolvedValue({
      cancelled: true,
      runId: 'run-original-123',
    });

    const runTool = registerRunTool();
    const result = await runTool.execute(
      'tool-1',
      {
        action: 'cancel',
        runId: 'run-original-123',
      },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(result.isError).not.toBe(true);
    expect(cancelDurableRunMock).toHaveBeenCalledWith('run-original-123');
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('runs');
    expect(result.content[0]?.text).toContain('Cancelled durable run run-original-123.');
  });

  it('returns tool errors for missing runs and rejected cancellations', async () => {
    getDurableRunMock.mockResolvedValue(null);
    pingDaemonMock.mockResolvedValue(true);
    cancelDurableRunMock.mockResolvedValue({
      cancelled: false,
      reason: 'cancel denied',
    });

    const runTool = registerRunTool();
    const missingRun = await runTool.execute(
      'tool-1',
      {
        action: 'get',
        runId: 'run-missing',
      },
      undefined,
      undefined,
      createToolContext(),
    );
    const cancelResult = await runTool.execute(
      'tool-2',
      {
        action: 'cancel',
        runId: 'run-123',
      },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(missingRun.isError).toBe(true);
    expect(missingRun.content[0]?.text).toContain('Run not found: run-missing');
    expect(cancelResult.isError).toBe(true);
    expect(cancelResult.content[0]?.text).toContain('cancel denied');
  });
});
