import { describe, expect, it } from 'vitest';
import { normalizeCommandTimeoutMs, runCommand } from './command.js';

describe('runCommand', () => {
  it('defaults malformed timeout values', () => {
    expect(normalizeCommandTimeoutMs(1.5)).toBe(60_000);
    expect(normalizeCommandTimeoutMs(Number.MAX_SAFE_INTEGER + 1)).toBe(60_000);
    expect(normalizeCommandTimeoutMs(Number.MAX_SAFE_INTEGER)).toBe(10 * 60_000);
  });

  it('returns stdout/stderr output and zero exit code for successful commands', async () => {
    const result = await runCommand(process.execPath, [
      '-e',
      'process.stdout.write("  hello world  "); process.stderr.write("  warning  ");',
    ]);

    expect(result).toEqual({
      code: 0,
      stdout: 'hello world',
      stderr: 'warning',
    });
  });

  it('returns non-zero exit code without throwing', async () => {
    const result = await runCommand(process.execPath, [
      '-e',
      'process.stderr.write("boom"); process.exit(5);',
    ]);

    expect(result.code).toBe(5);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('boom');
  });

  it('rejects when the process cannot be spawned', async () => {
    await expect(runCommand('personal-agent-command-that-does-not-exist', []))
      .rejects
      .toThrow();
  });

  it('rejects with a timeout error when command exceeds timeout', async () => {
    await expect(runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1_000);'], 40))
      .rejects
      .toThrow('timed out after 40ms');
  });
});
