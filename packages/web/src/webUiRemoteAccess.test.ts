import { describe, expect, it } from 'vitest';
import { buildWebUiRemoteAccessSummary } from './webUiRemoteAccess';

describe('buildWebUiRemoteAccessSummary', () => {
  it('marks remote browser access https-ready when a tailnet https url exists', () => {
    const summary = buildWebUiRemoteAccessSummary({
      platform: 'launchd',
      url: 'http://127.0.0.1:3741',
      tailscaleServe: true,
      tailscaleUrl: 'https://agent.tail.ts.net',
    });

    expect(summary).toEqual({
      localUrl: 'http://127.0.0.1:3741',
      tailnetUrl: 'https://agent.tail.ts.net',
      secureOriginReady: true,
      statusLabel: 'https-ready',
      detail: 'Tailnet HTTPS is routing to the full web UI. Pair a browser code to sign in remotely.',
    });
  });

  it('marks remote browser access local-only when tailscale serve is disabled', () => {
    const summary = buildWebUiRemoteAccessSummary({
      platform: 'launchd',
      url: 'http://127.0.0.1:3741',
      tailscaleServe: false,
      tailscaleUrl: undefined,
    });

    expect(summary).toEqual({
      localUrl: 'http://127.0.0.1:3741',
      tailnetUrl: null,
      secureOriginReady: false,
      statusLabel: 'local-only',
      detail: 'The full web UI is currently local-only. Enable Tailscale Serve for encrypted remote browser access.',
    });
  });

  it('marks remote browser access resolving when serve is enabled without a tailnet url', () => {
    const summary = buildWebUiRemoteAccessSummary({
      platform: 'launchd',
      url: 'http://127.0.0.1:3741',
      tailscaleServe: true,
      tailscaleUrl: undefined,
    });

    expect(summary).toEqual({
      localUrl: 'http://127.0.0.1:3741',
      tailnetUrl: null,
      secureOriginReady: false,
      statusLabel: 'resolving',
      detail: 'Tailscale Serve is enabled, but the Tailnet HTTPS URL is not available yet.',
    });
  });

  it('marks remote browser access unavailable in desktop mode', () => {
    const summary = buildWebUiRemoteAccessSummary({
      platform: 'desktop',
      url: 'personal-agent://app/',
      tailscaleServe: true,
      tailscaleUrl: 'https://agent.tail.ts.net',
    });

    expect(summary).toEqual({
      localUrl: 'Not exposed in desktop mode.',
      tailnetUrl: null,
      secureOriginReady: false,
      statusLabel: 'desktop-only',
      detail: 'The packaged desktop shell keeps the local UI inside Electron and does not expose remote browser access over Tailnet HTTPS.',
    });
  });
});
