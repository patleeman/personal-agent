import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '@mariozechner/pi-coding-agent';

const spawnSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

import forkPaneExtension from './index';

const originalEnv = process.env;

function createSessionFixture(): { sessionManager: SessionManager; sessionFile: string; sessionDir: string } {
  const sessionDir = mkdtempSync(join(tmpdir(), 'fork-pane-session-'));
  const sessionManager = SessionManager.create('/tmp/workspace', sessionDir);

  sessionManager.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: 'First prompt' }],
    timestamp: Date.now(),
  });
  sessionManager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'First answer' }],
    timestamp: Date.now(),
    api: 'test',
    provider: 'test',
    model: 'test-model',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: 'stop',
  });
  sessionManager.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: 'Second prompt' }],
    timestamp: Date.now(),
  });

  return {
    sessionManager,
    sessionDir,
    sessionFile: sessionManager.getSessionFile() as string,
  };
}

function createUserOnlySessionFixture(): { sessionManager: SessionManager; sessionFile: string; sessionDir: string } {
  const sessionDir = mkdtempSync(join(tmpdir(), 'fork-pane-user-only-'));
  const sessionManager = SessionManager.create('/tmp/workspace', sessionDir);

  sessionManager.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: 'Only prompt so far' }],
    timestamp: Date.now(),
  });

  return {
    sessionManager,
    sessionDir,
    sessionFile: sessionManager.getSessionFile() as string,
  };
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_TMUX_WORKSPACE: '1',
    PERSONAL_AGENT_ACTIVE_PROFILE: 'shared',
    PERSONAL_AGENT_REPO_ROOT: process.cwd(),
    TMUX: '/tmp/tmux-test/default,123,0',
    TMUX_PANE: '%1',
  };
  spawnSyncMock.mockReset();
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe('fork-pane extension', () => {
  it('clones the current conversation into a new tmux pane', async () => {
    const commands: Record<string, { handler: (args: string, ctx: any) => Promise<void> | void }> = {};

    forkPaneExtension({
      on: vi.fn(),
      registerCommand: (name: string, config: { handler: (args: string, ctx: any) => Promise<void> | void }) => {
        commands[name] = config;
      },
      registerShortcut: vi.fn(),
    } as never);

    const fixture = createSessionFixture();

    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      expect(command).toBe('tmux');

      if (args[0] === 'split-window') {
        return {
          status: 0,
          stdout: '%9\n',
          stderr: '',
          error: undefined,
        };
      }

      if (args[0] === 'select-pane') {
        return {
          status: 0,
          stdout: '',
          stderr: '',
          error: undefined,
        };
      }

      return {
        status: 1,
        stdout: '',
        stderr: `unexpected tmux command: ${args.join(' ')}`,
        error: undefined,
      };
    });

    const notify = vi.fn();

    await commands['fork-pane']?.handler('', {
      hasUI: true,
      isIdle: () => true,
      sessionManager: fixture.sessionManager,
      ui: {
        notify,
      },
    });

    expect(spawnSyncMock).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Forked current conversation'), 'info');

    const splitCall = spawnSyncMock.mock.calls.find((call) => call[1]?.[0] === 'split-window');
    expect(splitCall).toBeDefined();
    const splitCommand = splitCall?.[1]?.[7] as string;
    expect(splitCommand).toContain('--profile');
    expect(splitCommand).toContain('--session');
    expect(splitCommand).toContain('PERSONAL_AGENT_TUI_DIRECT=1');

    const allFiles = readdirSync(fixture.sessionDir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => join(fixture.sessionDir, name));
    expect(allFiles).toHaveLength(2);

    const forkedSessionFile = allFiles.find((path) => path !== fixture.sessionFile);
    expect(forkedSessionFile).toBeDefined();

    const forked = SessionManager.open(forkedSessionFile as string, fixture.sessionDir);
    expect(forked.getEntries()).toHaveLength(3);
    expect(forked.getLeafEntry()).toMatchObject({
      type: 'message',
      message: {
        role: 'user',
      },
    });

    rmSync(fixture.sessionDir, { recursive: true, force: true });
  });

  it('writes a forked session file even when the source conversation has no assistant yet', async () => {
    const commands: Record<string, { handler: (args: string, ctx: any) => Promise<void> | void }> = {};

    forkPaneExtension({
      on: vi.fn(),
      registerCommand: (name: string, config: { handler: (args: string, ctx: any) => Promise<void> | void }) => {
        commands[name] = config;
      },
      registerShortcut: vi.fn(),
    } as never);

    const fixture = createUserOnlySessionFixture();

    expect(existsSync(fixture.sessionFile)).toBe(false);

    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      expect(command).toBe('tmux');

      if (args[0] === 'split-window') {
        return {
          status: 0,
          stdout: '%10\n',
          stderr: '',
          error: undefined,
        };
      }

      if (args[0] === 'select-pane') {
        return {
          status: 0,
          stdout: '',
          stderr: '',
          error: undefined,
        };
      }

      return {
        status: 1,
        stdout: '',
        stderr: `unexpected tmux command: ${args.join(' ')}`,
        error: undefined,
      };
    });

    const notify = vi.fn();

    await commands['fork-pane']?.handler('', {
      hasUI: true,
      isIdle: () => true,
      sessionManager: fixture.sessionManager,
      ui: {
        notify,
      },
    });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Forked current conversation'), 'info');

    const allFiles = readdirSync(fixture.sessionDir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => join(fixture.sessionDir, name));
    expect(allFiles).toHaveLength(1);

    const forked = SessionManager.open(allFiles[0] as string, fixture.sessionDir);
    expect(forked.getEntries()).toHaveLength(1);
    expect(forked.getLeafEntry()).toMatchObject({
      type: 'message',
      message: {
        role: 'user',
      },
    });

    rmSync(fixture.sessionDir, { recursive: true, force: true });
  });
});
