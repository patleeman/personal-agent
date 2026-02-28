import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultDaemonConfig } from './config.js';
import { emitDaemonEventNonFatal } from './client.js';

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe('emitDaemonEventNonFatal', () => {
  it('prints actionable warning when daemon socket is missing', async () => {
    process.env = { ...originalEnv };

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const config = getDefaultDaemonConfig();
    config.ipc.socketPath = join(tmpdir(), `missing-personal-agentd-${Date.now()}.sock`);

    await emitDaemonEventNonFatal(
      {
        type: 'pi.run.completed',
        source: 'cli',
      },
      config,
    );

    expect(warn).toHaveBeenCalledTimes(1);

    const message = String(warn.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('daemon is not running');
    expect(message).toContain('pa daemon start');
  });

  it('does nothing when daemon events are disabled', async () => {
    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    };

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const config = getDefaultDaemonConfig();
    config.ipc.socketPath = join(tmpdir(), `missing-personal-agentd-${Date.now()}.sock`);

    await emitDaemonEventNonFatal(
      {
        type: 'pi.run.completed',
        source: 'cli',
      },
      config,
    );

    expect(warn).not.toHaveBeenCalled();
  });
});
