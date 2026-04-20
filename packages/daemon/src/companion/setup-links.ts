import { networkInterfaces } from 'node:os';
import type { DaemonConfig } from '../config.js';
import { resolveCompanionTailscaleUrl } from '../tailscale-serve.js';
import type { CompanionPairingCode, CompanionSetupLink, CompanionSetupState } from './types.js';

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === 'localhost'
    || normalized === '::ffff:127.0.0.1';
}

function isWildcardHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '0.0.0.0'
    || normalized === '::'
    || normalized === '::0'
    || normalized === '::ffff:0.0.0.0';
}

function formatHttpHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

function buildSetupUrl(input: {
  baseUrl: string;
  pairingCode: string;
  hostLabel: string;
  hostInstanceId: string;
}): string {
  const params = new URLSearchParams({
    base: input.baseUrl,
    code: input.pairingCode,
    label: input.hostLabel,
    hostInstanceId: input.hostInstanceId,
  });
  return `pa-companion://pair?${params.toString()}`;
}

function isUsableIpv4Address(address: string): boolean {
  return !address.startsWith('127.') && !address.startsWith('169.254.');
}

function compareInterfacePriority(left: string, right: string): number {
  const score = (value: string) => {
    if (/^en\d+$/i.test(value)) {
      return 0;
    }
    if (/^ethernet/i.test(value)) {
      return 1;
    }
    if (/^utun\d+$/i.test(value) || /^tailscale/i.test(value)) {
      return 2;
    }
    return 3;
  };

  return score(left) - score(right) || left.localeCompare(right);
}

export function buildCompanionSetupState(input: {
  config: DaemonConfig;
  pairing: CompanionPairingCode;
  hostLabel: string;
  hostInstanceId: string;
  readNetworkInterfaces?: typeof networkInterfaces;
  resolveTailnetUrl?: (port: number) => string | undefined;
}): CompanionSetupState {
  const companionHost = input.config.companion?.host?.trim() || '127.0.0.1';
  const companionPort = input.config.companion?.port ?? 3843;
  const warnings: string[] = [];
  const links: CompanionSetupLink[] = [];
  const seenBaseUrls = new Set<string>();
  const tailnetUrl = input.resolveTailnetUrl
    ? input.resolveTailnetUrl(companionPort)
    : resolveCompanionTailscaleUrl(companionPort);
  const addBaseUrl = (label: string, baseUrl: string) => {
    if (seenBaseUrls.has(baseUrl)) {
      return;
    }
    seenBaseUrls.add(baseUrl);
    links.push({
      id: `${links.length + 1}`,
      label,
      baseUrl,
      setupUrl: buildSetupUrl({
        baseUrl,
        pairingCode: input.pairing.code,
        hostLabel: input.hostLabel,
        hostInstanceId: input.hostInstanceId,
      }),
    });
  };
  const addHostLink = (label: string, host: string) => {
    addBaseUrl(label, `http://${formatHttpHost(host)}:${String(companionPort)}`);
  };

  if (tailnetUrl) {
    const tailnetHostLabel = (() => {
      try {
        return new URL(tailnetUrl).host || 'Tailnet HTTPS';
      } catch {
        return 'Tailnet HTTPS';
      }
    })();
    addBaseUrl(`Tailnet · ${tailnetHostLabel}`, tailnetUrl);
  }

  if (isLoopbackHost(companionHost)) {
    if (!tailnetUrl) {
      warnings.push('Companion access is still bound to loopback only. Enable local-network phone access before pairing from your phone.');
    }
  } else if (isWildcardHost(companionHost)) {
    const readInterfaces = input.readNetworkInterfaces ?? networkInterfaces;
    const interfaces = readInterfaces();
    const names = Object.keys(interfaces).sort(compareInterfacePriority);
    for (const name of names) {
      const entries = (interfaces as Record<string, Array<{ address: string; family: string | number; internal: boolean }> | undefined>)[name] ?? [];
      for (const entry of entries) {
        const family = typeof entry.family === 'string' ? entry.family : String(entry.family);
        if ((family !== 'IPv4' && family !== '4') || entry.internal !== false || !isUsableIpv4Address(entry.address)) {
          continue;
        }
        addHostLink(`${name} · ${entry.address}`, entry.address);
      }
    }

    if (links.length === 0) {
      warnings.push('No non-loopback IPv4 network address is available for QR pairing. Connect the host machine to Wi-Fi or Ethernet, or bind the companion host to a specific reachable address.');
    }
  } else {
    addHostLink('Configured host', companionHost);
  }

  return {
    pairing: input.pairing,
    links,
    warnings,
  };
}
