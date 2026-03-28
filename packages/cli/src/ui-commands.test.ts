import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ui command help', () => {
  it('shows web UI commands in pa ui --help', async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['ui', '--help']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Usage: pa ui'))).toBe(true);
    expect(logs.some((line) => line.includes('Commands:'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui status [--port <port>]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui open [--port <port>]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui foreground [--open] [--port <port>] [--tailscale-serve|--no-tailscale-serve]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui install [--port <port>] [--tailscale-serve|--no-tailscale-serve]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui restart [--port <port>] [--tailscale-serve|--no-tailscale-serve]'))).toBe(true);
    expect(logs.some((line) => line.includes('Compatibility: `pa ui service ...` still works'))).toBe(true);

    logSpy.mockRestore();
  });

  it('creates a pairing code for remote access', async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 'pair-1',
      code: 'ABCD-EFGH-IJKL',
      createdAt: '2026-03-25T12:00:00.000Z',
      expiresAt: '2026-03-25T12:10:00.000Z',
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const exitCode = await runCli(['ui', 'pairing-code', '--port', '4810']);

    expect(exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4810/api/companion-auth/pairing-code', {
      method: 'POST',
      headers: {
        Origin: 'http://127.0.0.1:4810',
      },
    });
    expect(logs.some((line) => line.includes('ABCD-EFGH-IJKL'))).toBe(true);

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
    expect(logs.some((line) => line.includes('pa ui service install [--port <port>] [--tailscale-serve|--no-tailscale-serve]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui service restart [--port <port>] [--tailscale-serve|--no-tailscale-serve]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui service rollback [--port <port>] [--tailscale-serve|--no-tailscale-serve]'))).toBe(true);
    expect(logs.some((line) => line.includes('pa ui service mark-bad [--port <port>]'))).toBe(true);
    expect(logs.some((line) => line.includes('Supported platforms'))).toBe(true);

    logSpy.mockRestore();
  });
});
