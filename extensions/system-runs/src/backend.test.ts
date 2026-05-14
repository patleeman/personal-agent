import { describe, expect, it, vi } from 'vitest';

const mockRunExecute = vi.fn();
const mockBackgroundCommandExecute = vi.fn();
const mockSubagentExecute = vi.fn();
const mockStartBackgroundRun = vi.fn();

vi.mock('./runTool.js', () => ({
  createRunAgentExtension: vi.fn(() => (pi: { registerTool: (t: unknown) => void }) => {
    pi.registerTool({ name: 'run', execute: mockRunExecute });
    pi.registerTool({ name: 'background_command', execute: mockBackgroundCommandExecute });
    pi.registerTool({ name: 'subagent', execute: mockSubagentExecute });
  }),
}));

vi.mock('@personal-agent/daemon', () => ({
  pingDaemon: vi.fn().mockResolvedValue(true),
  startBackgroundRun: mockStartBackgroundRun,
}));

vi.mock('@personal-agent/extensions/backend', () => ({
  listDurableRuns: vi.fn(),
  getDurableRun: vi.fn(),
  getDurableRunLog: vi.fn(),
  startBackgroundRun: vi.fn(),
  rerunDurableRun: vi.fn(),
  followUpDurableRun: vi.fn(),
  cancelDurableRun: vi.fn(),
  pingDaemon: vi.fn().mockResolvedValue(true),
  createStoredAutomation: vi.fn(),
  applyScheduledTaskThreadBinding: vi.fn(),
  setTaskCallbackBinding: vi.fn(),
  invalidateAppTopics: vi.fn(),
  parseDeferredResumeDelayMs: vi.fn(),
}));

import { background_command, bash, run, subagent } from './backend.js';

function createCtx(overrides?: Record<string, unknown>) {
  return {
    toolContext: { conversationId: 'conv-1', cwd: '/tmp/repo', sessionFile: '/tmp/session.json', sessionId: 'sess-1' },
    ui: { invalidate: vi.fn() },
    shell: { exec: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', executionWrappers: [] }) },
    ...overrides,
  };
}

describe('system-runs backend', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('run handler', () => {
    it('delegates to the registered run tool and wraps text result', async () => {
      mockRunExecute.mockResolvedValue({
        content: [{ type: 'text', text: 'Run abc1234 started.' }],
      });

      const result = await run({ action: 'start', taskSlug: 'test' }, createCtx());
      expect(result.text).toBe('Run abc1234 started.');
    });

    it('passes details through when present', async () => {
      mockRunExecute.mockResolvedValue({
        content: [{ type: 'text', text: 'Running...' }],
        details: { runId: 'abc1234', status: 'running' },
      });

      const result = await run({ action: 'start', taskSlug: 'test' }, createCtx());
      expect(result.details).toEqual({ runId: 'abc1234', status: 'running' });
    });

    it('handles multiple content blocks', async () => {
      mockRunExecute.mockResolvedValue({
        content: [
          { type: 'text', text: 'Run 1' },
          { type: 'text', text: 'Run 2' },
        ],
      });

      const result = await run({ action: 'list' }, createCtx());
      expect(result.text).toBe('Run 1\nRun 2');
    });

    it('handles non-array content result', async () => {
      mockRunExecute.mockResolvedValue({ status: 'ok' });

      const result = await run({ action: 'get', runId: 'abc' }, createCtx());
      expect(result.text).toContain('"status"');
    });

    it('invalidates runs and tasks topics after execution', async () => {
      const invalidate = vi.fn();
      mockRunExecute.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      });

      await run({ action: 'list' }, createCtx({ ui: { invalidate } }));
      expect(invalidate).toHaveBeenCalledWith(['runs', 'tasks']);
    });
  });

  it('starts background bash directly as a shell background run', async () => {
    mockStartBackgroundRun.mockResolvedValue({ accepted: true, runId: 'run-123', logPath: '/tmp/run-123/output.log' });

    const result = await bash({ command: 'sleep 1', background: true, taskSlug: 'sleep' }, createCtx());

    expect(result.text).toBe('Started background command run-123 for sleep.');
    expect(result.details).toMatchObject({ command: 'sleep 1', runId: 'run-123' });
    expect(result.details).not.toHaveProperty('displayMode');
    expect(mockStartBackgroundRun).toHaveBeenCalledWith(
      expect.objectContaining({ taskSlug: 'sleep', cwd: '/tmp/repo', shellCommand: 'sleep 1' }),
    );
    expect(mockBackgroundCommandExecute).not.toHaveBeenCalled();
    expect(mockSubagentExecute).not.toHaveBeenCalled();
  });

  it('starts the background_command action directly as a shell background run', async () => {
    mockStartBackgroundRun.mockResolvedValue({ accepted: true, runId: 'run-456', logPath: '/tmp/run-456/output.log' });

    const result = await background_command({ action: 'start', command: 'sleep 1', taskSlug: 'sleep' }, createCtx());

    expect(result.text).toBe('Started background command run-456 for sleep.');
    expect(result.details).toMatchObject({ command: 'sleep 1', runId: 'run-456' });
    expect(result.details).not.toHaveProperty('displayMode');
    expect(mockStartBackgroundRun).toHaveBeenCalledWith(
      expect.objectContaining({ taskSlug: 'sleep', cwd: '/tmp/repo', shellCommand: 'sleep 1' }),
    );
    expect(mockBackgroundCommandExecute).not.toHaveBeenCalled();
    expect(mockSubagentExecute).not.toHaveBeenCalled();
  });

  it('uses the subagent registered tool for the subagent action', async () => {
    mockSubagentExecute.mockResolvedValue({
      content: [{ type: 'text', text: 'Started subagent run-789.' }],
    });

    const result = await subagent({ action: 'start', prompt: 'Do work', taskSlug: 'agent' }, createCtx());

    expect(result.text).toBe('Started subagent run-789.');
    expect(mockSubagentExecute).toHaveBeenCalled();
  });
});
