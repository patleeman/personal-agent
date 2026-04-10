import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getStateRoot } from '@personal-agent/core';

const PAIRING_CODE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface StoredPairingCode {
  id: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
}

export type RemoteAccessSurface = 'legacy' | 'desktop';

interface StoredSession {
  id: string;
  deviceLabel: string;
  surface: RemoteAccessSurface;
  tokenHash: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

interface RemoteAccessStore {
  pairingCodes: StoredPairingCode[];
  sessions: StoredSession[];
}

export interface RemoteAccessPairingCode {
  id: string;
  code: string;
  createdAt: string;
  expiresAt: string;
}

export interface RemoteAccessSessionSummary {
  id: string;
  deviceLabel: string;
  surface: RemoteAccessSurface;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface RemoteAccessAdminState {
  pendingPairings: Array<{
    id: string;
    createdAt: string;
    expiresAt: string;
  }>;
  sessions: RemoteAccessSessionSummary[];
}

function resolveNow(input?: Date): Date {
  return input instanceof Date ? input : new Date();
}

function toIso(input: Date): string {
  return input.toISOString();
}

function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeDeviceLabel(input: string | undefined): string {
  if (typeof input !== 'string') {
    return 'Paired device';
  }

  const normalized = input.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized.slice(0, 80) : 'Paired device';
}

function normalizePairingCodeInput(input: string): string {
  return input.replace(/[^a-z0-9]/gi, '').toUpperCase();
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

function normalizeStore(value: unknown, now: Date): RemoteAccessStore {
  const nowMs = now.getTime();
  const raw = value as Partial<RemoteAccessStore> | null | undefined;
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

      const expiresAtMs = Date.parse(candidate.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
        return [];
      }

      return [{
        id: candidate.id,
        codeHash: candidate.codeHash,
        createdAt: candidate.createdAt,
        expiresAt: candidate.expiresAt,
      }];
    })
    : [];
  const sessions = Array.isArray(raw?.sessions)
    ? raw.sessions.flatMap((entry): StoredSession[] => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }

      const candidate = entry as Partial<StoredSession>;
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

      const expiresAtMs = Date.parse(candidate.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
        return [];
      }

      return [{
        id: candidate.id,
        deviceLabel: candidate.deviceLabel,
        surface: candidate.surface === 'desktop' ? 'desktop' : 'legacy',
        tokenHash: candidate.tokenHash,
        createdAt: candidate.createdAt,
        lastUsedAt: candidate.lastUsedAt,
        expiresAt: candidate.expiresAt,
        ...(typeof candidate.revokedAt === 'string' ? { revokedAt: candidate.revokedAt } : {}),
      }];
    })
    : [];

  return {
    pairingCodes,
    sessions,
  };
}

function resolveRemoteAccessStateFile(): string {
  return join(getStateRoot(), 'web', 'remote-access-auth.json');
}

function resolveLegacyRemoteAccessStateFile(): string {
  return join(getStateRoot(), 'web', 'companion-auth.json');
}

function readStore(now: Date): RemoteAccessStore {
  const stateFile = existsSync(resolveRemoteAccessStateFile())
    ? resolveRemoteAccessStateFile()
    : resolveLegacyRemoteAccessStateFile();
  if (!existsSync(stateFile)) {
    return { pairingCodes: [], sessions: [] };
  }

  try {
    return normalizeStore(JSON.parse(readFileSync(stateFile, 'utf-8')) as unknown, now);
  } catch {
    return { pairingCodes: [], sessions: [] };
  }
}

function writeStore(store: RemoteAccessStore): void {
  const stateFile = resolveRemoteAccessStateFile();
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

function updateStore<T>(
  mutator: (store: RemoteAccessStore, now: Date) => T,
  nowInput?: Date,
): T {
  const now = resolveNow(nowInput);
  const store = readStore(now);
  const result = mutator(store, now);
  writeStore(store);
  return result;
}

function toSessionSummary(session: StoredSession): RemoteAccessSessionSummary {
  return {
    id: session.id,
    deviceLabel: session.deviceLabel,
    surface: session.surface,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
    expiresAt: session.expiresAt,
    ...(session.revokedAt ? { revokedAt: session.revokedAt } : {}),
  };
}

export function readRemoteAccessAdminState(options?: { now?: Date }): RemoteAccessAdminState {
  const now = resolveNow(options?.now);
  const store = readStore(now);

  return {
    pendingPairings: store.pairingCodes
      .map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    sessions: store.sessions
      .map(toSessionSummary)
      .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt)),
  };
}

export function createRemoteAccessPairingCode(options?: { now?: Date }): RemoteAccessPairingCode {
  return updateStore((store, now) => {
    const createdAt = toIso(now);
    const expiresAt = toIso(new Date(now.getTime() + PAIRING_CODE_TTL_MS));
    const code = generatePairingCode();
    store.pairingCodes.unshift({
      id: generateId('pair'),
      codeHash: hashSecret(normalizePairingCodeInput(code)),
      createdAt,
      expiresAt,
    });

    return {
      id: store.pairingCodes[0]!.id,
      code,
      createdAt,
      expiresAt,
    } satisfies RemoteAccessPairingCode;
  }, options?.now);
}

export function exchangeRemoteAccessPairingCode(
  codeInput: string,
  options?: { deviceLabel?: string; surface?: RemoteAccessSurface; now?: Date },
): { sessionToken: string; session: RemoteAccessSessionSummary } {
  return updateStore((store, now) => {
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
    const expiresAt = toIso(new Date(now.getTime() + SESSION_TTL_MS));
    const sessionToken = generateSessionToken();
    const session: StoredSession = {
      id: generateId('session'),
      deviceLabel: normalizeDeviceLabel(options?.deviceLabel),
      surface: options?.surface === 'legacy' ? 'legacy' : 'desktop',
      tokenHash: hashSecret(sessionToken),
      createdAt,
      lastUsedAt: createdAt,
      expiresAt,
    };
    store.sessions.unshift(session);

    return {
      sessionToken,
      session: toSessionSummary(session),
    };
  }, options?.now);
}

export function readRemoteAccessSession(
  tokenInput: string,
  options?: { now?: Date; touch?: boolean; surface?: RemoteAccessSurface },
): RemoteAccessSessionSummary | null {
  const normalizedToken = tokenInput.trim();
  if (!normalizedToken) {
    return null;
  }

  return updateStore((store, now) => {
    const tokenHash = hashSecret(normalizedToken);
    const session = store.sessions.find((entry) => entry.tokenHash === tokenHash && !entry.revokedAt && (!options?.surface || entry.surface === options.surface));
    if (!session) {
      return null;
    }

    if (options?.touch !== false) {
      const lastUsedAtMs = Date.parse(session.lastUsedAt);
      if (!Number.isFinite(lastUsedAtMs) || now.getTime() - lastUsedAtMs >= SESSION_TOUCH_INTERVAL_MS) {
        session.lastUsedAt = toIso(now);
        session.expiresAt = toIso(new Date(now.getTime() + SESSION_TTL_MS));
      }
    }

    return toSessionSummary(session);
  }, options?.now);
}

export function revokeRemoteAccessSession(sessionId: string, options?: { now?: Date }): RemoteAccessSessionSummary | null {
  return updateStore((store, now) => {
    const session = store.sessions.find((entry) => entry.id === sessionId && !entry.revokedAt);
    if (!session) {
      return null;
    }

    session.revokedAt = toIso(now);
    return toSessionSummary(session);
  }, options?.now);
}

export function revokeRemoteAccessSessionByToken(tokenInput: string, options?: { now?: Date }): RemoteAccessSessionSummary | null {
  const normalizedToken = tokenInput.trim();
  if (!normalizedToken) {
    return null;
  }

  return updateStore((store, now) => {
    const tokenHash = hashSecret(normalizedToken);
    const session = store.sessions.find((entry) => entry.tokenHash === tokenHash && !entry.revokedAt);
    if (!session) {
      return null;
    }

    session.revokedAt = toIso(now);
    return toSessionSummary(session);
  }, options?.now);
}
