import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ExtensionBackendContext } from '@personal-agent/extensions';

import { createCodexAuth } from './codexAuth.js';

let codexServer: Awaited<ReturnType<typeof import('./codexJsonRpcServer.js').createCodexServer>> | null = null;
let codexAuth: ReturnType<typeof createCodexAuth> | null = null;
let pairPayloadCache: AlleycatPairPayload | null = null;
let sidecarPid: number | null = null;
let sidecarLogPath: string | null = null;
let sidecarLogs: string[] = [];

const DEFAULT_COMPAT_PORT = 3850;
const SECRET_KEY = 'alleycat-secret-key';
const SIDECAR_READY_TIMEOUT_MS = 12_000;

export interface AlleycatPairPayload {
  v: 1;
  node_id: string;
  token: string;
  relay: string | null;
  host_name?: string | null;
}

export interface AlleycatAgentInfo {
  name: 'personal-agent';
  display_name: 'Personal Agent';
  wire: 'jsonl';
  available: boolean;
  presentation: {
    title: 'Personal Agent';
    is_beta: boolean;
    sort_order: number;
    description: string;
    aliases: string[];
  };
  capabilities: {
    locks_reasoning_effort_after_activity: boolean;
    supports_ssh_bridge: boolean;
    uses_direct_codex_port: boolean;
  };
}

export interface AlleycatStatus {
  running: boolean;
  port: number | null;
  pairPayload: AlleycatPairPayload | null;
  agents: AlleycatAgentInfo[];
  implementation: 'iroh-sidecar' | 'codex-jsonrpc-compat';
  sidecarRunning: boolean;
  logs: string[];
  note: string;
}

function personalAgentInfo(available: boolean): AlleycatAgentInfo {
  return {
    name: 'personal-agent',
    display_name: 'Personal Agent',
    wire: 'jsonl',
    available,
    presentation: {
      title: 'Personal Agent',
      is_beta: true,
      sort_order: 0,
      description: 'Personal Agent conversations exposed to Kitty Litter.',
      aliases: ['pa', 'personalagent'],
    },
    capabilities: {
      locks_reasoning_effort_after_activity: false,
      supports_ssh_bridge: false,
      uses_direct_codex_port: false,
    },
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function rememberLog(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  sidecarLogs.push(trimmed);
  if (sidecarLogs.length > 200) sidecarLogs = sidecarLogs.slice(-200);
}

function sidecarBinaryPath(): { binary: string | null; searched: string[] } {
  if (process.env.PERSONAL_AGENT_ALLEYCAT_SIDECAR) return { binary: process.env.PERSONAL_AGENT_ALLEYCAT_SIDECAR, searched: [] };
  const here = dirname(fileURLToPath(import.meta.url));
  const platform = process.platform === 'darwin' ? 'macos' : process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const binaryName = `pa-alleycat-host-${platform}-${arch}`;
  const roots = [process.env.PERSONAL_AGENT_REPO_ROOT, process.cwd()].filter((root): root is string => Boolean(root));
  const candidates = [
    // Built/imported extension packages copy static binaries into dist/bin.
    join(here, 'bin', binaryName),
    // Source-tree development keeps binaries at extension-root/bin while backend.mjs is in dist/.
    join(here, '..', 'bin', binaryName),
    // Dev backend builds may run from a cache directory, so import.meta.url is
    // not always under the extension package. Search the repo checkout too.
    ...roots.flatMap((root) => [
      join(root, 'experimental-extensions', 'extensions', 'system-alleycat', 'dist', 'bin', binaryName),
      join(root, 'experimental-extensions', 'extensions', 'system-alleycat', 'bin', binaryName),
    ]),
  ];
  return { binary: candidates.find((candidate) => existsSync(candidate)) ?? null, searched: [...new Set(candidates)] };
}

async function ensureSecretKey(ctx: ExtensionBackendContext): Promise<string> {
  const existing = await ctx.storage.get<string>(SECRET_KEY);
  if (typeof existing === 'string' && existing.trim()) return existing;
  const secret = randomBytes(32).toString('base64');
  await ctx.storage.put(SECRET_KEY, secret);
  return secret;
}

async function buildPairPayload(ctx: ExtensionBackendContext): Promise<AlleycatPairPayload | null> {
  const auth = codexAuth ?? createCodexAuth(ctx);
  await auth.ensurePairing();
  codexAuth = auth;
  return pairPayloadCache;
}

async function refreshSidecarLogs(): Promise<void> {
  if (!sidecarLogPath) return;
  try {
    const lines = readFileSync(sidecarLogPath, 'utf8').split('\n').filter(Boolean);
    sidecarLogs = lines.slice(-200);
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { type?: string; pairPayload?: AlleycatPairPayload };
        if (event.type === 'ready' && event.pairPayload) pairPayloadCache = event.pairPayload;
      } catch {
        // Keep non-JSON log lines only.
      }
    }
  } catch {
    // Log file may not exist yet.
  }
}

async function isPidRunning(ctx: ExtensionBackendContext, pid: number): Promise<boolean> {
  const result = await ctx.shell.exec({
    command: 'sh',
    args: ['-lc', `kill -0 ${pid} >/dev/null 2>&1 && echo yes || echo no`],
    timeoutMs: 5_000,
  });
  return result.stdout.trim() === 'yes';
}

async function startSidecar(ctx: ExtensionBackendContext): Promise<void> {
  if (!codexServer) throw new Error('Codex JSONL server must be running before Alleycat sidecar starts');
  if (sidecarPid && (await isPidRunning(ctx, sidecarPid))) return;

  const { binary, searched } = sidecarBinaryPath();
  if (!binary) {
    rememberLog(`sidecar binary missing; searched: ${searched.join(', ')}`);
    rememberLog('set PERSONAL_AGENT_ALLEYCAT_SIDECAR or rebuild/reimport the extension so dist/bin/pa-alleycat-host-* is packaged');
    return;
  }

  const auth = codexAuth ?? createCodexAuth(ctx);
  const token = await auth.ensurePairing();
  codexAuth = auth;
  const secret = await ensureSecretKey(ctx);
  const logPath = join(ctx.runtimeDir, 'alleycat-sidecar.log');
  sidecarLogPath = logPath;
  sidecarLogs = [];

  const command = [
    `PA_ALLEYCAT_TOKEN=${shellQuote(token)}`,
    `PA_ALLEYCAT_SECRET_KEY=${shellQuote(secret)}`,
    `PA_ALLEYCAT_JSONL_HOST=127.0.0.1`,
    `PA_ALLEYCAT_JSONL_PORT=${codexServer.jsonlPort}`,
    `RUST_LOG=${shellQuote(process.env.RUST_LOG ?? 'info')}`,
    `${shellQuote(binary)} >> ${shellQuote(logPath)} 2>&1 & echo $!`,
  ].join(' ');
  const result = await ctx.shell.exec({ command: 'sh', args: ['-lc', command], timeoutMs: 10_000 });
  sidecarPid = Number(result.stdout.trim());
  if (!Number.isFinite(sidecarPid) || sidecarPid <= 0)
    throw new Error(`Failed to start Alleycat sidecar: ${result.stderr || result.stdout}`);

  const deadline = Date.now() + SIDECAR_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await refreshSidecarLogs();
    if (pairPayloadCache?.node_id && pairPayloadCache.node_id !== 'sidecar-not-running') return;
    if (!(await isPidRunning(ctx, sidecarPid)))
      throw new Error(`Alleycat sidecar exited before ready: ${sidecarLogs.slice(-5).join('\n')}`);
  }
  throw new Error(`Timed out waiting for Alleycat sidecar ready event: ${sidecarLogs.slice(-5).join('\n')}`);
}

export async function start(_input: unknown, ctx: ExtensionBackendContext): Promise<AlleycatStatus> {
  if (!codexServer) {
    const { createCodexServer } = await import('./codexJsonRpcServer.js');
    const auth = codexAuth ?? createCodexAuth(ctx);
    codexAuth = auth;
    await auth.ensurePairing();
    const port = Number(process.env.PERSONAL_AGENT_ALLEYCAT_COMPAT_PORT) || DEFAULT_COMPAT_PORT;
    codexServer = await createCodexServer({ port, auth, ctx, bindAddress: '127.0.0.1', fallbackToEphemeralPortOnConflict: true });
    ctx.log.info('Personal Agent Alleycat compatibility server started', { port: codexServer.port, jsonlPort: codexServer.jsonlPort });
  }
  await startSidecar(ctx);
  pairPayloadCache = await buildPairPayload(ctx);
  return status(_input, ctx);
}

export async function startService(input: unknown, ctx: ExtensionBackendContext): Promise<() => Promise<void>> {
  await start(input, ctx);
  return async () => {
    await stop(undefined, ctx);
  };
}

export async function stop(_input?: unknown, ctx?: ExtensionBackendContext): Promise<{ ok: true }> {
  if (sidecarPid) {
    if (ctx) await ctx.shell.exec({ command: 'sh', args: ['-lc', `kill ${sidecarPid} >/dev/null 2>&1 || true`], timeoutMs: 5_000 });
    sidecarPid = null;
  }
  if (codexServer) {
    codexServer.stop();
    codexServer = null;
  }
  return { ok: true };
}

export async function status(_input?: unknown, ctx?: ExtensionBackendContext): Promise<AlleycatStatus> {
  if (ctx) await refreshSidecarLogs();
  if (ctx && sidecarPid && !(await isPidRunning(ctx, sidecarPid))) sidecarPid = null;
  if (ctx && !sidecarPid) {
    // Self-heal for dev reloads/imports where the manifest service registration
    // changed after the extension was already enabled. Enabled == running.
    await start(ctx).catch((error) => rememberLog(error instanceof Error ? error.message : String(error)));
  }
  if (ctx && !pairPayloadCache) pairPayloadCache = await buildPairPayload(ctx);
  return {
    running: Boolean(codexServer && sidecarPid),
    port: codexServer?.port ?? null,
    pairPayload: pairPayloadCache,
    agents: [personalAgentInfo(Boolean(codexServer && sidecarPid))],
    implementation: sidecarPid ? 'iroh-sidecar' : 'codex-jsonrpc-compat',
    sidecarRunning: Boolean(sidecarPid),
    logs: sidecarLogs.slice(-50),
    note: sidecarPid
      ? 'The PA-owned iroh Alleycat host is running and forwards Personal Agent JSON-RPC over a JSONL bridge.'
      : 'The Codex-shaped JSON-RPC compatibility server is available, but the iroh sidecar binary is not running yet.',
  };
}

export async function rotateToken(_input: unknown, ctx: ExtensionBackendContext): Promise<AlleycatStatus> {
  const auth = codexAuth ?? createCodexAuth(ctx);
  codexAuth = auth;
  auth.rotateToken();
  pairPayloadCache = await buildPairPayload(ctx);
  return status(_input, ctx);
}
