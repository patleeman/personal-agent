import type { WebUiServiceSummary } from './types';

export interface WebUiCompanionAccessSummary {
  localUrl: string;
  tailnetUrl: string | null;
  secureOriginReady: boolean;
  statusLabel: string;
  detail: string;
}

function joinCompanionPath(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/app/inbox`;
}

export function buildWebUiCompanionAccessSummary(
  service: Pick<WebUiServiceSummary, 'companionUrl' | 'tailscaleServe' | 'tailscaleUrl'>,
): WebUiCompanionAccessSummary {
  const localUrl = joinCompanionPath(service.companionUrl);
  const tailnetUrl = service.tailscaleUrl ? joinCompanionPath(service.tailscaleUrl) : null;
  const secureOriginReady = Boolean(service.tailscaleServe && tailnetUrl?.startsWith('https://'));

  if (secureOriginReady) {
    return {
      localUrl,
      tailnetUrl,
      secureOriginReady: true,
      statusLabel: 'https-ready',
      detail: 'Tailnet HTTPS is routing to the restricted companion service. Pair a device code to sign in from the phone companion.',
    };
  }

  if (service.tailscaleServe) {
    return {
      localUrl,
      tailnetUrl,
      secureOriginReady: false,
      statusLabel: 'resolving',
      detail: 'Tailscale Serve is enabled, but the tailnet HTTPS URL is not available yet.',
    };
  }

  return {
    localUrl,
    tailnetUrl: null,
    secureOriginReady: false,
    statusLabel: 'local-only',
    detail: 'The companion app works locally on the restricted companion service. Tailnet HTTPS is still required for encrypted remote access and mobile notifications.',
  };
}
