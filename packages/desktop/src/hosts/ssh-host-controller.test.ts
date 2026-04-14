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
  it('boots the remote codex server via pa codex app-server', () => {
    expect(buildSshBootstrapCommand({ remotePort: 4741 })).toContain('pa codex app-server --listen ws://127.0.0.1:4741');
    expect(buildSshBootstrapCommand({ remotePort: 4741 })).not.toContain('pa ui foreground');
  });

  it('quotes custom repo roots safely', () => {
    expect(buildSshBootstrapCommand({
      repoRoot: '/Users/patrick/Working Dir/personal-agent',
      remotePort: 3741,
    })).toContain("cd '/Users/patrick/Working Dir/personal-agent'");
  });
});
