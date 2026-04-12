import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunAgentExtension } from './runAgentExtension.js';

const {
  listDurableRunsMock,
  getDurableRunMock,
  getDurableRunLogMock,
  cancelDurableRunMock,
  rerunDurableRunMock,
  followUpDurableRunMock,
  ensureDaemonAvailableMock,
  startBackgroundRunMock,
} = vi.hoisted(() => ({
  listDurableRunsMock: vi.fn(),
  getDurableRunMock: vi.fn(),
  getDurableRunLogMock: vi.fn(),
  cancelDurableRunMock: vi.fn(),
  rerunDurableRunMock: vi.fn(),
  followUpDurableRunMock: vi.fn(),
  ensureDaemonAvailableMock: vi.fn(),
  startBackgroundRunMock: vi.fn(),
}));

vi.mock('../automation/durableRuns.js', () => ({
  listDurableRuns: listDurableRunsMock,
  getDurableRun: getDurableRunMock,
  getDurableRunLog: getDurableRunLogMock,
  cancelDurableRun: cancelDurableRunMock,
  rerunDurableRun: rerunDurableRunMock,
  followUpDurableRun: followUpDurableRunMock,
}));

vi.mock('../automation/daemonToolUtils.js', () => ({
  ensureDaemonAvailable: ensureDaemonAvailableMock,
}));

vi.mock('@personal-agent/daemon', () => ({
  startBackgroundRun: startBackgroundRunMock,
}));

function registerRunTool() {
  let registeredTool:
    | { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }> }
    | undefined;

  createRunAgentExtension({
    getCurrentProfile: () => 'assistant',
    repoRoot: '/repo',
    profilesRoot: '/profiles',
  })({
    registerTool: (tool: unknown) => {
      registeredTool = tool as { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }> };
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
  ensureDaemonAvailableMock.mockReset();
  startBackgroundRunMock.mockReset();
  rerunDurableRunMock.mockReset();
  followUpDurableRunMock.mockReset();
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
      runs: [{
        runId: 'run-123',
        status: 'running',
        kind: 'background-run',
        source: 'tool',
      }],
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
    const logs = await runTool.execute('tool-2', { action: 'logs', runId: 'run-123', tail: 5_000 }, undefined, undefined, createToolContext());

    expect(detail.isError).not.toBe(true);
    expect(detail.content[0]?.text).toContain('source: tool (conv-123)');
    expect(detail.content[0]?.text).toContain('last error: boom');
    expect(getDurableRunLogMock).toHaveBeenCalledWith('run-123', 1_000);
    expect(logs.content[0]?.text).toContain('(empty log)');
  });

  it('starts a background run through the daemon', async () => {
    ensureDaemonAvailableMock.mockResolvedValue(undefined);
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
      callbackConversation: {
        conversationId: 'conv-999',
        sessionFile: '/tmp/sessions/conv-999.jsonl',
        profile: 'assistant',
        repoRoot: '/repo',
      },
      checkpointPayload: {
        resumeParentOnExit: true,
      },
    });
    expect(result.content[0]?.text).toContain('Started durable run run-456');
  });

  it('starts a durable agent run through the daemon', async () => {
    ensureDaemonAvailableMock.mockResolvedValue(undefined);
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
      callbackConversation: {
        conversationId: 'conv-agent',
        sessionFile: '/tmp/sessions/conv-agent.jsonl',
        profile: 'assistant',
        repoRoot: '/repo',
      },
      checkpointPayload: {
        resumeParentOnExit: true,
      },
    });
    expect(result.content[0]?.text).toContain('Started durable agent run run-agent-123');
  });

  it('passes trimmed scheduling options to detached agent runs without a persisted conversation', async () => {
    ensureDaemonAvailableMock.mockResolvedValue(undefined);
    startBackgroundRunMock.mockResolvedValue({
      accepted: true,
      runId: 'run-agent-loop',
      logPath: '/tmp/run-agent-loop.log',
    });

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
        cron: ' 0 9 * * 1-5 ',
        at: ' 2026-04-10T09:00:00Z ',
        loop: true,
        loopDelay: ' 1h ',
        loopMaxIterations: 5,
      },
      undefined,
      undefined,
      createToolContext('conv-loop', ''),
    );

    expect(result.isError).not.toBe(true);
    expect(startBackgroundRunMock).toHaveBeenCalledWith({
      taskSlug: 'monitor-build',
      cwd: '/tmp/other-workspace',
      agent: {
        prompt: 'Watch the deployment and report back.',
        profile: 'assistant',
      },
      source: {
        type: 'tool',
        id: 'conv-loop',
      },
      checkpointPayload: {
        resumeParentOnExit: true,
        defer: '30m',
        cron: '0 9 * * 1-5',
        at: '2026-04-10T09:00:00Z',
        loop: true,
        loopDelay: '1h',
        loopMaxIterations: 5,
      },
    });
    expect(result.content[0]?.text).toContain('[defer 30m, cron 0 9 * * 1-5, at 2026-04-10T09:00:00Z, loop]');
  });

  it('reruns a stopped durable run through the daemon', async () => {
    ensureDaemonAvailableMock.mockResolvedValue(undefined);
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
    expect(result.content[0]?.text).toContain('Started rerun run-rerun-123 from run-original-123');
  });

  it('continues a stopped background agent run through the daemon', async () => {
    ensureDaemonAvailableMock.mockResolvedValue(undefined);
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
    expect(followUpDurableRunMock).toHaveBeenCalledWith('run-original-123', 'Continue from the failed migration step and finish validation.');
    expect(result.content[0]?.text).toContain('Started follow-up run run-followup-123 from run-original-123');
  });

  it('uses the default follow-up prompt and returns tool errors when continuation fails', async () => {
    ensureDaemonAvailableMock.mockResolvedValue(undefined);
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

  it('returns tool errors for missing runs and rejected cancellations', async () => {
    getDurableRunMock.mockResolvedValue(null);
    ensureDaemonAvailableMock.mockResolvedValue(undefined);
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
