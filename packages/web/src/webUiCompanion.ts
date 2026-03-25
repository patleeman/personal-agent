import type { WebUiServiceSummary } from './types';

export interface WebUiCompanionAccessSummary {
  localUrl: string;
  tailnetUrl: string | null;
  secureOriginReady: boolean;
  statusLabel: string;
  detail: string;
}

function joinCompanionPath(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/app/conversations`;
}

export function buildWebUiCompanionAccessSummary(
  service: Pick<WebUiServiceSummary, 'url' | 'tailscaleServe' | 'tailscaleUrl'>,
): WebUiCompanionAccessSummary {
  const localUrl = joinCompanionPath(service.url);
  const tailnetUrl = service.tailscaleUrl ? joinCompanionPath(service.tailscaleUrl) : null;
  const secureOriginReady = Boolean(service.tailscaleServe && tailnetUrl?.startsWith('https://'));

  if (secureOriginReady) {
    return {
      localUrl,
      tailnetUrl,
      secureOriginReady: true,
      statusLabel: 'secure-ready',
      detail: 'Tailnet HTTPS is available for installability, notifications, and remote reopen.',
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
    detail: 'The companion app works locally, but installability and remote notifications need Tailnet HTTPS.',
  };
}
