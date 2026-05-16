import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runExecute: vi.fn(),
  backgroundCommandExecute: vi.fn(),
  subagentExecute: vi.fn(),
  pingDaemon: vi.fn().mockResolvedValue(true),
  startBackgroundRun: vi.fn(),
  listDurableRuns: vi.fn(),
  getDurableRun: vi.fn(),
  getDurableRunLog: vi.fn(),
  cancelDurableRun: vi.fn(),
  rerunDurableRun: vi.fn(),
  followUpDurableRun: vi.fn(),
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
  followUpDurableRun: mocks.followUpDurableRun,
  getDurableRun: mocks.getDurableRun,
  getDurableRunLog: mocks.getDurableRunLog,
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

function durableRun(runId: string, kind: string, taskSlug: string, status = 'running') {
  return {
    runId,
    manifest: { kind, spec: { metadata: { taskSlug }, ...(kind === 'raw-shell' ? { shellCommand: 'echo ok' } : {}) } },
    status: { status },
    paths: { outputLogPath: `/tmp/${runId}.log` },
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

    it('does not fail when UI invalidation is unavailable', async () => {
      mocks.runExecute.mockResolvedValue({
        content: [{ type: 'text', text: 'Running...' }],
      });

      const result = await run({ action: 'start', taskSlug: 'test' }, createCtx({ ui: undefined }));
      expect(result.text).toBe('Running...');
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

      expect(ctx.shell.exec).toHaveBeenCalledWith({
        command: 'sh',
        args: ['-lc', 'echo hi'],
        cwd: '/tmp/repo',
        timeoutMs: undefined,
        signal: undefined,
      });
      expect(result.text).toBe('ok');
    });

    it('passes the active tool abort signal to foreground shell commands', async () => {
      const signal = new AbortController().signal;
      const ctx = createCtx({ agentToolContext: { signal } });

      await bash({ command: 'sleep 10' }, ctx);

      expect(ctx.shell.exec).toHaveBeenCalledWith({
        command: 'sh',
        args: ['-lc', 'sleep 10'],
        cwd: '/tmp/repo',
        timeoutMs: undefined,
        signal,
      });
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
    it('lists only shell background commands through the host runs backend API', async () => {
      mocks.listDurableRuns.mockResolvedValue({
        runs: [durableRun('run-shell', 'raw-shell', 'shell-task'), durableRun('run-agent', 'background-run', 'agent-task')],
        summary: { total: 2 },
      });

      const result = await background_command({ action: 'list' }, createCtx());

      expect(mocks.listDurableRuns).toHaveBeenCalled();
      expect(result.text).toContain('Background commands (1):');
      expect(result.text).toContain('run-shell');
      expect(result.text).not.toContain('run-agent');
    });

    it('rejects subagent runs with a clear tool hint', async () => {
      mocks.getDurableRun.mockResolvedValue({ run: durableRun('run-agent', 'background-run', 'agent-task') });

      await expect(background_command({ action: 'logs', runId: 'run-agent' }, createCtx())).rejects.toThrow(
        'Use subagent for this execution',
      );
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

    it('lists only subagent runs', async () => {
      mocks.listDurableRuns.mockResolvedValue({
        runs: [durableRun('run-shell', 'raw-shell', 'shell-task'), durableRun('run-agent', 'background-run', 'agent-task')],
        summary: { total: 2 },
      });

      const result = await subagent({ action: 'list' }, createCtx());

      expect(result.text).toContain('Subagents (1):');
      expect(result.text).toContain('run-agent');
      expect(result.text).not.toContain('run-shell');
    });

    it('reads subagent logs without using background_command', async () => {
      mocks.getDurableRun.mockResolvedValue({ run: durableRun('run-agent', 'background-run', 'agent-task') });
      mocks.getDurableRunLog.mockResolvedValue({ path: '/tmp/run-agent.log', log: 'agent failed' });

      const result = await subagent({ action: 'logs', runId: 'run-agent' }, createCtx());

      expect(result.text).toContain('Subagent logs: run-agent');
      expect(result.text).toContain('agent failed');
      expect(mocks.getDurableRunLog).toHaveBeenCalledWith('run-agent', 120);
    });
  });
});
