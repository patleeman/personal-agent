import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { getStateRoot } from '@personal-agent/core';

import { listExtensionSecretRegistrations } from '../extensions/extensionRegistry.js';

export type SecretBackendId = 'keychain' | 'file' | 'env-only';
export type SecretSource = 'env' | SecretBackendId;

export interface SecretStatus {
  extensionId: string;
  secretId: string;
  key: string;
  label: string;
  description?: string;
  env?: string;
  configured: boolean;
  source: SecretSource | null;
  writable: boolean;
}

export interface SecretBackend {
  id: SecretBackendId;
  writable: boolean;
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

const KEYCHAIN_SERVICE = 'personal-agent';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readSettingsObject(stateRoot: string): Record<string, unknown> {
  const settingsFile = join(stateRoot, 'settings.json');
  if (!existsSync(settingsFile)) return {};
  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8')) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function readSecretBackendId(stateRoot: string = getStateRoot()): SecretBackendId {
  const settings = readSettingsObject(stateRoot);
  const nested = isRecord(settings.secrets) ? settings.secrets.provider : undefined;
  const flat = settings['secrets.provider'];
  const value = typeof nested === 'string' ? nested : typeof flat === 'string' ? flat : undefined;
  if (value === 'keychain' || value === 'file' || value === 'env-only') return value;
  return process.platform === 'darwin' ? 'keychain' : 'file';
}

export function makeSecretKey(extensionId: string, secretId: string): string {
  const extension = extensionId.trim();
  const secret = secretId.trim();
  if (!extension || !secret) throw new Error('extensionId and secretId are required');
  return `extension:${extension}:${secret}`;
}

function fileSecretsPath(stateRoot: string): string {
  return join(stateRoot, 'secrets.json');
}

function readFileSecrets(stateRoot: string): Record<string, string> {
  const path = fileSecretsPath(stateRoot);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

function createFileSecretBackend(stateRoot: string): SecretBackend {
  return {
    id: 'file',
    writable: true,
    get(key) {
      return readFileSecrets(stateRoot)[key];
    },
    set(key, value) {
      const path = fileSecretsPath(stateRoot);
      const secrets = readFileSecrets(stateRoot);
      secrets[key] = value;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
    },
    delete(key) {
      const path = fileSecretsPath(stateRoot);
      const secrets = readFileSecrets(stateRoot);
      delete secrets[key];
      if (Object.keys(secrets).length === 0) {
        if (existsSync(path)) rmSync(path);
        return;
      }
      writeFileSync(path, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
    },
  };
}

function createEnvOnlySecretBackend(): SecretBackend {
  return {
    id: 'env-only',
    writable: false,
    get() {
      return undefined;
    },
    set() {
      throw new Error('The env-only secret backend is read-only. Set the configured environment variable instead.');
    },
    delete() {
      throw new Error('The env-only secret backend is read-only.');
    },
  };
}

function createKeychainSecretBackend(): SecretBackend {
  return {
    id: 'keychain',
    writable: true,
    get(key) {
      try {
        return (
          execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', key, '-w'], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim() || undefined
        );
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      execFileSync('security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', key, '-w', value], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    },
    delete(key) {
      try {
        execFileSync('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', key], {
          stdio: ['ignore', 'ignore', 'pipe'],
        });
      } catch {
        // Deleting an absent secret is a no-op.
      }
    },
  };
}

export function createSecretBackend(stateRoot: string = getStateRoot()): SecretBackend {
  const backendId = readSecretBackendId(stateRoot);
  if (backendId === 'env-only') return createEnvOnlySecretBackend();
  if (backendId === 'keychain') {
    if (process.platform === 'darwin') return createKeychainSecretBackend();
    return createFileSecretBackend(stateRoot);
  }
  return createFileSecretBackend(stateRoot);
}

export function resolveSecret(extensionId: string, secretId: string, stateRoot: string = getStateRoot()): string | undefined {
  const declaration = listExtensionSecretRegistrations(stateRoot).find(
    (secret) => secret.extensionId === extensionId && secret.id === secretId,
  );
  const envName = declaration?.env;
  if (envName) {
    const envValue = process.env[envName]?.trim();
    if (envValue) return envValue;
  }
  return createSecretBackend(stateRoot).get(makeSecretKey(extensionId, secretId));
}

export function listSecretStatuses(stateRoot: string = getStateRoot()): SecretStatus[] {
  const backend = createSecretBackend(stateRoot);
  return listExtensionSecretRegistrations(stateRoot).map((secret) => {
    const key = makeSecretKey(secret.extensionId, secret.id);
    const envValue = secret.env ? process.env[secret.env]?.trim() : undefined;
    const backendValue = backend.get(key);
    const source: SecretSource | null = envValue ? 'env' : backendValue ? backend.id : null;
    return {
      extensionId: secret.extensionId,
      secretId: secret.id,
      key,
      label: secret.label,
      description: secret.description,
      env: secret.env,
      configured: source !== null,
      source,
      writable: backend.writable,
    };
  });
}

export function setSecret(extensionId: string, secretId: string, value: string, stateRoot: string = getStateRoot()): SecretStatus[] {
  const normalized = value.trim();
  if (!normalized) throw new Error('secret value is required');
  createSecretBackend(stateRoot).set(makeSecretKey(extensionId, secretId), normalized);
  return listSecretStatuses(stateRoot);
}

export function deleteSecret(extensionId: string, secretId: string, stateRoot: string = getStateRoot()): SecretStatus[] {
  createSecretBackend(stateRoot).delete(makeSecretKey(extensionId, secretId));
  return listSecretStatuses(stateRoot);
}

export function expandHomePath(pathValue: string): string {
  if (pathValue === '~') return homedir();
  if (pathValue.startsWith('~/')) return join(homedir(), pathValue.slice(2));
  return pathValue;
}
