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

vi.mock('./durableRuns.js', () => ({
  listDurableRuns: listDurableRunsMock,
  getDurableRun: getDurableRunMock,
  getDurableRunLog: getDurableRunLogMock,
  cancelDurableRun: cancelDurableRunMock,
}));

vi.mock('./daemonToolUtils.js', () => ({
  ensureDaemonAvailable: ensureDaemonAvailableMock,
}));

vi.mock('@personal-agent/daemon', () => ({
  startBackgroundRun: startBackgroundRunMock,
}));

function registerRunTool() {
  let registeredTool:
    | { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }> }
    | undefined;

  createRunAgentExtension()({
    registerTool: (tool: unknown) => {
      registeredTool = tool as { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }> };
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Run tool was not registered.');
  }

  return registeredTool;
}

function createToolContext(conversationId = 'conv-123') {
  return {
    cwd: '/tmp/workspace',
    sessionManager: {
      getSessionId: () => conversationId,
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
      createToolContext('conv-999'),
    );

    expect(result.isError).not.toBe(true);
    expect(startBackgroundRunMock).toHaveBeenCalledWith({
      taskSlug: 'code-review',
      cwd: '/tmp/workspace',
      shellCommand: 'echo hello',
      source: {
        type: 'tool',
        id: 'conv-999',
      },
    });
    expect(result.content[0]?.text).toContain('Started durable run run-456');
  });
});
