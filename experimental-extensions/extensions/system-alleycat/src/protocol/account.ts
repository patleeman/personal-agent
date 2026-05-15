import type { MethodHandler } from '../codexJsonRpcServer.js';

export const account = {
  /** `account/read` — report that PA manages model auth outside Codex. */
  read: (async () => ({
    account: { type: 'apiKey' },
    requiresOpenaiAuth: false,
  })) as MethodHandler,
};
