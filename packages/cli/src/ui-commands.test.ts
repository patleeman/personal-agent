import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ui command help', () => {
  it('shows web UI commands in pa ui --help', async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['ui', '--help']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Commands:'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui logs [--tail <count>]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui service install [--port <port>]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui service status [--port <port>]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui service rollback [--port <port>]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui service mark-bad [--port <port>]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui service help'))).toBe(true);

    logSpy.mockRestore();
  });

  it('shows service-specific help for pa ui service --help', async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['ui', 'service', '--help']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Web UI service'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui service install [--port <port>]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui service restart [--port <port>]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui service rollback [--port <port>]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui service mark-bad [--port <port>]'))).toBe(true);
    expect(logs.some((line) => line.includes('Supported platforms'))).toBe(true);

    logSpy.mockRestore();
  });
});
