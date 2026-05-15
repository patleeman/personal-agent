import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clearResolvedChildProcessEnvCache } from '@personal-agent/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearProcessWrappers, registerProcessWrapper, resolveProcessLaunch } from '../shared/processLauncher.js';

const tempDirs: string[] = [];

function createFakeZsh(entries: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'process-launch-shell-'));
  tempDirs.push(dir);
  const shellPath = join(dir, 'zsh');
  writeFileSync(
    shellPath,
    [
      '#!/bin/sh',
      "printf '%s\\0' '__PERSONAL_AGENT_ENV_START__'",
      ...entries.map((entry) => `printf '%s\\0' ${JSON.stringify(entry)}`),
      "printf '%s\\0' '__PERSONAL_AGENT_ENV_END__'",
    ].join('\n'),
    'utf-8',
  );
  chmodSync(shellPath, 0o755);
  return shellPath;
}

describe('process wrappers', () => {
  beforeEach(() => {
    clearProcessWrappers();
    clearResolvedChildProcessEnvCache();
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('applies registered wrappers in registration order', () => {
    registerProcessWrapper('test-prefix', (context) => ({
      ...context,
      args: ['--prefix', ...context.args],
    }));
    registerProcessWrapper('test-env', (context) => ({
      ...context,
      env: { ...context.env, WRAPPED: '1' },
    }));

    expect(resolveProcessLaunch({ command: 'echo', args: ['hi'], cwd: '/tmp', env: {} })).toEqual({
      command: 'echo',
      args: ['--prefix', 'hi'],
      cwd: '/tmp',
      env: { WRAPPED: '1' },
      shell: undefined,
      wrappers: [
        { id: 'test-prefix', label: undefined },
        { id: 'test-env', label: undefined },
      ],
    });
  });

  it('hydrates launch env from the interactive shell before wrappers run', () => {
    const shellPath = createFakeZsh(['PATH=/opt/homebrew/bin:/Users/patrick/Library/pnpm/bin:/usr/bin', 'FROM_SHELL=1']);
    let wrapperPath = '';
    registerProcessWrapper('capture-env', (context) => {
      wrapperPath = context.env.PATH ?? '';
      return context;
    });

    const launch = resolveProcessLaunch({
      command: 'pnpm',
      env: { SHELL: shellPath, HOME: '/tmp/patrick', PATH: '/usr/bin:/base/bin' },
    });

    expect(launch.env.FROM_SHELL).toBe('1');
    expect(launch.env.PATH).toBe('/opt/homebrew/bin:/Users/patrick/Library/pnpm/bin:/usr/bin:/base/bin');
    expect(wrapperPath).toBe(launch.env.PATH);
  });

  it('replaces wrappers with the same id', () => {
    registerProcessWrapper('test-replace', (context) => ({ ...context, command: 'old' }));
    registerProcessWrapper('test-replace', (context) => ({ ...context, command: 'new' }));

    expect(resolveProcessLaunch({ command: 'echo', args: ['hi'], cwd: '/tmp', env: {} }).command).toBe('new');
  });
});
