import type { MethodHandler } from '../server.js';

export const config = {
  /**
   * `config/read` — read the effective configuration.
   */
  read: (async (_params, _ctx) => {
    const cwd = process.cwd();
    return {
      cwd,
      platform: process.platform,
      hostname: (await import('node:os')).hostname(),
      version: '0.1.0',
      modelProvider: 'personal-agent',
    };
  }) as MethodHandler,
};
