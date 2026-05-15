import { randomBytes } from 'node:crypto';

import type { ExtensionBackendContext } from '@personal-agent/extensions';

import { createCodexAuth } from './codexAuth.js';

let codexServer: Awaited<ReturnType<typeof import('./codexJsonRpcServer.js').createCodexServer>> | null = null;
let codexAuth: ReturnType<typeof createCodexAuth> | null = null;
let pairPayloadCache: AlleycatPairPayload | null = null;

const DEFAULT_COMPAT_PORT = 3850;
const NODE_ID_KEY = 'alleycat-node-id';

export interface AlleycatPairPayload {
  v: 1;
  node_id: string;
  token: string;
  relay: string | null;
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
  implementation: 'codex-jsonrpc-compat';
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

function generateOpaqueNodeId(): string {
  // Real Alleycat node ids are iroh public keys. Until the Rust iroh host lands,
  // keep the UI/API shape stable without pretending this is dialable over iroh.
  return randomBytes(32).toString('hex');
}

async function ensureNodeId(ctx: ExtensionBackendContext): Promise<string> {
  const existing = await ctx.storage.get<string>(NODE_ID_KEY);
  if (typeof existing === 'string' && existing.trim()) return existing;
  const nodeId = generateOpaqueNodeId();
  await ctx.storage.put(NODE_ID_KEY, nodeId);
  return nodeId;
}

async function buildPairPayload(ctx: ExtensionBackendContext): Promise<AlleycatPairPayload> {
  const auth = codexAuth ?? createCodexAuth(ctx);
  const token = await auth.ensurePairing();
  codexAuth = auth;
  const nodeId = await ensureNodeId(ctx);
  return { v: 1, node_id: nodeId, token, relay: null };
}

export async function start(_input: unknown, ctx: ExtensionBackendContext): Promise<AlleycatStatus> {
  if (!codexServer) {
    const { createCodexServer } = await import('./codexJsonRpcServer.js');
    const auth = codexAuth ?? createCodexAuth(ctx);
    codexAuth = auth;
    await auth.ensurePairing();
    const port = Number(process.env.PERSONAL_AGENT_ALLEYCAT_COMPAT_PORT) || DEFAULT_COMPAT_PORT;
    codexServer = await createCodexServer({ port, auth, ctx, bindAddress: '127.0.0.1', fallbackToEphemeralPortOnConflict: true });
    ctx.log.info('Personal Agent Alleycat compatibility server started', { port: codexServer.port });
  }
  pairPayloadCache = await buildPairPayload(ctx);
  return status(_input, ctx);
}

export async function startService(input: unknown, ctx: ExtensionBackendContext): Promise<() => Promise<void>> {
  await start(input, ctx);
  return async () => {
    await stop();
  };
}

export async function stop(): Promise<{ ok: true }> {
  if (codexServer) {
    codexServer.stop();
    codexServer = null;
  }
  return { ok: true };
}

export async function status(_input?: unknown, ctx?: ExtensionBackendContext): Promise<AlleycatStatus> {
  if (ctx && !pairPayloadCache) pairPayloadCache = await buildPairPayload(ctx);
  return {
    running: Boolean(codexServer),
    port: codexServer?.port ?? null,
    pairPayload: pairPayloadCache,
    agents: [personalAgentInfo(Boolean(codexServer))],
    implementation: 'codex-jsonrpc-compat',
    note: 'This service currently exposes the full Codex-shaped Personal Agent JSON-RPC API locally. The Rust iroh Alleycat host will replace the compatibility listener before enabling phone pairing.',
  };
}

export async function rotateToken(_input: unknown, ctx: ExtensionBackendContext): Promise<AlleycatStatus> {
  const auth = codexAuth ?? createCodexAuth(ctx);
  codexAuth = auth;
  auth.rotateToken();
  pairPayloadCache = await buildPairPayload(ctx);
  return status(_input, ctx);
}
