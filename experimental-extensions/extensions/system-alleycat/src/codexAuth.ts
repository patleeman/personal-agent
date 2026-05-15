import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ExtensionBackendContext } from '@personal-agent/extensions';

const TOKEN_BYTES = 32;
const SETTINGS_KEY = 'codex-token';
const STABLE_AUTH_FILE = 'kitty-litter-alleycat/auth.json';

export interface CodexAuth {
  /** Validate a bearer token. Returns true if valid. */
  validate(token: string): boolean;
  /** Get the current token (for clients to use). */
  getToken(): string | null;
  /** Rotate to a new token and return it. */
  rotateToken(): string;
  /** Ensure a token exists, creating one if needed. */
  ensurePairing(): Promise<string>;
}

export function createCodexAuth(ctx: ExtensionBackendContext): CodexAuth {
  // In-memory token cache. Loaded from stable profile storage immediately.
  let cachedToken: string | null = null;
  let loadPromise: Promise<void> | null = null;
  const stableAuthPath = join(ctx.runtimeDir, STABLE_AUTH_FILE);

  const readStableToken = (): string | null => {
    try {
      if (!existsSync(stableAuthPath)) return null;
      const parsed = JSON.parse(readFileSync(stableAuthPath, 'utf8')) as { token?: unknown };
      return typeof parsed.token === 'string' && parsed.token.trim() ? parsed.token : null;
    } catch {
      return null;
    }
  };

  const writeStableToken = (token: string): void => {
    mkdirSync(dirname(stableAuthPath), { recursive: true });
    writeFileSync(stableAuthPath, `${JSON.stringify({ token }, null, 2)}\n`, { mode: 0o600 });
  };

  // Kick off loading immediately (don't wait — storage may be async).
  // Callers should await ensurePaired() to guarantee loading is complete.
  const ensureLoaded = (): Promise<void> => {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      cachedToken = readStableToken();
      if (cachedToken) return;

      // One-time migration from extension-scoped storage. Dev imports can change
      // that namespace, so stable profile storage is the source of truth now.
      cachedToken = ((await ctx.storage.get<string>(SETTINGS_KEY).catch(() => null)) as string | null) ?? null;
      if (cachedToken) writeStableToken(cachedToken);
    })();
    return loadPromise;
  };

  // Start loading synchronously in constructor
  void ensureLoaded();

  const hashToken = (token: string): string => {
    return createHash('sha256').update(token).digest('hex');
  };

  const generateToken = (): string => {
    return randomBytes(TOKEN_BYTES).toString('base64url');
  };

  return {
    validate(token: string): boolean {
      if (!cachedToken) return false;
      return hashToken(token) === hashToken(cachedToken);
    },

    getToken(): string | null {
      return cachedToken;
    },

    rotateToken(): string {
      const token = generateToken();
      cachedToken = token;
      writeStableToken(token);
      void ctx.storage.put(SETTINGS_KEY, token);
      return token;
    },

    async ensurePairing(): Promise<string> {
      await ensureLoaded();
      if (cachedToken) return cachedToken;

      const token = generateToken();
      cachedToken = token;
      writeStableToken(token);
      await ctx.storage.put(SETTINGS_KEY, token);
      ctx.log.info(`codex protocol auth token generated: ${token.slice(0, 16)}...`);
      return token;
    },
  };
}
