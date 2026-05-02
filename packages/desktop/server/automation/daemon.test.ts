import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getDaemonStatusMock, loadDaemonConfigMock, pingDaemonMock, resolveDaemonPathsMock, setDaemonPowerKeepAwakeMock } = vi.hoisted(
  () => ({
    getDaemonStatusMock: vi.fn(),
    loadDaemonConfigMock: vi.fn(),
    pingDaemonMock: vi.fn(),
    resolveDaemonPathsMock: vi.fn(),
    setDaemonPowerKeepAwakeMock: vi.fn(),
  }),
);

vi.mock('@personal-agent/daemon', () => ({
  getDaemonStatus: getDaemonStatusMock,
  loadDaemonConfig: loadDaemonConfigMock,
  pingDaemon: pingDaemonMock,
  resolveDaemonPaths: resolveDaemonPathsMock,
  setDaemonPowerKeepAwake: setDaemonPowerKeepAwakeMock,
}));

import { readDaemonState, updateDaemonPowerAndReadState } from './daemon.js';

const tempDirs: string[] = [];
const originalEnv = process.env;

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-daemon-state-'));
  tempDirs.push(dir);
  return dir;
}

function expectedLogFile(dir: string): string {
  return join(dir, 'desktop/logs/daemon.log');
}

describe('automation daemon', () => {
  afterEach(async () => {
    process.env = originalEnv;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PERSONAL_AGENT_DESKTOP_RUNTIME;
    delete process.env.PERSONAL_AGENT_DESKTOP_DAEMON_LOG_FILE;
    delete process.env.PERSONAL_AGENT_DESKTOP_DAEMON_OWNERSHIP;
    getDaemonStatusMock.mockReset();
    loadDaemonConfigMock.mockReset();
    pingDaemonMock.mockReset();
    resolveDaemonPathsMock.mockReset();
    setDaemonPowerKeepAwakeMock.mockReset();
  });

  it('reads healthy daemon state and filters removed sync log lines', async () => {
    const dir = createTempDir();
    const logFile = join(dir, 'personal-agentd.log');
    writeFileSync(logFile, 'line one\n[module:sync] hidden\nline two\n', 'utf-8');

    loadDaemonConfigMock.mockReturnValue({ power: { keepAwake: false }, ipc: { socketPath: join(dir, 'daemon.sock') } });
    resolveDaemonPathsMock.mockReturnValue({ root: dir, socketPath: '/tmp/runtime.sock', logFile });
    pingDaemonMock.mockResolvedValue(true);
    getDaemonStatusMock.mockResolvedValue({
      socketPath: '/tmp/runtime.sock',
      pid: 42,
      startedAt: '2026-04-10T00:00:00.000Z',
      modules: [{ id: 'tasks' }, { id: 'runs' }],
      queue: { currentDepth: 2, maxDepth: 5 },
      power: { keepAwake: false, supported: true, active: false },
    });

    const state = await readDaemonState();
    expect(state.warnings).toEqual([]);
    expect(state.service).toMatchObject({
      platform: 'desktop',
      identifier: 'desktop-local-daemon',
      manifestPath: 'desktop menubar runtime',
      installed: true,
      running: true,
    });
    expect(state.runtime).toEqual({
      running: true,
      socketPath: '/tmp/runtime.sock',
      pid: 42,
      startedAt: '2026-04-10T00:00:00.000Z',
      moduleCount: 2,
      queueDepth: 2,
      maxQueueDepth: 5,
    });
    expect(state.power).toEqual({
      keepAwake: false,
      supported: true,
      active: false,
    });
    expect(state.log.path).toEqual(expect.any(String));
    expect(state.log.lines).toEqual(['line one', 'line two']);
  });

  it('reports offline daemon warnings when the daemon is not responding', async () => {
    const dir = createTempDir();
    const logFile = join(dir, 'personal-agentd.log');

    loadDaemonConfigMock.mockReturnValue({ power: { keepAwake: false }, ipc: { socketPath: join(dir, 'daemon.sock') } });
    resolveDaemonPathsMock.mockReturnValue({ root: dir, socketPath: '/tmp/runtime.sock', logFile });
    pingDaemonMock.mockResolvedValue(false);

    const state = await readDaemonState();
    expect(state.warnings).toEqual(['Daemon runtime is not responding on the local socket.']);
    expect(state.runtime).toEqual({
      running: false,
      socketPath: '/tmp/runtime.sock',
      moduleCount: 0,
    });
  });

  it('updates daemon power through the running daemon and returns refreshed state', async () => {
    const dir = createTempDir();
    const logFile = join(dir, 'personal-agentd.log');

    loadDaemonConfigMock.mockReturnValue({ power: { keepAwake: false }, ipc: { socketPath: join(dir, 'daemon.sock') } });
    resolveDaemonPathsMock.mockReturnValue({ root: dir, socketPath: '/tmp/runtime.sock', logFile });
    pingDaemonMock.mockResolvedValue(true);
    setDaemonPowerKeepAwakeMock.mockResolvedValue({});
    getDaemonStatusMock.mockResolvedValue({
      socketPath: '/tmp/runtime.sock',
      pid: 42,
      startedAt: '2026-04-10T00:00:00.000Z',
      modules: [],
      queue: { currentDepth: 0, maxDepth: 5 },
      power: { keepAwake: true, supported: true, active: true },
    });

    await expect(updateDaemonPowerAndReadState({ keepAwake: true })).resolves.toMatchObject({
      power: { keepAwake: true, supported: true, active: true },
    });
    expect(setDaemonPowerKeepAwakeMock).toHaveBeenCalledWith(true, {
      power: { keepAwake: false },
      ipc: { socketPath: join(dir, 'daemon.sock') },
    });
  });

  it('reports inspection failures and tolerates unreadable log files', async () => {
    const dir = createTempDir();
    const unreadableLogPath = join(dir, 'logs');
    mkdirSync(unreadableLogPath);

    loadDaemonConfigMock.mockReturnValue({ power: { keepAwake: false }, ipc: { socketPath: join(dir, 'daemon.sock') } });
    resolveDaemonPathsMock.mockReturnValue({ root: dir, socketPath: '/tmp/runtime.sock', logFile: unreadableLogPath });
    pingDaemonMock.mockRejectedValue(new Error('runtime failed'));

    const state = await readDaemonState();
    expect(state.warnings).toEqual(['Could not inspect daemon runtime: runtime failed']);
    expect(state.service).toMatchObject({
      platform: 'desktop',
      identifier: 'desktop-local-daemon',
      manifestPath: 'desktop menubar runtime',
      installed: true,
      running: true,
    });
    expect(state.runtime).toEqual({
      running: false,
      socketPath: '/tmp/runtime.sock',
      moduleCount: 0,
    });
  });
});
