import { hostname } from 'node:os';

import type { MethodHandler } from '../server.js';

/**
 * `initialize` — connection handshake.
 * Must be the first call on any connection.
 * Then emits `initialized` notification.
 */
export const initialize: { handler: MethodHandler } = {
  handler: async (params, _ctx, conn, notify) => {
    const p = params as Record<string, unknown> | undefined;
    const clientInfo = p?.clientInfo as { name?: string; title?: string; version?: string } | undefined;

    conn.initialized = true;
    if (clientInfo && typeof clientInfo === 'object') {
      conn.clientInfo = clientInfo;
    }

    // Per spec: emit initialized notification
    notify('initialized', {});

    return {
      codexHome: process.env.CODEX_HOME || process.cwd(),
      hostname: hostname(),
      platformFamily: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
      platformOs: process.platform,
      version: '0.1.0',
      capabilities: {
        experimentalApi: true,
        streams: true,
        files: true,
        commands: true,
      },
    };
  },
};
