import { beforeEach, describe, expect, it } from 'vitest';

import { applyBashProcessWrappers, clearBashProcessWrappers, registerBashProcessWrapper } from './processWrappers.js';

describe('bash process wrappers', () => {
  beforeEach(() => {
    clearBashProcessWrappers();
  });

  it('applies registered wrappers in registration order', () => {
    registerBashProcessWrapper('test-prefix', (context) => ({
      ...context,
      command: `prefix ${context.command}`,
    }));
    registerBashProcessWrapper('test-env', (context) => ({
      ...context,
      env: { ...context.env, WRAPPED: '1' },
    }));

    expect(applyBashProcessWrappers({ command: 'echo hi', cwd: '/tmp', env: {} })).toEqual({
      command: 'prefix echo hi',
      cwd: '/tmp',
      env: { WRAPPED: '1' },
    });
  });

  it('replaces wrappers with the same id', () => {
    registerBashProcessWrapper('test-replace', (context) => ({ ...context, command: 'old' }));
    registerBashProcessWrapper('test-replace', (context) => ({ ...context, command: 'new' }));

    expect(applyBashProcessWrappers({ command: 'echo hi', cwd: '/tmp', env: {} }).command).toBe('new');
  });
});
