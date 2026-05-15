import { hostname, machine, release, type } from 'node:os';
import { resolve } from 'node:path';

import type { MethodHandler } from '../codexJsonRpcServer.js';
import { isLiveOrRunning, toThreadResponse } from './thread.js';

/**
 * `initialize` — connection handshake.
 * Must be the first call on any connection.
 * The Codex client sends the follow-up `initialized` notification after it
 * receives this response.
 */
export const initialize: { handler: MethodHandler } = {
  handler: async (params, ctx, conn, notify) => {
    const p = params as Record<string, unknown> | undefined;
    const clientInfo = p?.clientInfo as { name?: string; title?: string; version?: string } | undefined;

    conn.initialized = true;
    if (clientInfo && typeof clientInfo === 'object') {
      conn.clientInfo = clientInfo;
    }

    const codexHome = resolve(process.env.CODEX_HOME || process.cwd());
    const platformOs = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
    const platformFamily = process.platform === 'win32' ? 'windows' : 'unix';
    const version = '0.125.0';

    setTimeout(() => {
      void (async () => {
        const sessions = await ctx.conversations.list().catch(() => []);
        if (!Array.isArray(sessions)) return;
        let count = 0;
        for (const raw of sessions) {
          const session = raw as Record<string, unknown>;
          if (!isLiveOrRunning(session) || typeof session.id !== 'string' || !session.id) continue;
          notify('thread/started', { thread: toThreadResponse(session.id, session, [], ctx) });
          count += 1;
        }
        ctx.log.info(`alleycat announced ${count} live PA thread(s) after initialize`);
      })();
    }, 0);

    return {
      userAgent: `codex_cli_rs/${version} (${type()} ${release()}; ${machine()}) personal-agent`,
      codexHome,
      platformFamily,
      platformOs,

      // Extra compatibility fields retained for older PA Codex clients.
      hostname: hostname(),
      version,
      capabilities: {
        experimentalApi: true,
        streams: true,
        files: true,
        commands: true,
      },
    };
  },
};
