import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  CompanionDeviceTokenResult,
  CompanionPairedDeviceSummary,
  CompanionPairingCode,
} from './types.js';

const PAIRING_CODE_TTL_MS = 10 * 60_000;
const DEVICE_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const DEVICE_SESSION_TOUCH_INTERVAL_MS = 5 * 60_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface StoredPairingCode {
  id: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
}

interface StoredDeviceSession {
  id: string;
  deviceLabel: string;
  tokenHash: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

interface CompanionAuthStore {
  pairingCodes: StoredPairingCode[];
  devices: StoredDeviceSession[];
}

export interface CompanionDeviceAdminState {
  pendingPairings: Array<{
    id: string;
    createdAt: string;
    expiresAt: string;
  }>;
  devices: CompanionPairedDeviceSummary[];
}

function resolveNow(input?: Date): Date {
  return input instanceof Date && Number.isFinite(input.getTime()) ? input : new Date();
}

function toIso(input: Date): string {
  return input.toISOString();
}

function parseTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizePairingCodeInput(input: string): string {
  return input.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function normalizeDeviceLabel(input: string | undefined): string {
  if (typeof input !== 'string') {
    return 'Paired device';
  }

  const normalized = input.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized.slice(0, 80) : 'Paired device';
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
}

function generatePairingCode(): string {
  const characters = Array.from({ length: 12 }, () => CODE_ALPHABET[randomBytes(1)[0] % CODE_ALPHABET.length] ?? 'A');
  return `${characters.slice(0, 4).join('')}-${characters.slice(4, 8).join('')}-${characters.slice(8, 12).join('')}`;
}

function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

function toDeviceSummary(device: StoredDeviceSession): CompanionPairedDeviceSummary {
  return {
    id: device.id,
    deviceLabel: device.deviceLabel,
    createdAt: device.createdAt,
    lastUsedAt: device.lastUsedAt,
    expiresAt: device.expiresAt,
    ...(device.revokedAt ? { revokedAt: device.revokedAt } : {}),
  };
}

function normalizeStore(value: unknown, now: Date): CompanionAuthStore {
  const nowMs = now.getTime();
  const raw = value as Partial<CompanionAuthStore> | null | undefined;

  const pairingCodes = Array.isArray(raw?.pairingCodes)
    ? raw.pairingCodes.flatMap((entry): StoredPairingCode[] => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }

      const candidate = entry as Partial<StoredPairingCode>;
      if (
        typeof candidate.id !== 'string'
        || typeof candidate.codeHash !== 'string'
        || typeof candidate.createdAt !== 'string'
        || typeof candidate.expiresAt !== 'string'
      ) {
        return [];
      }

      const createdAt = parseTimestamp(candidate.createdAt);
      const expiresAt = parseTimestamp(candidate.expiresAt);
      const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
      if (!createdAt || !expiresAt || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
        return [];
      }

      return [{
        id: candidate.id,
        codeHash: candidate.codeHash,
        createdAt,
        expiresAt,
      }];
    })
    : [];

  const devices = Array.isArray(raw?.devices)
    ? raw.devices.flatMap((entry): StoredDeviceSession[] => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }

      const candidate = entry as Partial<StoredDeviceSession>;
      if (
        typeof candidate.id !== 'string'
        || typeof candidate.deviceLabel !== 'string'
        || typeof candidate.tokenHash !== 'string'
        || typeof candidate.createdAt !== 'string'
        || typeof candidate.lastUsedAt !== 'string'
        || typeof candidate.expiresAt !== 'string'
      ) {
        return [];
      }

      const createdAt = parseTimestamp(candidate.createdAt);
      const lastUsedAt = parseTimestamp(candidate.lastUsedAt);
      const expiresAt = parseTimestamp(candidate.expiresAt);
      const revokedAt = parseTimestamp(candidate.revokedAt);
      const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
      if (!createdAt || !lastUsedAt || !expiresAt || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
        return [];
      }

      return [{
        id: candidate.id,
        deviceLabel: candidate.deviceLabel,
        tokenHash: candidate.tokenHash,
        createdAt,
        lastUsedAt,
        expiresAt,
        ...(revokedAt ? { revokedAt } : {}),
      }];
    })
    : [];

  return {
    pairingCodes,
    devices,
  };
}

export function resolveCompanionAuthStateFile(stateRoot: string): string {
  return join(stateRoot, 'companion', 'auth.json');
}

function readStore(stateRoot: string, now: Date): CompanionAuthStore {
  const filePath = resolveCompanionAuthStateFile(stateRoot);
  if (!existsSync(filePath)) {
    return { pairingCodes: [], devices: [] };
  }

  try {
    return normalizeStore(JSON.parse(readFileSync(filePath, 'utf-8')) as unknown, now);
  } catch {
    return { pairingCodes: [], devices: [] };
  }
}

function writeStore(stateRoot: string, store: CompanionAuthStore): void {
  const filePath = resolveCompanionAuthStateFile(stateRoot);
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

function updateStore<T>(stateRoot: string, mutator: (store: CompanionAuthStore, now: Date) => T, nowInput?: Date): T {
  const now = resolveNow(nowInput);
  const store = readStore(stateRoot, now);
  const result = mutator(store, now);
  writeStore(stateRoot, store);
  return result;
}

export function readCompanionDeviceAdminState(stateRoot: string, options?: { now?: Date }): CompanionDeviceAdminState {
  const now = resolveNow(options?.now);
  const store = readStore(stateRoot, now);

  return {
    pendingPairings: store.pairingCodes
      .map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    devices: store.devices
      .filter((entry) => !entry.revokedAt)
      .map(toDeviceSummary)
      .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt)),
  };
}

export function createCompanionPairingCode(stateRoot: string, options?: { now?: Date }): CompanionPairingCode {
  return updateStore(stateRoot, (store, now) => {
    const createdAt = toIso(now);
    const expiresAt = toIso(new Date(now.getTime() + PAIRING_CODE_TTL_MS));
    const code = generatePairingCode();
    const id = generateId('pair');
    store.pairingCodes.unshift({
      id,
      codeHash: hashSecret(normalizePairingCodeInput(code)),
      createdAt,
      expiresAt,
    });

    return {
      id,
      code,
      createdAt,
      expiresAt,
    };
  }, options?.now);
}

export function pairCompanionDevice(
  stateRoot: string,
  codeInput: string,
  options?: { deviceLabel?: string; now?: Date },
): CompanionDeviceTokenResult {
  return updateStore(stateRoot, (store, now) => {
    const normalizedCode = normalizePairingCodeInput(codeInput);
    if (!normalizedCode) {
      throw new Error('Pairing code required.');
    }

    const codeHash = hashSecret(normalizedCode);
    const pairingIndex = store.pairingCodes.findIndex((entry) => entry.codeHash === codeHash);
    if (pairingIndex < 0) {
      throw new Error('Pairing code is invalid or expired.');
    }

    store.pairingCodes.splice(pairingIndex, 1);

    const createdAt = toIso(now);
    const expiresAt = toIso(new Date(now.getTime() + DEVICE_SESSION_TTL_MS));
    const bearerToken = generateSessionToken();
    const device: StoredDeviceSession = {
      id: generateId('device'),
      deviceLabel: normalizeDeviceLabel(options?.deviceLabel),
      tokenHash: hashSecret(bearerToken),
      createdAt,
      lastUsedAt: createdAt,
      expiresAt,
    };
    store.devices.unshift(device);

    return {
      bearerToken,
      device: toDeviceSummary(device),
    } satisfies CompanionDeviceTokenResult;
  }, options?.now);
}

export function readCompanionDeviceByToken(
  stateRoot: string,
  tokenInput: string,
  options?: { now?: Date; touch?: boolean },
): CompanionPairedDeviceSummary | null {
  const normalizedToken = tokenInput.trim();
  if (!normalizedToken) {
    return null;
  }

  return updateStore(stateRoot, (store, now) => {
    const tokenHash = hashSecret(normalizedToken);
    const device = store.devices.find((entry) => entry.tokenHash === tokenHash && !entry.revokedAt);
    if (!device) {
      return null;
    }

    if (options?.touch !== false) {
      const lastUsedAtMs = Date.parse(device.lastUsedAt);
      if (!Number.isFinite(lastUsedAtMs) || now.getTime() - lastUsedAtMs >= DEVICE_SESSION_TOUCH_INTERVAL_MS) {
        device.lastUsedAt = toIso(now);
        device.expiresAt = toIso(new Date(now.getTime() + DEVICE_SESSION_TTL_MS));
      }
    }

    return toDeviceSummary(device);
  }, options?.now);
}

export function revokeCompanionDevice(stateRoot: string, deviceId: string, options?: { now?: Date }): CompanionPairedDeviceSummary | null {
  return updateStore(stateRoot, (store, now) => {
    const device = store.devices.find((entry) => entry.id === deviceId && !entry.revokedAt);
    if (!device) {
      return null;
    }

    device.revokedAt = toIso(now);
    return toDeviceSummary(device);
  }, options?.now);
}

export function updateCompanionDeviceLabel(
  stateRoot: string,
  deviceId: string,
  deviceLabel: string,
  options?: { now?: Date },
): CompanionPairedDeviceSummary | null {
  return updateStore(stateRoot, (store, _now) => {
    const device = store.devices.find((entry) => entry.id === deviceId && !entry.revokedAt);
    if (!device) {
      return null;
    }

    device.deviceLabel = normalizeDeviceLabel(deviceLabel);
    return toDeviceSummary(device);
  }, options?.now);
}
