import type { WebUiServiceSummary } from './types';

export interface WebUiRemoteAccessSummary {
  localUrl: string;
  tailnetUrl: string | null;
  secureOriginReady: boolean;
  statusLabel: string;
  detail: string;
}

export function buildWebUiRemoteAccessSummary(
  service: Pick<WebUiServiceSummary, 'platform' | 'url' | 'tailscaleServe' | 'tailscaleUrl'>,
): WebUiRemoteAccessSummary {
  if (service.platform === 'desktop') {
    return {
      localUrl: 'Not exposed in desktop mode.',
      tailnetUrl: null,
      secureOriginReady: false,
      statusLabel: 'desktop-only',
      detail: 'The packaged desktop shell keeps the local UI inside Electron and does not expose remote browser access over Tailnet HTTPS.',
    };
  }

  const localUrl = service.url;
  const tailnetUrl = service.tailscaleUrl ?? null;
  const secureOriginReady = Boolean(service.tailscaleServe && tailnetUrl?.startsWith('https://'));

  if (secureOriginReady) {
    return {
      localUrl,
      tailnetUrl,
      secureOriginReady: true,
      statusLabel: 'https-ready',
      detail: 'Tailnet HTTPS is routing to the full web UI. Pair a browser code to sign in remotely.',
    };
  }

  if (service.tailscaleServe) {
    return {
      localUrl,
      tailnetUrl,
      secureOriginReady: false,
      statusLabel: 'resolving',
      detail: 'Tailscale Serve is enabled, but the Tailnet HTTPS URL is not available yet.',
    };
  }

  return {
    localUrl,
    tailnetUrl: null,
    secureOriginReady: false,
    statusLabel: 'local-only',
    detail: 'The full web UI is currently local-only. Enable Tailscale Serve for encrypted remote browser access.',
  };
}
