import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  captureManagedTmuxPane,
  ensurePaTmuxConfig,
  listManagedTmuxSessions,
  openManagedTmuxLogPane,
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
  it('writes PA tmux config with 1-based window and pane numbering', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'personal-agent-tmux-config-'));
    const previousStateRoot = process.env.PERSONAL_AGENT_STATE_ROOT;

    try {
      process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
      const configPath = ensurePaTmuxConfig();
      const config = readFileSync(configPath, 'utf-8');

      expect(config).toContain('set -g default-terminal "tmux-256color"');
      expect(config).toContain('set -g prefix None');
      expect(config).toContain('set -g extended-keys on');
      expect(config).toContain('set -g extended-keys-format csi-u');
      expect(config).toContain("set -g terminal-features[98] '*:RGB'");
      expect(config).toContain("set -g terminal-features[99] 'xterm*:extkeys'");
      expect(config).toContain('set -g window-status-style fg=colour250,bg=colour236');
      expect(config).toContain('set -g window-status-current-style fg=colour231,bg=colour25,bold');
      expect(config).toContain('set -g window-status-current-format "#[fg=colour231,bg=colour25,bold] #I:#W#{?window_flags, #{window_flags},} "');
      expect(config).toContain('set -g initial-repeat-time 1000');
      expect(config).toContain('set -g repeat-time 1000');
      expect(config).toContain('bind-key -n C-Space display-message -d 1000');
      expect(config).toContain('switch-client -T pa-workspace');
      expect(config).toContain('bind-key -r -T pa-workspace H resize-pane -L 5');
      expect(config).toContain('bind-key -r -T pa-workspace L resize-pane -R 5');
      expect(config).toContain('bind-key -T pa-workspace ? display-popup');
      expect(config).toContain("bind-key -T pa-workspace '-' split-window -v");
      expect(config).toContain("bind-key -T pa-workspace '|' split-window -h");
      expect(config).toContain("bind-key -T pa-workspace '[' previous-window");
      expect(config).toContain("bind-key -T pa-workspace ']' next-window");
      expect(config).toContain('bind-key -T pa-workspace 1 select-window -t :1');
      expect(config).toContain('set -g base-index 1');
      expect(config).toContain('setw -g pane-base-index 1');
      expect(config).toContain('Hotkey: Ctrl+Space');
      expect(config).toContain('H/J/K/L resize pane left/down/up/right (repeat for 1s)');
      expect(config).toContain('[   previous window');
      expect(config).toContain(']   next window');
      expect(config).toContain('1-9 switch to window 1-9');
      expect(config).toContain('Ctrl+Space #[fg=colour252]shortcuts');
      expect(config).toContain('menu-selected-style');
      expect(config).toContain('#{@pa_profile}');
      expect(config).toContain('confirm-before -p "kill-pane #P? (y/n)" kill-pane');
      expect(config).not.toContain('Close current pane?');
      expect(config).not.toContain('Press y to close or any other key to cancel.');
    } finally {
      if (previousStateRoot === undefined) {
        delete process.env.PERSONAL_AGENT_STATE_ROOT;
      } else {
        process.env.PERSONAL_AGENT_STATE_ROOT = previousStateRoot;
      }

      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

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

  it('opens a managed log viewer pane', () => {
    const calls: string[][] = [];

    const runner = createRunner((args) => {
      calls.push(args);

      if (args[0] === 'split-window') {
        return {
          status: 0,
          stdout: '%9\n',
          stderr: '',
        };
      }

      if (args[0] === 'select-pane') {
        return {
          status: 0,
          stdout: '',
          stderr: '',
        };
      }

      return {
        status: 1,
        stdout: '',
        stderr: 'unexpected command',
      };
    });

    const paneId = openManagedTmuxLogPane({
      targetPane: '%7',
      sessionName: 'agent-a',
      logPath: '/tmp/agent-a.log',
      title: 'code-review',
    }, runner);

    expect(paneId).toBe('%9');
    expect(calls[0]).toEqual(['split-window', '-h', '-P', '-F', '#{pane_id}', '-t', '%7', expect.stringContaining('tail -n +1 -F')]);
    expect(calls[1]).toEqual(['select-pane', '-t', '%9', '-T', 'code-review']);
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
