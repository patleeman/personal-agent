import { relative } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeStatePaths } from './paths.js';

const statePaths: RuntimeStatePaths = {
  root: '/tmp/personal-agent-state',
  auth: '/tmp/personal-agent-state/auth',
  session: '/tmp/personal-agent-state/session',
  cache: '/tmp/personal-agent-state/cache',
};

const runtimeSessionsPath = '/tmp/personal-agent-state/pi-agent-runtime/sessions';
const durableSessionsPath = '/tmp/personal-agent-state/sync/pi-agent/sessions';
const relativeDurableSessionsPath = relative('/tmp/personal-agent-state/pi-agent-runtime', durableSessionsPath);

async function importWithMocks(options: {
  lstatSync: (path: string) => unknown;
  readlinkSync?: (path: string) => string;
  symlinkSync: (target: string, path: string, type: string) => void;
  rmSync?: (path: string, options: { recursive: boolean; force: boolean }) => void;
  unlinkSync?: (path: string) => void;
}) {
  vi.resetModules();

  const mkdirMock = vi.fn().mockResolvedValue(undefined);
  const statMock = vi.fn().mockResolvedValue(undefined);
  const lstatSyncMock = vi.fn(options.lstatSync as never);
  const readlinkSyncMock = vi.fn(options.readlinkSync ?? (() => relativeDurableSessionsPath));
  const rmSyncMock = vi.fn(options.rmSync ?? (() => undefined));
  const symlinkSyncMock = vi.fn(options.symlinkSync as never);
  const unlinkSyncMock = vi.fn(options.unlinkSync ?? (() => undefined));

  vi.doMock('fs/promises', async () => {
    const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    return {
      ...actual,
      mkdir: mkdirMock,
      stat: statMock,
    };
  });

  vi.doMock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
      ...actual,
      lstatSync: lstatSyncMock,
      readlinkSync: readlinkSyncMock,
      rmSync: rmSyncMock,
      symlinkSync: symlinkSyncMock,
      unlinkSync: unlinkSyncMock,
    };
  });

  const module = await import('./agent-dir.js');
  return {
    preparePiAgentDir: module.preparePiAgentDir,
    mocks: {
      mkdirMock,
      statMock,
      lstatSyncMock,
      readlinkSyncMock,
      rmSyncMock,
      symlinkSyncMock,
      unlinkSyncMock,
    },
  };
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('fs');
  vi.doUnmock('fs/promises');
});

describe('preparePiAgentDir race recovery', () => {
  it('accepts an EEXIST race when another process created the correct symlink first', async () => {
    let linkChecks = 0;
    const { preparePiAgentDir, mocks } = await importWithMocks({
      lstatSync: (path) => {
        if (path !== runtimeSessionsPath) {
          throw new Error('missing');
        }

        linkChecks += 1;
        if (linkChecks === 1) {
          throw new Error('missing');
        }

        return {
          isSymbolicLink: () => true,
        };
      },
      symlinkSync: () => {
        const error = new Error('already exists') as NodeJS.ErrnoException;
        error.code = 'EEXIST';
        throw error;
      },
    });

    await preparePiAgentDir({ statePaths });

    expect(mocks.symlinkSyncMock).toHaveBeenCalledWith(relativeDurableSessionsPath, runtimeSessionsPath, 'dir');
    expect(mocks.readlinkSyncMock).toHaveBeenCalledWith(runtimeSessionsPath);
    expect(mocks.unlinkSyncMock).not.toHaveBeenCalled();
    expect(mocks.rmSyncMock).not.toHaveBeenCalled();
  });

  it('replaces a raced non-symlink entry after an EEXIST error', async () => {
    let linkChecks = 0;
    const { preparePiAgentDir, mocks } = await importWithMocks({
      lstatSync: (path) => {
        if (path !== runtimeSessionsPath) {
          throw new Error('missing');
        }

        linkChecks += 1;
        if (linkChecks === 1) {
          throw new Error('missing');
        }

        return {
          isSymbolicLink: () => false,
        };
      },
      symlinkSync: (() => {
        let attempts = 0;
        return () => {
          attempts += 1;
          if (attempts === 1) {
            const error = new Error('already exists') as NodeJS.ErrnoException;
            error.code = 'EEXIST';
            throw error;
          }
        };
      })(),
    });

    await preparePiAgentDir({ statePaths });

    expect(mocks.rmSyncMock).toHaveBeenCalledWith(runtimeSessionsPath, { recursive: true, force: true });
    expect(mocks.symlinkSyncMock).toHaveBeenCalledTimes(2);
    expect(mocks.symlinkSyncMock).toHaveBeenLastCalledWith(relativeDurableSessionsPath, runtimeSessionsPath, 'dir');
  });
});
