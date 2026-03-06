import { describe, expect, it, vi } from 'vitest';
import {
  captureManagedTmuxPane,
  listManagedTmuxSessions,
  PA_TMUX_COMMAND_OPTION,
  PA_TMUX_LOG_OPTION,
  PA_TMUX_MANAGED_OPTION,
  PA_TMUX_NOTIFY_CONTEXT_OPTION,
  PA_TMUX_NOTIFY_ON_COMPLETE_OPTION,
  PA_TMUX_TASK_OPTION,
  sendManagedTmuxCommand,
  startManagedTmuxSession,
  stopManagedTmuxSession,
  type TmuxRunner,
} from './tmux.js';

function createRunner(handler: (args: string[]) => { status: number | null; stdout: string; stderr: string; error?: Error }): TmuxRunner {
  return (args) => handler(args);
}

describe('tmux helpers', () => {
  it('lists only managed tmux sessions', () => {
    const runner = createRunner((args) => {
      expect(args[0]).toBe('list-sessions');

      return {
        status: 0,
        stdout: [
          'agent-a\t$1\t1\t0\t1700000000\t1\tcode-review\t/tmp/agent-a.log\tpa -p "review"',
          'random-dev\t$2\t2\t1\t1700000100\t\t\t\t',
        ].join('\n'),
        stderr: '',
      };
    });

    const sessions = listManagedTmuxSessions(runner);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      name: 'agent-a',
      id: '$1',
      windows: 1,
      attachedClients: 0,
      task: 'code-review',
      logPath: '/tmp/agent-a.log',
      command: 'pa -p "review"',
    });
  });

  it('returns an empty list when tmux server is not running', () => {
    const runner = createRunner(() => ({
      status: 1,
      stdout: '',
      stderr: 'no server running on /tmp/tmux-501/default',
    }));

    const sessions = listManagedTmuxSessions(runner);
    expect(sessions).toEqual([]);
  });

  it('treats tmux socket connection errors as no running server', () => {
    const runner = createRunner(() => ({
      status: 1,
      stdout: '',
      stderr: 'error connecting to /private/tmp/tmux-502/default (No such file or directory)',
    }));

    const sessions = listManagedTmuxSessions(runner);
    expect(sessions).toEqual([]);
  });

  it('stops only managed sessions', () => {
    const calls: string[][] = [];

    const runner = createRunner((args) => {
      calls.push(args);

      if (args[0] === 'list-sessions') {
        return {
          status: 0,
          stdout: 'agent-a\t$1\t1\t0\t1700000000\t1\tcode-review\t/tmp/agent-a.log\tpa -p "review"',
          stderr: '',
        };
      }

      if (args[0] === 'kill-session') {
        return {
          status: 0,
          stdout: '',
          stderr: '',
        };
      }

      return {
        status: 1,
        stdout: '',
        stderr: `unexpected command: ${args.join(' ')}`,
      };
    });

    stopManagedTmuxSession('agent-a', runner);

    expect(calls).toEqual([
      ['list-sessions', '-F', expect.any(String)],
      ['kill-session', '-t', 'agent-a'],
    ]);
  });

  it('sends commands to managed sessions only', () => {
    const calls: string[][] = [];

    const runner = createRunner((args) => {
      calls.push(args);

      if (args[0] === 'list-sessions') {
        return {
          status: 0,
          stdout: 'agent-a\t$1\t1\t0\t1700000000\t1\tcode-review\t/tmp/agent-a.log\tpa -p "review"',
          stderr: '',
        };
      }

      if (args[0] === 'send-keys') {
        return {
          status: 0,
          stdout: '',
          stderr: '',
        };
      }

      return {
        status: 1,
        stdout: '',
        stderr: `unexpected command: ${args.join(' ')}`,
      };
    });

    sendManagedTmuxCommand('agent-a', 'echo hello', runner);

    expect(calls).toEqual([
      ['list-sessions', '-F', expect.any(String)],
      ['send-keys', '-t', 'agent-a', 'echo hello', 'C-m'],
    ]);
  });

  it('captures pane output for managed sessions', () => {
    const runner = createRunner((args) => {
      if (args[0] === 'list-sessions') {
        return {
          status: 0,
          stdout: 'agent-a\t$1\t1\t0\t1700000000\t1\tcode-review\t/tmp/agent-a.log\tpa -p "review"',
          stderr: '',
        };
      }

      if (args[0] === 'capture-pane') {
        return {
          status: 0,
          stdout: 'line one\nline two\n',
          stderr: '',
        };
      }

      return {
        status: 1,
        stdout: '',
        stderr: 'unexpected command',
      };
    });

    const output = captureManagedTmuxPane('agent-a', 50, runner);
    expect(output).toBe('line one\nline two');
  });

  it('creates and tags managed sessions on start', () => {
    const calls: string[][] = [];

    const runner = createRunner((args) => {
      calls.push(args);

      return {
        status: 0,
        stdout: '',
        stderr: '',
      };
    });

    startManagedTmuxSession({
      sessionName: 'repo-code-review-20260305-130000',
      cwd: '/repo',
      command: 'pa -p "review" >/tmp/log 2>&1',
      task: 'code-review',
      logPath: '/tmp/log',
      sourceCommand: 'pa -p "review"',
      notifyOnComplete: true,
      notifyContext: 'group=alpha',
    }, runner);

    expect(calls[0]).toEqual([
      'new-session',
      '-d',
      '-s',
      'repo-code-review-20260305-130000',
      '-c',
      '/repo',
      'pa -p "review" >/tmp/log 2>&1',
    ]);

    expect(calls).toContainEqual(['set-option', '-t', 'repo-code-review-20260305-130000', PA_TMUX_MANAGED_OPTION, '1']);
    expect(calls).toContainEqual(['set-option', '-t', 'repo-code-review-20260305-130000', PA_TMUX_TASK_OPTION, 'code-review']);
    expect(calls).toContainEqual(['set-option', '-t', 'repo-code-review-20260305-130000', PA_TMUX_LOG_OPTION, '/tmp/log']);
    expect(calls).toContainEqual(['set-option', '-t', 'repo-code-review-20260305-130000', PA_TMUX_COMMAND_OPTION, 'pa -p "review"']);
    expect(calls).toContainEqual(['set-option', '-t', 'repo-code-review-20260305-130000', PA_TMUX_NOTIFY_ON_COMPLETE_OPTION, '1']);
    expect(calls).toContainEqual(['set-option', '-t', 'repo-code-review-20260305-130000', PA_TMUX_NOTIFY_CONTEXT_OPTION, 'group=alpha']);
  });

  it('does not fail tagging when a short-lived session exits before metadata is set', () => {
    const calls: string[][] = [];

    const runner = createRunner((args) => {
      calls.push(args);

      if (args[0] === 'new-session') {
        return {
          status: 0,
          stdout: '',
          stderr: '',
        };
      }

      return {
        status: 1,
        stdout: '',
        stderr: 'no such session: quick-session',
      };
    });

    expect(() => startManagedTmuxSession({
      sessionName: 'quick-session',
      cwd: '/tmp',
      command: 'echo done',
      task: 'quick',
    }, runner)).not.toThrow();

    expect(calls[0]?.[0]).toBe('new-session');
    expect(calls[1]?.[0]).toBe('set-option');
  });

  it('throws for unknown managed sessions', () => {
    const runner = createRunner(() => ({
      status: 0,
      stdout: '',
      stderr: '',
    }));

    expect(() => stopManagedTmuxSession('missing', runner)).toThrow('No managed tmux session found: missing');
  });

  it('throws a clear error when tmux is missing', () => {
    const runner = createRunner(() => ({
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('spawnSync tmux ENOENT'), { code: 'ENOENT' }),
    }));

    expect(() => listManagedTmuxSessions(runner)).toThrow('tmux is not installed or not available on PATH');
  });

  it('rejects empty send commands', () => {
    const runner = vi.fn();

    expect(() => sendManagedTmuxCommand('agent-a', '   ', runner as unknown as TmuxRunner)).toThrow('Command cannot be empty');
    expect(runner).not.toHaveBeenCalled();
  });
});
