import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRemoteAccessPairingCode,
  exchangeRemoteAccessPairingCode,
  readRemoteAccessAdminState,
  readRemoteAccessSession,
  revokeRemoteAccessSession,
  revokeRemoteAccessSessionByToken,
} from './remoteAccessAuth.js';

const tempDirs: string[] = [];
const originalEnv = process.env;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('remote access auth', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('creates pairing codes and exchanges them for sessions', () => {
    const stateRoot = createTempDir('pa-remote-access-auth-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const created = createRemoteAccessPairingCode({ now: new Date('2026-03-25T12:00:00.000Z') });
    expect(created.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const exchanged = exchangeRemoteAccessPairingCode(created.code, {
      deviceLabel: 'Patrick iPhone',
      now: new Date('2026-03-25T12:01:00.000Z'),
    });

    expect(exchanged.session.deviceLabel).toBe('Patrick iPhone');
    expect(readRemoteAccessSession(exchanged.sessionToken, { now: new Date('2026-03-25T12:02:00.000Z') }))
      .toEqual(expect.objectContaining({ id: exchanged.session.id, deviceLabel: 'Patrick iPhone' }));

    const adminState = readRemoteAccessAdminState({ now: new Date('2026-03-25T12:02:00.000Z') });
    expect(adminState.pendingPairings).toHaveLength(0);
    expect(adminState.sessions).toEqual([
      expect.objectContaining({ id: exchanged.session.id, deviceLabel: 'Patrick iPhone' }),
    ]);
  });

  it('rejects expired pairing codes', () => {
    const stateRoot = createTempDir('pa-remote-access-auth-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const created = createRemoteAccessPairingCode({ now: new Date('2026-03-25T12:00:00.000Z') });

    expect(() => exchangeRemoteAccessPairingCode(created.code, {
      now: new Date('2026-03-25T12:20:00.000Z'),
    })).toThrow('Pairing code is invalid or expired.');
  });

  it('exchanges pairing codes only once', () => {
    const stateRoot = createTempDir('pa-remote-access-auth-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const created = createRemoteAccessPairingCode({ now: new Date('2026-03-25T12:00:00.000Z') });
    const exchanged = exchangeRemoteAccessPairingCode(created.code, {
      deviceLabel: 'Office desktop',
      now: new Date('2026-03-25T12:01:00.000Z'),
    });

    expect(readRemoteAccessSession(exchanged.sessionToken, { now: new Date('2026-03-25T12:02:00.000Z') }))
      .toEqual(expect.objectContaining({ id: exchanged.session.id, deviceLabel: 'Office desktop' }));
    expect(() => exchangeRemoteAccessPairingCode(created.code, {
      now: new Date('2026-03-25T12:02:00.000Z'),
    })).toThrow('Pairing code is invalid or expired.');
  });

  it('extends active session expiry when the paired device is used again', () => {
    const stateRoot = createTempDir('pa-remote-access-auth-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const exchanged = exchangeRemoteAccessPairingCode(
      createRemoteAccessPairingCode({ now: new Date('2026-03-25T12:00:00.000Z') }).code,
      {
        deviceLabel: 'Patrick iPhone',
        now: new Date('2026-03-25T12:01:00.000Z'),
      },
    );

    const refreshed = readRemoteAccessSession(exchanged.sessionToken, {
      now: new Date('2026-04-23T12:10:00.000Z'),
    });
    expect(refreshed).toEqual(expect.objectContaining({
      id: exchanged.session.id,
      lastUsedAt: '2026-04-23T12:10:00.000Z',
      expiresAt: '2026-05-23T12:10:00.000Z',
    }));

    expect(readRemoteAccessSession(exchanged.sessionToken, {
      now: new Date('2026-04-24T12:02:00.000Z'),
    })).toEqual(expect.objectContaining({ id: exchanged.session.id }));
  });

  it('revokes sessions by id and by token', () => {
    const stateRoot = createTempDir('pa-remote-access-auth-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const first = exchangeRemoteAccessPairingCode(
      createRemoteAccessPairingCode({ now: new Date('2026-03-25T12:00:00.000Z') }).code,
      { now: new Date('2026-03-25T12:01:00.000Z') },
    );
    const second = exchangeRemoteAccessPairingCode(
      createRemoteAccessPairingCode({ now: new Date('2026-03-25T12:02:00.000Z') }).code,
      { now: new Date('2026-03-25T12:03:00.000Z') },
    );

    expect(revokeRemoteAccessSession(first.session.id, { now: new Date('2026-03-25T12:04:00.000Z') }))
      .toEqual(expect.objectContaining({ id: first.session.id }));
    expect(readRemoteAccessSession(first.sessionToken, { now: new Date('2026-03-25T12:05:00.000Z') })).toBeNull();

    expect(revokeRemoteAccessSessionByToken(second.sessionToken, { now: new Date('2026-03-25T12:06:00.000Z') }))
      .toEqual(expect.objectContaining({ id: second.session.id }));
    expect(readRemoteAccessSession(second.sessionToken, { now: new Date('2026-03-25T12:07:00.000Z') })).toBeNull();
  });
});
