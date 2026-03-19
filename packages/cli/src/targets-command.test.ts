import { mkdtempSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './index.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  const stateRoot = createTempDir('pa-cli-targets-state-');
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PERSONAL_AGENT_STATE_ROOT: stateRoot,
    PI_SESSION_DIR: createTempDir('pi-session-'),
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('targets CLI command', () => {
  it('creates and lists execution targets', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const addExitCode = await runCli([
      'targets',
      'add',
      'gpu-box',
      '--label',
      'GPU Box',
      '--ssh',
      'gpu-box',
      '--default-cwd',
      '/srv/personal-agent',
      '--map',
      '/Users/patrickc.lee/personal/personal-agent=>/srv/personal-agent',
    ]);

    expect(addExitCode).toBe(0);
    expect(logs.join('\n')).toContain('Saved execution target');

    logs.length = 0;
    const listExitCode = await runCli(['targets', 'list']);

    expect(listExitCode).toBe(0);
    const output = logs.join('\n');
    expect(output).toContain('Execution targets');
    expect(output).toContain('gpu-box');
    expect(output).toContain('GPU Box');
    expect(output).toContain('/srv/personal-agent');
  });

  it('updates an execution target in place', async () => {
    const errors: string[] = [];
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    expect(await runCli(['targets', 'add', 'gpu-box', '--label', 'GPU Box', '--ssh', 'gpu-box'])).toBe(0);

    logs.length = 0;
    const exitCode = await runCli([
      'targets',
      'update',
      'gpu-box',
      '--label',
      'GPU Box 2',
      '--profile',
      'datadog',
      '--remote-pa-command',
      '/opt/bin/pa',
    ]);

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(logs.join('\n')).toContain('Updated execution target');

    const payloadLogs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      payloadLogs.push(String(message ?? ''));
    });
    expect(await runCli(['targets', 'show', 'gpu-box', '--json'])).toBe(0);
    const payload = JSON.parse(payloadLogs[0] as string) as {
      target: {
        label: string;
        profile?: string;
        remotePaCommand?: string;
      };
    };
    expect(payload.target.label).toBe('GPU Box 2');
    expect(payload.target.profile).toBe('datadog');
    expect(payload.target.remotePaCommand).toBe('/opt/bin/pa');
  });

  it('deletes execution targets', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await runCli(['targets', 'add', 'gpu-box', '--label', 'GPU Box', '--ssh', 'gpu-box'])).toBe(0);
    expect(await runCli(['targets', 'delete', 'gpu-box'])).toBe(0);

    const stateRoot = process.env.PERSONAL_AGENT_STATE_ROOT as string;
    const configFile = join(stateRoot, 'config', 'execution-targets.json');
    expect(() => readFileSync(configFile, 'utf-8')).toThrow();
  });
});
