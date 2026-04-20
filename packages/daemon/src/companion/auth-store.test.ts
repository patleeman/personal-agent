import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createCompanionPairingCode,
  pairCompanionDevice,
  readCompanionDeviceAdminState,
  readCompanionDeviceByToken,
  revokeCompanionDevice,
  updateCompanionDeviceLabel,
} from './auth-store.js';

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

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
});
