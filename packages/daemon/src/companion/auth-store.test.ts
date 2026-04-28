import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCompanionPairingCode,
  pairCompanionDevice,
  readCompanionDeviceAdminState,
  readCompanionDeviceByToken,
  revokeCompanionDevice,
  resolveCompanionAuthStateFile,
  updateCompanionDeviceLabel,
} from './auth-store.js';

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('companion auth store', () => {
  it('creates pairing codes and exchanges them for paired devices', () => {
    const stateRoot = createTempDir('pa-companion-auth-');

    const pairing = createCompanionPairingCode(stateRoot, {
      now: new Date('2026-04-18T10:00:00.000Z'),
    });

    expect(pairing.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const paired = pairCompanionDevice(stateRoot, pairing.code, {
      deviceLabel: 'Patrick iPhone',
      now: new Date('2026-04-18T10:01:00.000Z'),
    });

    expect(paired.bearerToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(readCompanionDeviceByToken(stateRoot, paired.bearerToken, {
      now: new Date('2026-04-18T10:02:00.000Z'),
    })).toEqual(expect.objectContaining({
      id: paired.device.id,
      deviceLabel: 'Patrick iPhone',
    }));
  });

  it('lists, renames, and revokes paired devices', () => {
    const stateRoot = createTempDir('pa-companion-auth-');
    const pairing = createCompanionPairingCode(stateRoot);
    const paired = pairCompanionDevice(stateRoot, pairing.code, { deviceLabel: 'Old label' });

    expect(readCompanionDeviceAdminState(stateRoot).devices).toHaveLength(1);

    const renamed = updateCompanionDeviceLabel(stateRoot, paired.device.id, 'New label');
    expect(renamed?.deviceLabel).toBe('New label');

    const revoked = revokeCompanionDevice(stateRoot, paired.device.id, {
      now: new Date('2026-04-18T10:30:00.000Z'),
    });
    expect(revoked?.revokedAt).toBe('2026-04-18T10:30:00.000Z');
    expect(readCompanionDeviceAdminState(stateRoot).devices).toEqual([]);
    expect(readCompanionDeviceByToken(stateRoot, paired.bearerToken, {
      now: new Date('2026-04-18T10:31:00.000Z'),
    })).toBeNull();
  });

  it('falls back to the current clock for invalid Date inputs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T10:00:00.000Z'));
    const stateRoot = createTempDir('pa-companion-auth-');

    const pairing = createCompanionPairingCode(stateRoot, {
      now: new Date(Number.NaN),
    });

    expect(pairing.createdAt).toBe('2026-04-18T10:00:00.000Z');
    expect(pairing.expiresAt).toBe('2026-04-18T10:10:00.000Z');
  });

  it('drops persisted auth entries with malformed lifecycle timestamps', () => {
    const stateRoot = createTempDir('pa-companion-auth-');
    const authFile = resolveCompanionAuthStateFile(stateRoot);
    mkdirSync(join(stateRoot, 'companion'), { recursive: true });
    writeFileSync(authFile, JSON.stringify({
      pairingCodes: [{
        id: 'pair-1',
        codeHash: 'hash',
        createdAt: 'not-a-date',
        expiresAt: '2026-04-18T10:10:00.000Z',
      }],
      devices: [{
        id: 'device-1',
        deviceLabel: 'Phone',
        tokenHash: 'hash',
        createdAt: 'bad-created',
        lastUsedAt: 'bad-last-used',
        expiresAt: '2026-05-18T10:10:00.000Z',
      }],
    }), 'utf-8');

    expect(readCompanionDeviceAdminState(stateRoot, {
      now: new Date('2026-04-18T10:00:00.000Z'),
    })).toEqual({ pendingPairings: [], devices: [] });
  });

  it('drops persisted auth entries with non-ISO lifecycle timestamps', () => {
    const stateRoot = createTempDir('pa-companion-auth-');
    const authFile = resolveCompanionAuthStateFile(stateRoot);
    mkdirSync(join(stateRoot, 'companion'), { recursive: true });
    writeFileSync(authFile, JSON.stringify({
      pairingCodes: [{
        id: 'pair-1',
        codeHash: 'hash',
        createdAt: '1',
        expiresAt: '2026-04-18T10:10:00.000Z',
      }],
      devices: [{
        id: 'device-1',
        deviceLabel: 'Phone',
        tokenHash: 'hash',
        createdAt: '2026-04-18T10:00:00.000Z',
        lastUsedAt: '1',
        expiresAt: '2026-05-18T10:10:00.000Z',
      }],
    }), 'utf-8');

    expect(readCompanionDeviceAdminState(stateRoot, {
      now: new Date('2026-04-18T10:00:00.000Z'),
    })).toEqual({ pendingPairings: [], devices: [] });
  });
});
