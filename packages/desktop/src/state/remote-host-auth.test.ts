import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const mocks = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`, 'utf-8')),
  decryptString: vi.fn((value: Buffer) => value.toString('utf-8').replace(/^enc:/, '')),
  resolveDesktopRuntimePaths: vi.fn(),
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: mocks.isEncryptionAvailable,
    encryptString: mocks.encryptString,
    decryptString: mocks.decryptString,
  },
}));

vi.mock('../desktop-env.js', () => ({
  resolveDesktopRuntimePaths: mocks.resolveDesktopRuntimePaths,
}));

import {
  clearDesktopRemoteHostAuth,
  readDesktopRemoteHostAuthState,
  readDesktopRemoteHostBearerToken,
  writeDesktopRemoteHostAuth,
} from './remote-host-auth.js';

describe('remote host auth storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEncryptionAvailable.mockReturnValue(true);
    mocks.encryptString.mockImplementation((value: string) => Buffer.from(`enc:${value}`, 'utf-8'));
    mocks.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8').replace(/^enc:/, ''));
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('stores and reads encrypted bearer tokens', () => {
    const desktopStateDir = createTempDir('pa-desktop-auth-');
    mocks.resolveDesktopRuntimePaths.mockReturnValue({ desktopStateDir });

    const written = writeDesktopRemoteHostAuth({
      hostId: 'tailnet',
      bearerToken: 'secret-token',
      session: {
        id: 'session-1',
        deviceLabel: 'Patrick desktop',
        createdAt: '2026-03-25T12:00:00.000Z',
        expiresAt: '2026-04-24T12:00:00.000Z',
      },
    });

    expect(written).toEqual({
      hostId: 'tailnet',
      hasBearerToken: true,
      sessionId: 'session-1',
      deviceLabel: 'Patrick desktop',
      createdAt: '2026-03-25T12:00:00.000Z',
      expiresAt: '2026-04-24T12:00:00.000Z',
    });
    expect(readDesktopRemoteHostBearerToken('tailnet')).toBe('secret-token');
    expect(readDesktopRemoteHostAuthState('tailnet')).toEqual(written);
  });

  it('falls back to plaintext tokens when encryption is unavailable', () => {
    const desktopStateDir = createTempDir('pa-desktop-auth-');
    mocks.resolveDesktopRuntimePaths.mockReturnValue({ desktopStateDir });
    mocks.isEncryptionAvailable.mockReturnValue(false);

    writeDesktopRemoteHostAuth({
      hostId: 'tailnet',
      bearerToken: 'plain-token',
    });

    expect(readDesktopRemoteHostBearerToken('tailnet')).toBe('plain-token');
    expect(readDesktopRemoteHostAuthState('tailnet')).toEqual({
      hostId: 'tailnet',
      hasBearerToken: true,
    });
  });

  it('clears stored host auth', () => {
    const desktopStateDir = createTempDir('pa-desktop-auth-');
    mocks.resolveDesktopRuntimePaths.mockReturnValue({ desktopStateDir });

    writeDesktopRemoteHostAuth({ hostId: 'tailnet', bearerToken: 'secret-token' });
    expect(clearDesktopRemoteHostAuth('tailnet')).toEqual({ hostId: 'tailnet', hasBearerToken: false });
    expect(readDesktopRemoteHostBearerToken('tailnet')).toBe('');
  });
});
