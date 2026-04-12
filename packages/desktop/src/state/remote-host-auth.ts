import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';

export interface DesktopRemoteHostAuthState {
  hostId: string;
  hasBearerToken: boolean;
  sessionId?: string;
  deviceLabel?: string;
  createdAt?: string;
  expiresAt?: string;
}

interface StoredRemoteHostAuthEntry {
  encryptedToken?: string;
  plainToken?: string;
  sessionId?: string;
  deviceLabel?: string;
  createdAt?: string;
  expiresAt?: string;
}

interface StoredRemoteHostAuthFile {
  version: 1;
  hosts: Record<string, StoredRemoteHostAuthEntry>;
}

function resolveRemoteHostAuthFile(): string {
  return join(resolveDesktopRuntimePaths().desktopStateDir, 'remote-host-auth.json');
}

function normalizeAuthFile(value: unknown): StoredRemoteHostAuthFile {
  if (!value || typeof value !== 'object') {
    return { version: 1, hosts: {} };
  }

  const input = value as Partial<StoredRemoteHostAuthFile>;
  const rawHosts = input.hosts && typeof input.hosts === 'object' ? input.hosts : {};
  const hosts = Object.fromEntries(Object.entries(rawHosts).flatMap(([hostId, entry]) => {
    if (!hostId.trim() || !entry || typeof entry !== 'object') {
      return [];
    }

    const candidate = entry as StoredRemoteHostAuthEntry;
    const normalized: StoredRemoteHostAuthEntry = {
      ...(typeof candidate.encryptedToken === 'string' && candidate.encryptedToken.trim().length > 0
        ? { encryptedToken: candidate.encryptedToken.trim() }
        : {}),
      ...(typeof candidate.plainToken === 'string' && candidate.plainToken.trim().length > 0
        ? { plainToken: candidate.plainToken.trim() }
        : {}),
      ...(typeof candidate.sessionId === 'string' && candidate.sessionId.trim().length > 0
        ? { sessionId: candidate.sessionId.trim() }
        : {}),
      ...(typeof candidate.deviceLabel === 'string' && candidate.deviceLabel.trim().length > 0
        ? { deviceLabel: candidate.deviceLabel.trim() }
        : {}),
      ...(typeof candidate.createdAt === 'string' && candidate.createdAt.trim().length > 0
        ? { createdAt: candidate.createdAt.trim() }
        : {}),
      ...(typeof candidate.expiresAt === 'string' && candidate.expiresAt.trim().length > 0
        ? { expiresAt: candidate.expiresAt.trim() }
        : {}),
    };

    if (!normalized.encryptedToken && !normalized.plainToken) {
      return [];
    }

    return [[hostId.trim(), normalized]];
  }));

  return {
    version: 1,
    hosts,
  };
}

function readAuthFile(): StoredRemoteHostAuthFile {
  const authFile = resolveRemoteHostAuthFile();
  if (!existsSync(authFile)) {
    return { version: 1, hosts: {} };
  }

  try {
    return normalizeAuthFile(JSON.parse(readFileSync(authFile, 'utf-8')) as unknown);
  } catch {
    return { version: 1, hosts: {} };
  }
}

function writeAuthFile(value: StoredRemoteHostAuthFile): void {
  const authFile = resolveRemoteHostAuthFile();
  mkdirSync(resolveDesktopRuntimePaths().desktopStateDir, { recursive: true, mode: 0o700 });
  writeFileSync(authFile, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function updateAuthFile<T>(mutate: (current: StoredRemoteHostAuthFile) => T): T {
  const current = readAuthFile();
  const result = mutate(current);
  writeAuthFile(current);
  return result;
}

function encodeToken(token: string): Pick<StoredRemoteHostAuthEntry, 'encryptedToken' | 'plainToken'> {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      encryptedToken: safeStorage.encryptString(token).toString('base64'),
    };
  }

  return {
    plainToken: token,
  };
}

function decodeToken(entry: StoredRemoteHostAuthEntry | undefined): string {
  if (!entry) {
    return '';
  }

  if (typeof entry.encryptedToken === 'string' && entry.encryptedToken.trim().length > 0) {
    if (!safeStorage.isEncryptionAvailable()) {
      return '';
    }

    try {
      return safeStorage.decryptString(Buffer.from(entry.encryptedToken, 'base64'));
    } catch {
      return '';
    }
  }

  return typeof entry.plainToken === 'string' ? entry.plainToken : '';
}

export function readDesktopRemoteHostBearerToken(hostId: string): string {
  const normalizedHostId = hostId.trim();
  if (!normalizedHostId) {
    return '';
  }

  return decodeToken(readAuthFile().hosts[normalizedHostId]);
}

export function readDesktopRemoteHostAuthState(hostId: string): DesktopRemoteHostAuthState {
  const normalizedHostId = hostId.trim();
  if (!normalizedHostId) {
    return { hostId: '', hasBearerToken: false };
  }

  const entry = readAuthFile().hosts[normalizedHostId];
  const bearerToken = decodeToken(entry);
  return {
    hostId: normalizedHostId,
    hasBearerToken: bearerToken.trim().length > 0,
    ...(typeof entry?.sessionId === 'string' ? { sessionId: entry.sessionId } : {}),
    ...(typeof entry?.deviceLabel === 'string' ? { deviceLabel: entry.deviceLabel } : {}),
    ...(typeof entry?.createdAt === 'string' ? { createdAt: entry.createdAt } : {}),
    ...(typeof entry?.expiresAt === 'string' ? { expiresAt: entry.expiresAt } : {}),
  };
}

export function writeDesktopRemoteHostAuth(input: {
  hostId: string;
  bearerToken: string;
  session?: {
    id?: string;
    deviceLabel?: string;
    createdAt?: string;
    expiresAt?: string;
  };
}): DesktopRemoteHostAuthState {
  const normalizedHostId = input.hostId.trim();
  const normalizedToken = input.bearerToken.trim();
  if (!normalizedHostId || !normalizedToken) {
    throw new Error('Host id and bearer token are required.');
  }

  return updateAuthFile((current) => {
    const nextEntry: StoredRemoteHostAuthEntry = {
      ...encodeToken(normalizedToken),
      ...(typeof input.session?.id === 'string' && input.session.id.trim().length > 0
        ? { sessionId: input.session.id.trim() }
        : {}),
      ...(typeof input.session?.deviceLabel === 'string' && input.session.deviceLabel.trim().length > 0
        ? { deviceLabel: input.session.deviceLabel.trim() }
        : {}),
      ...(typeof input.session?.createdAt === 'string' && input.session.createdAt.trim().length > 0
        ? { createdAt: input.session.createdAt.trim() }
        : {}),
      ...(typeof input.session?.expiresAt === 'string' && input.session.expiresAt.trim().length > 0
        ? { expiresAt: input.session.expiresAt.trim() }
        : {}),
    };
    current.hosts[normalizedHostId] = nextEntry;
    return {
      hostId: normalizedHostId,
      hasBearerToken: true,
      ...(typeof nextEntry.sessionId === 'string' ? { sessionId: nextEntry.sessionId } : {}),
      ...(typeof nextEntry.deviceLabel === 'string' ? { deviceLabel: nextEntry.deviceLabel } : {}),
      ...(typeof nextEntry.createdAt === 'string' ? { createdAt: nextEntry.createdAt } : {}),
      ...(typeof nextEntry.expiresAt === 'string' ? { expiresAt: nextEntry.expiresAt } : {}),
    } satisfies DesktopRemoteHostAuthState;
  });
}

export function clearDesktopRemoteHostAuth(hostId: string): DesktopRemoteHostAuthState {
  const normalizedHostId = hostId.trim();
  if (!normalizedHostId) {
    return { hostId: '', hasBearerToken: false };
  }

  return updateAuthFile((current) => {
    delete current.hosts[normalizedHostId];
    return {
      hostId: normalizedHostId,
      hasBearerToken: false,
    } satisfies DesktopRemoteHostAuthState;
  });
}
