import { describe, expect, it } from 'vitest';
import type { DaemonConfig } from '../config.js';
import { buildCompanionSetupState } from './setup-links.js';

function createTestConfig(host: string, port = 3843): DaemonConfig {
  return {
    logLevel: 'debug',
    queue: { maxDepth: 10 },
    ipc: { socketPath: '/tmp/personal-agentd.sock' },
    companion: { enabled: true, host, port },
    modules: {
      maintenance: { enabled: false, cleanupIntervalMinutes: 60 },
      tasks: {
        enabled: false,
        taskDir: '/tmp/tasks',
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
    },
  };
}

const pairing = {
  id: 'pair-1',
  code: 'ABCD-EFGH-IJKL',
  createdAt: '2026-04-18T00:00:00.000Z',
  expiresAt: '2026-04-18T00:10:00.000Z',
};

describe('buildCompanionSetupState', () => {
  it('warns when the companion host is loopback-only', () => {
    const state = buildCompanionSetupState({
      config: createTestConfig('127.0.0.1'),
      pairing,
      hostLabel: 'Patrick Mac',
      hostInstanceId: 'host-1',
    });

    expect(state.links).toEqual([]);
    expect(state.warnings[0]).toContain('loopback only');
  });

  it('enumerates the tailnet url before non-loopback IPv4 addresses when the companion host is wildcard', () => {
    const state = buildCompanionSetupState({
      config: createTestConfig('0.0.0.0', 3845),
      pairing,
      hostLabel: 'Patrick Mac',
      hostInstanceId: 'host-1',
      resolveTailnetUrl: () => 'https://my-host.tailnet.ts.net',
      readNetworkInterfaces: () => ({
        lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0', mac: '00:00:00:00:00:00', cidr: '127.0.0.1/8' }],
        en0: [{ address: '192.168.1.25', family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '01:02:03:04:05:06', cidr: '192.168.1.25/24' }],
        utun4: [{ address: '100.88.90.12', family: 'IPv4', internal: false, netmask: '255.255.255.255', mac: '00:00:00:00:00:00', cidr: '100.88.90.12/32' }],
      }),
    });

    expect(state.warnings).toEqual([]);
    expect(state.links.map((entry) => entry.baseUrl)).toEqual([
      'https://my-host.tailnet.ts.net',
      'http://192.168.1.25:3845',
      'http://100.88.90.12:3845',
    ]);
    expect(state.links[0]?.label).toContain('Tailnet');
    expect(state.links[0]?.setupUrl).toContain('pa-companion://pair?');
    expect(state.links[0]?.setupUrl).toContain('code=ABCD-EFGH-IJKL');
  });

  it('suppresses the loopback-only warning when a tailnet url is available', () => {
    const state = buildCompanionSetupState({
      config: createTestConfig('127.0.0.1'),
      pairing,
      hostLabel: 'Patrick Mac',
      hostInstanceId: 'host-1',
      resolveTailnetUrl: () => 'https://my-host.tailnet.ts.net',
    });

    expect(state.warnings).toEqual([]);
    expect(state.links.map((entry) => entry.baseUrl)).toEqual(['https://my-host.tailnet.ts.net']);
  });

  it('uses the configured host directly when it is already reachable', () => {
    const state = buildCompanionSetupState({
      config: createTestConfig('mini.home', 4444),
      pairing,
      hostLabel: 'Patrick Mini',
      hostInstanceId: 'host-2',
    });

    expect(state.warnings).toEqual([]);
    expect(state.links).toEqual([
      {
        id: '1',
        label: 'Configured host',
        baseUrl: 'http://mini.home:4444',
        setupUrl: expect.stringContaining('base=http%3A%2F%2Fmini.home%3A4444'),
      },
    ]);
  });
});
