import { AuthStorage } from '@mariozechner/pi-coding-agent';

const TELEGRAM_AUTH_PROVIDER = 'telegram';

export function readTelegramBotToken(authFile: string): string | null {
  const storage = AuthStorage.create(authFile);
  const credential = storage.get(TELEGRAM_AUTH_PROVIDER);
  if (credential?.type === 'api_key' && typeof credential.key === 'string' && credential.key.trim()) {
    return credential.key.trim();
  }
  return null;
}

export function writeTelegramBotToken(authFile: string, token: string): void {
  const normalized = token.trim();
  if (!normalized) {
    throw new Error('Telegram bot token required');
  }
  AuthStorage.create(authFile).set(TELEGRAM_AUTH_PROVIDER, { type: 'api_key', key: normalized });
}

export function removeTelegramBotToken(authFile: string): void {
  AuthStorage.create(authFile).remove(TELEGRAM_AUTH_PROVIDER);
}
