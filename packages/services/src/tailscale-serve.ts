import { spawnSync, type SpawnSyncReturns } from 'child_process';

export interface SyncTailscaleServeProxyInput {
  enabled: boolean;
  port: number;
  path?: string;
}

export interface SyncWebUiTailscaleServeInput {
  enabled: boolean;
  port: number;
}

interface TailscaleStatusPayload {
  MagicDNSSuffix?: unknown;
  Self?: {
    DNSName?: unknown;
    HostName?: unknown;
  };
  Web?: unknown;
}

interface TailscaleCommandExecution {
  command: string;
  result: SpawnSyncReturns<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePort(port: number): number {
  if (!Number.isFinite(port)) {
    throw new Error(`Invalid Tailscale Serve port: ${String(port)}`);
  }

  const parsed = Math.floor(port);
  if (parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid Tailscale Serve port: ${String(port)}`);
  }

  return parsed;
}

function normalizeServePath(path?: string): string {
  const trimmed = typeof path === 'string' ? path.trim() : '';
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function normalizeDnsName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

function normalizeDnsHostSegment(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim().replace(/\.+$/, '');
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeDnsSuffix(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim().replace(/^\.+/, '').replace(/\.+$/, '');
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildTailscaleServeArgs(input: { enabled: boolean; port: number; path?: string }): string[] {
  const args = ['serve', '--bg', `--set-path=${normalizeServePath(input.path)}`, `localhost:${input.port}`];

  if (!input.enabled) {
    args.push('off');
  }

  return args;
}

function formatCommand(command: string, args: string[]): string {
  return `${command} ${args.join(' ')}`.trim();
}

function renderTailscaleCommandFailure(execution: TailscaleCommandExecution): string {
  const status = execution.result.status ?? 1;
  return (execution.result.stderr ?? '').trim()
    || (execution.result.stdout ?? '').trim()
    || `exit code ${status}`;
}

function resolveTailscaleCommandCandidates(): string[] {
  const explicit = process.env.PERSONAL_AGENT_TAILSCALE_BIN;
  const candidates = [
    explicit,
    'tailscale',
    '/opt/homebrew/bin/tailscale',
    '/usr/local/bin/tailscale',
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    '/usr/bin/tailscale',
    '/snap/bin/tailscale',
  ]
    .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
    .map((candidate) => candidate.trim());

  return [...new Set(candidates)];
}

function runTailscaleCommand(args: string[]): TailscaleCommandExecution {
  const commands = resolveTailscaleCommandCandidates();

  for (const command of commands) {
    const result = spawnSync(command, args, { encoding: 'utf-8' });

    if (result.error) {
      const error = result.error as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        continue;
      }

      throw new Error(`Failed to run \`${formatCommand(command, args)}\`: ${error.message}`);
    }

    return {
      command,
      result,
    };
  }

  throw new Error(
    'Could not run `tailscale`. Install the Tailscale CLI and authenticate this machine (`tailscale up`) before enabling Tailscale Serve.',
  );
}

function readTailscaleServeStatusPayload(): { payload?: TailscaleStatusPayload; error?: string } {
  let execution: TailscaleCommandExecution;

  try {
    execution = runTailscaleCommand(['serve', 'status', '--json']);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if ((execution.result.status ?? 1) !== 0) {
    return {
      error: `Could not read \`tailscale serve status --json\`: ${renderTailscaleCommandFailure(execution)}`,
    };
  }

  const raw = execution.result.stdout ?? '';
  if (!raw.trim()) {
    return { payload: {} };
  }

  try {
    return {
      payload: JSON.parse(raw) as TailscaleStatusPayload,
    };
  } catch (error) {
    return {
      error: `Could not parse \`tailscale serve status --json\`: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function readTailscaleStatusPayload(): { payload?: TailscaleStatusPayload; error?: string } {
  let execution: TailscaleCommandExecution;

  try {
    execution = runTailscaleCommand(['status', '--json']);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if ((execution.result.status ?? 1) !== 0) {
    return {
      error: `Could not read \`tailscale status --json\`: ${renderTailscaleCommandFailure(execution)}`,
    };
  }

  const raw = execution.result.stdout ?? '';
  if (!raw.trim()) {
    return { payload: {} };
  }

  try {
    return {
      payload: JSON.parse(raw) as TailscaleStatusPayload,
    };
  } catch (error) {
    return {
      error: `Could not parse \`tailscale status --json\`: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function findServeProxyTarget(payload: TailscaleStatusPayload, path: string): string | undefined {
  if (!isRecord(payload.Web)) {
    return undefined;
  }

  for (const service of Object.values(payload.Web)) {
    if (!isRecord(service) || !isRecord(service.Handlers)) {
      continue;
    }

    const handler = service.Handlers[path];
    if (!isRecord(handler)) {
      continue;
    }

    const proxy = typeof handler.Proxy === 'string' ? handler.Proxy.trim() : '';
    if (proxy.length > 0) {
      return proxy;
    }
  }

  return undefined;
}

function proxyTargetMatchesLoopbackPort(proxyTarget: string, port: number): boolean {
  const normalized = proxyTarget.includes('://') ? proxyTarget : `http://${proxyTarget}`;

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
    const resolvedPort = url.port
      ? Number(url.port)
      : url.protocol === 'https:'
        ? 443
        : 80;

    return ['localhost', '127.0.0.1', '::1'].includes(hostname)
      && resolvedPort === port;
  } catch {
    return false;
  }
}

function verifyTailscaleServeProxyState(input: { enabled: boolean; port: number; path?: string }): void {
  const normalizedPath = normalizeServePath(input.path);
  const status = readTailscaleServeStatusPayload();
  if (!status.payload) {
    throw new Error(status.error ?? 'Could not verify Tailscale Serve state.');
  }

  const proxyTarget = findServeProxyTarget(status.payload, normalizedPath);

  if (input.enabled) {
    if (!proxyTarget) {
      throw new Error(`Tailscale Serve did not expose ${normalizedPath} -> localhost:${String(input.port)} after applying config.`);
    }

    if (!proxyTargetMatchesLoopbackPort(proxyTarget, input.port)) {
      throw new Error(`Tailscale Serve exposed ${normalizedPath}, but it points to ${proxyTarget} instead of localhost:${String(input.port)}.`);
    }

    return;
  }

  if (proxyTarget) {
    throw new Error(`Tailscale Serve still exposes ${normalizedPath} -> ${proxyTarget} after disabling it.`);
  }
}

function resolveDnsNameFromStatus(payload: TailscaleStatusPayload): string | undefined {
  const directDnsName = normalizeDnsName(payload.Self?.DNSName);
  if (directDnsName) {
    return directDnsName;
  }

  const hostName = normalizeDnsHostSegment(payload.Self?.HostName);
  const suffix = normalizeDnsSuffix(payload.MagicDNSSuffix);
  if (!hostName || !suffix) {
    return undefined;
  }

  return `${hostName}.${suffix}`;
}

export function syncTailscaleServeProxy(input: SyncTailscaleServeProxyInput): void {
  const normalizedPort = normalizePort(input.port);
  const normalizedPath = normalizeServePath(input.path);
  const execution = runTailscaleCommand(buildTailscaleServeArgs({
    enabled: input.enabled,
    port: normalizedPort,
    path: normalizedPath,
  }));
  const status = execution.result.status ?? 1;

  if (status !== 0) {
    throw new Error(
      `Could not ${input.enabled ? 'enable' : 'disable'} Tailscale Serve for ${normalizedPath} -> localhost:${normalizedPort}: ${renderTailscaleCommandFailure(execution)}`,
    );
  }

  verifyTailscaleServeProxyState({
    enabled: input.enabled,
    port: normalizedPort,
    path: normalizedPath,
  });
}

export function syncWebUiTailscaleServe(input: SyncWebUiTailscaleServeInput): void {
  syncTailscaleServeProxy({
    ...input,
    path: '/',
  });
}

export function resolveTailscaleServeBaseUrl(): string | undefined {
  const status = readTailscaleStatusPayload();
  if (!status.payload) {
    return undefined;
  }

  const dnsName = resolveDnsNameFromStatus(status.payload);
  return dnsName ? `https://${dnsName}` : undefined;
}

export function resolveWebUiTailscaleUrl(): string | undefined {
  return resolveTailscaleServeBaseUrl();
}
