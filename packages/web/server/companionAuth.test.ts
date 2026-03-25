import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCompanionPairingCode,
  exchangeCompanionPairingCode,
  readCompanionAuthAdminState,
  readCompanionSession,
  revokeCompanionSession,
  revokeCompanionSessionByToken,
} from './companionAuth.js';

const tempDirs: string[] = [];
const originalEnv = process.env;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('companion auth', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('creates pairing codes and exchanges them for sessions', () => {
    const stateRoot = createTempDir('pa-companion-auth-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const created = createCompanionPairingCode({ now: new Date('2026-03-25T12:00:00.000Z') });
    expect(created.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const exchanged = exchangeCompanionPairingCode(created.code, {
      deviceLabel: 'Patrick iPhone',
      now: new Date('2026-03-25T12:01:00.000Z'),
    });

    expect(exchanged.session.deviceLabel).toBe('Patrick iPhone');
    expect(exchanged.session.surface).toBe('companion');
    expect(readCompanionSession(exchanged.sessionToken, { now: new Date('2026-03-25T12:02:00.000Z'), surface: 'companion' }))
      .toEqual(expect.objectContaining({ id: exchanged.session.id, deviceLabel: 'Patrick iPhone', surface: 'companion' }));

    const adminState = readCompanionAuthAdminState({ now: new Date('2026-03-25T12:02:00.000Z') });
    expect(adminState.pendingPairings).toHaveLength(0);
    expect(adminState.sessions).toEqual([
      expect.objectContaining({ id: exchanged.session.id, deviceLabel: 'Patrick iPhone', surface: 'companion' }),
    ]);
  });

  it('rejects expired pairing codes', () => {
    const stateRoot = createTempDir('pa-companion-auth-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const created = createCompanionPairingCode({ now: new Date('2026-03-25T12:00:00.000Z') });

    expect(() => exchangeCompanionPairingCode(created.code, {
      now: new Date('2026-03-25T12:20:00.000Z'),
    })).toThrow('Pairing code is invalid or expired.');
  });

  it('supports surface-specific desktop sessions without reusing the code after exchange', () => {
    const stateRoot = createTempDir('pa-companion-auth-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const created = createCompanionPairingCode({ now: new Date('2026-03-25T12:00:00.000Z') });
    const exchanged = exchangeCompanionPairingCode(created.code, {
      deviceLabel: 'Office desktop',
      surface: 'desktop',
      now: new Date('2026-03-25T12:01:00.000Z'),
    });

    expect(exchanged.session.surface).toBe('desktop');
    expect(readCompanionSession(exchanged.sessionToken, { now: new Date('2026-03-25T12:02:00.000Z'), surface: 'desktop' }))
      .toEqual(expect.objectContaining({ id: exchanged.session.id, surface: 'desktop' }));
    expect(readCompanionSession(exchanged.sessionToken, { now: new Date('2026-03-25T12:02:00.000Z'), surface: 'companion' })).toBeNull();
  });

  it('revokes sessions by id and by token', () => {
    const stateRoot = createTempDir('pa-companion-auth-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const first = exchangeCompanionPairingCode(
      createCompanionPairingCode({ now: new Date('2026-03-25T12:00:00.000Z') }).code,
      { now: new Date('2026-03-25T12:01:00.000Z') },
    );
    const second = exchangeCompanionPairingCode(
      createCompanionPairingCode({ now: new Date('2026-03-25T12:02:00.000Z') }).code,
      { now: new Date('2026-03-25T12:03:00.000Z') },
    );

    expect(revokeCompanionSession(first.session.id, { now: new Date('2026-03-25T12:04:00.000Z') }))
      .toEqual(expect.objectContaining({ id: first.session.id }));
    expect(readCompanionSession(first.sessionToken, { now: new Date('2026-03-25T12:05:00.000Z') })).toBeNull();

    expect(revokeCompanionSessionByToken(second.sessionToken, { now: new Date('2026-03-25T12:06:00.000Z') }))
      .toEqual(expect.objectContaining({ id: second.session.id }));
    expect(readCompanionSession(second.sessionToken, { now: new Date('2026-03-25T12:07:00.000Z') })).toBeNull();
  });
});
