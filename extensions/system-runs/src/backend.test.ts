import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runExecute: vi.fn(),
  backgroundCommandExecute: vi.fn(),
  subagentExecute: vi.fn(),
  pingDaemon: vi.fn().mockResolvedValue(true),
  startBackgroundRun: vi.fn(),
  listDurableRuns: vi.fn(),
  getDurableRun: vi.fn(),
  cancelDurableRun: vi.fn(),
  rerunDurableRun: vi.fn(),
}));

vi.mock('./runTool.js', () => ({
  createRunAgentExtension: vi.fn(() => (pi: { registerTool: (t: unknown) => void }) => {
    pi.registerTool({ name: 'run', execute: mocks.runExecute });
    pi.registerTool({ name: 'background_command', execute: mocks.backgroundCommandExecute });
    pi.registerTool({ name: 'subagent', execute: mocks.subagentExecute });
  }),
}));

vi.mock('@personal-agent/extensions/backend/runs', () => ({
  cancelDurableRun: mocks.cancelDurableRun,
  getDurableRun: mocks.getDurableRun,
  listDurableRuns: mocks.listDurableRuns,
  pingDaemon: mocks.pingDaemon,
  rerunDurableRun: mocks.rerunDurableRun,
  startBackgroundRun: mocks.startBackgroundRun,
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
      mocks.runExecute.mockResolvedValue({
        content: [{ type: 'text', text: 'Run abc1234 started.' }],
      });

      const result = await run({ action: 'start', taskSlug: 'test' }, createCtx());
      expect(result.text).toBe('Run abc1234 started.');
    });

    it('passes details through when present', async () => {
      mocks.runExecute.mockResolvedValue({
        content: [{ type: 'text', text: 'Running...' }],
        details: { runId: 'abc1234', status: 'running' },
      });

      const result = await run({ action: 'start', taskSlug: 'test' }, createCtx());
      expect(result.details).toEqual({ runId: 'abc1234', status: 'running' });
    });

    it('handles multiple content blocks', async () => {
      mocks.runExecute.mockResolvedValue({
        content: [
          { type: 'text', text: 'Run 1' },
          { type: 'text', text: 'Run 2' },
        ],
      });

      const result = await run({ action: 'list' }, createCtx());
      expect(result.text).toBe('Run 1\nRun 2');
    });
  });

  describe('bash handler', () => {
    it('runs foreground commands through the shell context', async () => {
      const ctx = createCtx();
      const result = await bash({ command: 'echo hi' }, ctx);

      expect(ctx.shell.exec).toHaveBeenCalledWith({ command: 'sh', args: ['-lc', 'echo hi'], cwd: '/tmp/repo', timeoutMs: undefined });
      expect(result.text).toBe('ok');
    });

    it('starts background commands through the host runs backend API', async () => {
      mocks.startBackgroundRun.mockResolvedValue({ accepted: true, runId: 'run-123', logPath: '/tmp/run.log' });

      const result = await bash({ command: 'sleep 1', background: true }, createCtx());

      expect(mocks.pingDaemon).toHaveBeenCalled();
      expect(mocks.startBackgroundRun).toHaveBeenCalled();
      expect(result.text).toBe('Started background command run-123 for sleep-1.');
    });
  });

  describe('background_command handler', () => {
    it('lists durable runs through the host runs backend API', async () => {
      mocks.listDurableRuns.mockResolvedValue({ runs: [], summary: { total: 0 } });

      const result = await background_command({ action: 'list' }, createCtx());

      expect(mocks.listDurableRuns).toHaveBeenCalled();
      expect(result.text).toBe('No durable runs found.');
    });
  });

  describe('subagent handler', () => {
    it('normalizes start to start_agent and delegates to the registered subagent tool', async () => {
      mocks.subagentExecute.mockResolvedValue({
        content: [{ type: 'text', text: 'Started subagent run-789.' }],
      });

      const result = await subagent({ action: 'start', prompt: 'hello' }, createCtx());

      expect(result.text).toBe('Started subagent run-789.');
      expect(mocks.subagentExecute).toHaveBeenCalled();
    });
  });
});
