import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './index.js';

const originalEnv = process.env;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
  };
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe('node command', () => {
  it('is no longer exposed as a top-level CLI command', async () => {
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    const exitCode = await runCli(['node', 'list', '--json']);

    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes('Unknown top-level command or option: node'))).toBe(true);
    expect(errors.some((line) => line.includes("Use 'pa tui ...' to pass arguments to Pi."))).toBe(true);

    errorSpy.mockRestore();
  });
});
