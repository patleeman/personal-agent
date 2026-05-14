import type { ExtensionBackendContext } from '@personal-agent/extensions';

let server: Awaited<ReturnType<typeof import('./server.js').createCodexServer>> | null = null;
let serverAuth: ReturnType<typeof import('./auth.js').createCodexAuth> | null = null;

const DEFAULT_CODEX_PORT = 3847;

export async function start(_input: unknown, ctx: ExtensionBackendContext): Promise<{ ok: boolean; port: number }> {
  if (server) {
    return { ok: true, port: server.port };
  }

  try {
    const { createCodexServer } = await import('./server.js');
    const { createCodexAuth } = await import('./auth.js');

    const auth = createCodexAuth(ctx);
    const port = Number(process.env.CODEX_PORT) || DEFAULT_CODEX_PORT;

    serverAuth = auth;
    server = await createCodexServer({ port, auth, ctx, bindAddress: '0.0.0.0', fallbackToEphemeralPortOnConflict: true });

    await auth.ensurePairing();

    ctx.log.info(`codex protocol server listening on ws://0.0.0.0:${server.port}`);
    return { ok: true, port: server.port };
  } catch (error) {
    ctx.log.error(`failed to start codex server`, { error: (error as Error).message });
    throw error;
  }
}

export async function stop(): Promise<{ ok: true }> {
  if (server) {
    server.stop();
    server = null;
    serverAuth = null;
  }
  return { ok: true };
}

export async function status(): Promise<{
  running: boolean;
  port: number | null;
  token: string | null;
}> {
  if (!server) {
    return { running: false, port: null, token: null };
  }
  return {
    running: true,
    port: server.port,
    token: serverAuth?.getToken() ?? null,
  };
}

export async function rotateToken(): Promise<{ token: string }> {
  if (!serverAuth) throw new Error('Server not started');
  return { token: serverAuth.rotateToken() };
}
