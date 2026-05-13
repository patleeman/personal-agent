import { beforeEach, describe, expect, it } from 'vitest';

import { clearProcessWrappers, registerProcessWrapper, resolveProcessLaunch } from '../shared/processLauncher.js';

describe('process wrappers', () => {
  beforeEach(() => {
    clearProcessWrappers();
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

  it('replaces wrappers with the same id', () => {
    registerProcessWrapper('test-replace', (context) => ({ ...context, command: 'old' }));
    registerProcessWrapper('test-replace', (context) => ({ ...context, command: 'new' }));

    expect(resolveProcessLaunch({ command: 'echo', args: ['hi'], cwd: '/tmp', env: {} }).command).toBe('new');
  });
});
