import { describe, expect, it, vi } from 'vitest';

import { executeLiveSessionBash, type LiveSessionBashHost } from './liveSessionBash.js';

function createMockHost(overrides?: Partial<LiveSessionBashHost>): LiveSessionBashHost {
  return {
    sessionId: 'test-session-1',
    session: {
      isBashRunning: false,
      executeBash: vi.fn(),
    },
    ...overrides,
  };
}

function createBroadcastMock(): ReturnType<typeof vi.fn> & { calls: { type: string }[] } {
  return vi.fn();
}

describe('executeLiveSessionBash', () => {
  describe('validation', () => {
    it('throws when the command is empty', async () => {
      const host = createMockHost();
      const broadcast = createBroadcastMock();

      await expect(executeLiveSessionBash(host, '', { broadcast })).rejects.toThrow('command required');
      expect(broadcast).not.toHaveBeenCalled();
    });

    it('throws when the command is only whitespace', async () => {
      const host = createMockHost();
      const broadcast = createBroadcastMock();

      await expect(executeLiveSessionBash(host, '   ', { broadcast })).rejects.toThrow('command required');
      expect(broadcast).not.toHaveBeenCalled();
    });

    it('throws when bash is already running', async () => {
      const host = createMockHost({ session: { isBashRunning: true, executeBash: vi.fn() } });
      const broadcast = createBroadcastMock();

      await expect(executeLiveSessionBash(host, 'ls', { broadcast })).rejects.toThrow('A bash command is already running.');
      expect(broadcast).not.toHaveBeenCalled();
    });
  });

  describe('successful execution', () => {
    it('broadcasts tool_start, runs bash, and broadcasts tool_end with output', async () => {
      const executeBash = vi.fn().mockResolvedValue({ output: 'file1.txt\nfile2.txt', exitCode: 0 });
      const host = createMockHost({ session: { isBashRunning: false, executeBash } });
      const broadcast = createBroadcastMock();
      executeBash.mockImplementation(async (_cmd: string, onChunk: (chunk: string) => void) => {
        onChunk('file1.txt\n');
        onChunk('file2.txt\n');
        return { output: 'file1.txt\nfile2.txt', exitCode: 0 };
      });

      const result = await executeLiveSessionBash(host, 'ls -la', { broadcast });

      expect(result.normalizedCommand).toBe('ls -la');
      expect(result.result).toEqual({ output: 'file1.txt\nfile2.txt', exitCode: 0 });

      // Should broadcast tool_start with the command
      expect(broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_start',
          toolName: 'bash',
          args: expect.objectContaining({ command: 'ls -la', displayMode: 'terminal' }),
        }),
      );

      // Should broadcast tool_end with success
      const toolEndCalls = broadcast.mock.calls.filter((c: unknown[]) => (c[0] as { type: string }).type === 'tool_end');
      expect(toolEndCalls).toHaveLength(1);
      expect(toolEndCalls[0][0]).toMatchObject({
        type: 'tool_end',
        toolName: 'bash',
        isError: false,
        output: 'file1.txt\nfile2.txt',
      });
      expect(toolEndCalls[0][0].durationMs).toEqual(expect.any(Number));
      expect(toolEndCalls[0][0].details).toMatchObject({ displayMode: 'terminal', exitCode: 0 });
    });

    it('trims whitespace from the command', async () => {
      const executeBash = vi.fn().mockResolvedValue({ output: 'ok', exitCode: 0 });
      const host = createMockHost({ session: { isBashRunning: false, executeBash } });
      const broadcast = createBroadcastMock();

      await executeLiveSessionBash(host, '  whoami  ', { broadcast });

      expect(executeBash).toHaveBeenCalledWith('whoami', expect.any(Function), expect.any(Object));
    });

    it('marks cancelled executions in the details', async () => {
      const executeBash = vi.fn().mockResolvedValue({ output: '', exitCode: null, cancelled: true });
      const host = createMockHost({ session: { isBashRunning: false, executeBash } });
      const broadcast = createBroadcastMock();

      await executeLiveSessionBash(host, 'sleep 100', { broadcast });

      const toolEndCalls = broadcast.mock.calls.filter((c: unknown[]) => (c[0] as { type: string }).type === 'tool_end');
      expect(toolEndCalls[0][0].details).toMatchObject({ cancelled: true });
    });

    it('marks truncated output in the details', async () => {
      const executeBash = vi.fn().mockResolvedValue({ output: 'lots of output', exitCode: 0, truncated: true });
      const host = createMockHost({ session: { isBashRunning: false, executeBash } });
      const broadcast = createBroadcastMock();

      await executeLiveSessionBash(host, 'cat bigfile', { broadcast });

      const toolEndCalls = broadcast.mock.calls.filter((c: unknown[]) => (c[0] as { type: string }).type === 'tool_end');
      expect(toolEndCalls[0][0].details).toMatchObject({ truncated: true });
    });

    it('includes fullOutputPath when present', async () => {
      const executeBash = vi.fn().mockResolvedValue({
        output: 'output',
        exitCode: 0,
        fullOutputPath: '/tmp/bash-output.log',
      });
      const host = createMockHost({ session: { isBashRunning: false, executeBash } });
      const broadcast = createBroadcastMock();

      await executeLiveSessionBash(host, 'long command', { broadcast });

      const toolEndCalls = broadcast.mock.calls.filter((c: unknown[]) => (c[0] as { type: string }).type === 'tool_end');
      expect(toolEndCalls[0][0].details).toMatchObject({ fullOutputPath: '/tmp/bash-output.log' });
    });

    it('passes excludeFromContext to executeBash and broadcast', async () => {
      const executeBash = vi.fn().mockResolvedValue({ output: 'ok', exitCode: 0 });
      const host = createMockHost({ session: { isBashRunning: false, executeBash } });
      const broadcast = createBroadcastMock();

      await executeLiveSessionBash(host, 'ls', { excludeFromContext: true, broadcast });

      expect(executeBash).toHaveBeenCalledWith('ls', expect.any(Function), { excludeFromContext: true });

      const toolStartCalls = broadcast.mock.calls.filter((c: unknown[]) => (c[0] as { type: string }).type === 'tool_start');
      expect(toolStartCalls[0][0].args).toMatchObject({ excludeFromContext: true });

      const toolEndCalls = broadcast.mock.calls.filter((c: unknown[]) => (c[0] as { type: string }).type === 'tool_end');
      expect(toolEndCalls[0][0].details).toMatchObject({ excludeFromContext: true });
    });

    it('falls back to streamed output when result.output is not a string', async () => {
      const executeBash = vi.fn().mockImplementation(async (_cmd: string, onChunk: (chunk: string) => void) => {
        onChunk('streamed line 1\n');
        onChunk('streamed line 2\n');
        return { output: null, exitCode: 0 };
      });
      const host = createMockHost({ session: { isBashRunning: false, executeBash } });
      const broadcast = createBroadcastMock();

      await executeLiveSessionBash(host, 'echo test', { broadcast });

      const toolEndCalls = broadcast.mock.calls.filter((c: unknown[]) => (c[0] as { type: string }).type === 'tool_end');
      expect(toolEndCalls[0][0].output).toBe('streamed line 1\nstreamed line 2\n');
    });
  });

  describe('error handling', () => {
    it('broadcasts tool_end as error and re-throws when executeBash fails', async () => {
      const executeError = new Error('permission denied');
      const executeBash = vi.fn().mockRejectedValue(executeError);
      const host = createMockHost({ session: { isBashRunning: false, executeBash } });
      const broadcast = createBroadcastMock();

      await expect(executeLiveSessionBash(host, 'rm -rf /', { broadcast })).rejects.toThrow('permission denied');

      const toolEndCalls = broadcast.mock.calls.filter((c: unknown[]) => (c[0] as { type: string }).type === 'tool_end');
      expect(toolEndCalls).toHaveLength(1);
      expect(toolEndCalls[0][0]).toMatchObject({
        type: 'tool_end',
        toolName: 'bash',
        isError: true,
        output: 'permission denied',
      });
    });

    it('stringifies non-Error exceptions in the broadcast output', async () => {
      const executeBash = vi.fn().mockRejectedValue('string error');
      const host = createMockHost({ session: { isBashRunning: false, executeBash } });
      const broadcast = createBroadcastMock();

      await expect(executeLiveSessionBash(host, 'fail', { broadcast })).rejects.toBe('string error');

      const toolEndCalls = broadcast.mock.calls.filter((c: unknown[]) => (c[0] as { type: string }).type === 'tool_end');
      expect(toolEndCalls[0][0].output).toBe('string error');
    });
  });

  describe('tool call id generation', () => {
    it('generates unique tool call ids for sequential calls', async () => {
      const executeBash = vi.fn().mockResolvedValue({ output: 'ok', exitCode: 0 });
      const host = createMockHost({ session: { isBashRunning: false, executeBash } });
      const broadcast = createBroadcastMock();

      await executeLiveSessionBash(host, 'cmd1', { broadcast });
      await executeLiveSessionBash(host, 'cmd2', { broadcast });

      const toolStartCalls = broadcast.mock.calls.filter((c: unknown[]) => (c[0] as { type: string }).type === 'tool_start');
      expect(toolStartCalls).toHaveLength(2);
      expect(toolStartCalls[0][0].toolCallId).not.toBe(toolStartCalls[1][0].toolCallId);
    });
  });
});
