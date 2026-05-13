import type { MethodHandler } from '../server.js';

export const account = {
  /** `account/read` — report that PA manages model auth outside Codex. */
  read: (async () => ({
    account: { type: 'apiKey' },
    requiresOpenaiAuth: false,
  })) as MethodHandler,
};
