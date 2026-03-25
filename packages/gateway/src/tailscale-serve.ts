import { spawnSync, type SpawnSyncReturns } from 'child_process';

export interface SyncWebUiTailscaleServeInput {
  enabled: boolean;
  port: number;
  companionPort?: number;
}

interface TailscaleStatusPayload {
  MagicDNSSuffix?: unknown;
  Self?: {
    DNSName?: unknown;
    HostName?: unknown;
  };
}

interface TailscaleCommandExecution {
  command: string;
  result: SpawnSyncReturns<string>;
}

function normalizePort(port: number): number {
  if (!Number.isFinite(port)) {
    throw new Error(`Invalid web UI port: ${String(port)}`);
  }

  const parsed = Math.floor(port);
  if (parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid web UI port: ${String(port)}`);
  }

  return parsed;
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
  const args = ['serve', '--bg'];

  if (input.path) {
    args.push(`--set-path=${input.path}`);
  }

  args.push(`localhost:${input.port}`);
  if (!input.enabled) {
    args.push('off');
  }

  return args;
}

function formatCommand(command: string, args: string[]): string {
  return `${command} ${args.join(' ')}`.trim();
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

export function syncWebUiTailscaleServe(input: SyncWebUiTailscaleServeInput): void {
  const normalizedPort = normalizePort(input.port);
  const normalizedCompanionPort = input.companionPort === undefined ? undefined : normalizePort(input.companionPort);
  const mappings = [
    { port: normalizedPort, label: '/', path: undefined as string | undefined },
    ...(normalizedCompanionPort === undefined
      ? []
      : [{ port: normalizedCompanionPort, label: '/app', path: '/app' }]),
  ];

  for (const mapping of mappings) {
    const args = buildTailscaleServeArgs({
      enabled: input.enabled,
      port: mapping.port,
      ...(mapping.path ? { path: mapping.path } : {}),
    });
    const execution = runTailscaleCommand(args);
    const status = execution.result.status ?? 1;

    if (status !== 0) {
      const detail = (execution.result.stderr ?? '').trim() || (execution.result.stdout ?? '').trim() || `exit code ${status}`;
      throw new Error(
        `Could not ${input.enabled ? 'enable' : 'disable'} Tailscale Serve for ${mapping.label} -> localhost:${mapping.port}: ${detail}`,
      );
    }
  }
}

export function resolveWebUiTailscaleUrl(): string | undefined {
  let execution: TailscaleCommandExecution;

  try {
    execution = runTailscaleCommand(['status', '--json']);
  } catch {
    return undefined;
  }

  if ((execution.result.status ?? 1) !== 0) {
    return undefined;
  }

  const raw = execution.result.stdout ?? '';
  if (!raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as TailscaleStatusPayload;
    const dnsName = resolveDnsNameFromStatus(parsed);

    return dnsName ? `https://${dnsName}` : undefined;
  } catch {
    return undefined;
  }
}
