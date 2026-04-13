import { describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  registerSchemesAsPrivileged: vi.fn(),
  protocolHandle: vi.fn(),
  partitionProtocolHandle: vi.fn(),
  fromPartition: vi.fn(() => ({
    protocol: {
      handle: electronMocks.partitionProtocolHandle,
    },
  })),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(),
  },
  protocol: {
    registerSchemesAsPrivileged: electronMocks.registerSchemesAsPrivileged,
    handle: electronMocks.protocolHandle,
  },
  session: {
    fromPartition: electronMocks.fromPartition,
  },
}));

import { buildSshBootstrapCommand } from './ssh-host-controller.js';

describe('buildSshBootstrapCommand', () => {
  it('boots the remote web UI with the foreground subcommand instead of bare pa ui', () => {
    expect(buildSshBootstrapCommand({ remotePort: 4741 })).toContain('pa ui foreground --port 4741');
    expect(buildSshBootstrapCommand({ remotePort: 4741 })).not.toContain(' PA_WEB_PORT=4741 PA_WEB_DISABLE_COMPANION=1 pa ui ');
  });

  it('quotes custom repo roots safely', () => {
    expect(buildSshBootstrapCommand({
      repoRoot: '/Users/patrick/Working Dir/personal-agent',
      remotePort: 3741,
    })).toContain("cd '/Users/patrick/Working Dir/personal-agent'");
  });
});
