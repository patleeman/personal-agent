import { createHash, randomBytes } from 'node:crypto';

import type { ExtensionBackendContext } from '@personal-agent/extensions';

const TOKEN_BYTES = 32;
const SETTINGS_KEY = 'codex-token';

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
  // In-memory token cache. Loaded from storage immediately.
  let cachedToken: string | null = null;
  let loadPromise: Promise<void> | null = null;

  // Kick off loading immediately (don't wait — storage may be async).
  // Callers should await ensurePaired() to guarantee loading is complete.
  const ensureLoaded = (): Promise<void> => {
    if (loadPromise) return loadPromise;
    loadPromise = ctx.storage.get<string>(SETTINGS_KEY).then((stored) => {
      cachedToken = (stored as string | null) ?? null;
    });
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
      void ctx.storage.put(SETTINGS_KEY, token);
      return token;
    },

    async ensurePairing(): Promise<string> {
      await ensureLoaded();
      if (cachedToken) return cachedToken;

      const token = generateToken();
      cachedToken = token;
      await ctx.storage.put(SETTINGS_KEY, token);
      ctx.log.info(`codex protocol auth token generated: ${token.slice(0, 16)}...`);
      return token;
    },
  };
}
