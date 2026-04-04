import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunAgentExtension } from './runAgentExtension.js';

const {
  listDurableRunsMock,
  getDurableRunMock,
  getDurableRunLogMock,
  cancelDurableRunMock,
  ensureDaemonAvailableMock,
  startBackgroundRunMock,
} = vi.hoisted(() => ({
  listDurableRunsMock: vi.fn(),
  getDurableRunMock: vi.fn(),
  getDurableRunLogMock: vi.fn(),
  cancelDurableRunMock: vi.fn(),
  ensureDaemonAvailableMock: vi.fn(),
  startBackgroundRunMock: vi.fn(),
}));

vi.mock('../automation/durableRuns.js', () => ({
  listDurableRuns: listDurableRunsMock,
  getDurableRun: getDurableRunMock,
  getDurableRunLog: getDurableRunLogMock,
  cancelDurableRun: cancelDurableRunMock,
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
});
