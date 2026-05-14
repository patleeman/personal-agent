import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveDesktopRuntimePaths: vi.fn(),
}));

vi.mock('./desktop-env.js', () => ({
  resolveDesktopRuntimePaths: mocks.resolveDesktopRuntimePaths,
}));

describe('desktop main log', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.resolveDesktopRuntimePaths.mockReturnValue({ desktopLogsDir: mkdtempSync(join(tmpdir(), 'desktop-main-log-')) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes log lines to the node console, Electron browser console, and main log file', async () => {
    const { closeDesktopMainLog, registerDesktopLogConsoleTarget, writeDesktopMainLogLine } = await import('./desktop-main-log.js');
    const browserConsoleTarget = {
      executeJavaScript: vi.fn(() => Promise.resolve(undefined)),
      isDestroyed: vi.fn(() => false),
      once: vi.fn(),
    };
    registerDesktopLogConsoleTarget(browserConsoleTarget as never);

    writeDesktopMainLogLine('[2026-05-14T00:00:00.000Z] [info] hello');
    writeDesktopMainLogLine('[2026-05-14T00:00:00.001Z] [warn] careful');
    writeDesktopMainLogLine('[2026-05-14T00:00:00.002Z] [error] boom');
    await closeDesktopMainLog();

    expect(console.log).toHaveBeenCalledWith('[2026-05-14T00:00:00.000Z] [info] hello');
    expect(console.warn).toHaveBeenCalledWith('[2026-05-14T00:00:00.001Z] [warn] careful');
    expect(console.error).toHaveBeenCalledWith('[2026-05-14T00:00:00.002Z] [error] boom');
    expect(browserConsoleTarget.executeJavaScript).toHaveBeenCalledWith('console.log("[2026-05-14T00:00:00.000Z] [info] hello")', true);
    expect(browserConsoleTarget.executeJavaScript).toHaveBeenCalledWith('console.warn("[2026-05-14T00:00:00.001Z] [warn] careful")', true);
    expect(browserConsoleTarget.executeJavaScript).toHaveBeenCalledWith('console.error("[2026-05-14T00:00:00.002Z] [error] boom")', true);

    const logPath = join(mocks.resolveDesktopRuntimePaths.mock.results[0]?.value.desktopLogsDir, 'main.log');
    expect(readFileSync(logPath, 'utf-8')).toBe(
      '[2026-05-14T00:00:00.000Z] [info] hello\n' +
        '[2026-05-14T00:00:00.001Z] [warn] careful\n' +
        '[2026-05-14T00:00:00.002Z] [error] boom\n',
    );
  });
});
