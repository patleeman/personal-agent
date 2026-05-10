import { AuthStorage } from '@earendil-works/pi-coding-agent';

import { deleteSecret, resolveSecret, setSecret } from '../secrets/secretStore.js';

const TELEGRAM_AUTH_PROVIDER = 'telegram';
const TELEGRAM_SECRET_EXTENSION = 'system-gateways';
const TELEGRAM_SECRET_ID = 'telegramBotToken';

function readLegacyTelegramBotToken(authFile: string): string | null {
  const storage = AuthStorage.create(authFile);
  const credential = storage.get(TELEGRAM_AUTH_PROVIDER);
  if (credential?.type === 'api_key' && typeof credential.key === 'string' && credential.key.trim()) {
    return credential.key.trim();
  }
  return null;
}

export function readTelegramBotToken(authFile: string, stateRoot: string): string | null {
  return resolveSecret(TELEGRAM_SECRET_EXTENSION, TELEGRAM_SECRET_ID, stateRoot)?.trim() || readLegacyTelegramBotToken(authFile);
}

export function writeTelegramBotToken(authFile: string, stateRoot: string, token: string): void {
  const normalized = token.trim();
  if (!normalized) {
    throw new Error('Telegram bot token required');
  }
  setSecret(TELEGRAM_SECRET_EXTENSION, TELEGRAM_SECRET_ID, normalized, stateRoot);
  AuthStorage.create(authFile).remove(TELEGRAM_AUTH_PROVIDER);
}

export function removeTelegramBotToken(authFile: string, stateRoot: string): void {
  deleteSecret(TELEGRAM_SECRET_EXTENSION, TELEGRAM_SECRET_ID, stateRoot);
  AuthStorage.create(authFile).remove(TELEGRAM_AUTH_PROVIDER);
}
