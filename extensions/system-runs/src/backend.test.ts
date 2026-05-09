import { describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn();

vi.mock('./runTool.js', () => ({
  createRunAgentExtension: vi.fn(() => (pi: { registerTool: (t: unknown) => void }) => {
    pi.registerTool({ execute: mockExecute });
  }),
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
  persistAppTelemetryEvent: vi.fn(),
  parseDeferredResumeDelayMs: vi.fn(),
}));

import { run } from './backend.js';

function createCtx(overrides?: Record<string, unknown>) {
  return {
    toolContext: { conversationId: 'conv-1', cwd: '/tmp/repo', sessionFile: '/tmp/session.json', sessionId: 'sess-1' },
    ui: { invalidate: vi.fn() },
    ...overrides,
  };
}

describe('system-runs backend', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('run handler', () => {
    it('delegates to the registered run tool and wraps text result', async () => {
      mockExecute.mockResolvedValue({
        content: [{ type: 'text', text: 'Run abc1234 started.' }],
      });

      const result = await run({ action: 'start', taskSlug: 'test' }, createCtx());
      expect(result.text).toBe('Run abc1234 started.');
    });

    it('passes details through when present', async () => {
      mockExecute.mockResolvedValue({
        content: [{ type: 'text', text: 'Running...' }],
        details: { runId: 'abc1234', status: 'running' },
      });

      const result = await run({ action: 'start', taskSlug: 'test' }, createCtx());
      expect(result.details).toEqual({ runId: 'abc1234', status: 'running' });
    });

    it('handles multiple content blocks', async () => {
      mockExecute.mockResolvedValue({
        content: [
          { type: 'text', text: 'Run 1' },
          { type: 'text', text: 'Run 2' },
        ],
      });

      const result = await run({ action: 'list' }, createCtx());
      expect(result.text).toBe('Run 1\nRun 2');
    });

    it('handles non-array content result', async () => {
      mockExecute.mockResolvedValue({ status: 'ok' });

      const result = await run({ action: 'get', runId: 'abc' }, createCtx());
      expect(result.text).toContain('"status"');
    });

    it('invalidates runs and tasks topics after execution', async () => {
      const invalidate = vi.fn();
      mockExecute.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      });

      await run({ action: 'list' }, createCtx({ ui: { invalidate } }));
      expect(invalidate).toHaveBeenCalledWith(['runs', 'tasks']);
    });
  });
});
