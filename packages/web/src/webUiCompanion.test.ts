import { describe, expect, it } from 'vitest';
import { buildWebUiCompanionAccessSummary } from './webUiCompanion';

describe('buildWebUiCompanionAccessSummary', () => {
  it('marks the companion app https-ready when a tailnet https url exists', () => {
    const summary = buildWebUiCompanionAccessSummary({
      companionUrl: 'http://127.0.0.1:3742',
      tailscaleServe: true,
      tailscaleUrl: 'https://agent.tail.ts.net',
    });

    expect(summary).toEqual(expect.objectContaining({
      localUrl: 'http://127.0.0.1:3742/app/inbox',
      tailnetUrl: 'https://agent.tail.ts.net/app/inbox',
      secureOriginReady: true,
      statusLabel: 'https-ready',
    }));
  });

  it('marks the companion app local-only when tailscale serve is disabled', () => {
    const summary = buildWebUiCompanionAccessSummary({
      companionUrl: 'http://127.0.0.1:3742',
      tailscaleServe: false,
      tailscaleUrl: undefined,
    });

    expect(summary).toEqual(expect.objectContaining({
      tailnetUrl: null,
      secureOriginReady: false,
      statusLabel: 'local-only',
    }));
  });

  it('marks the companion app resolving when serve is enabled without a tailnet url', () => {
    const summary = buildWebUiCompanionAccessSummary({
      companionUrl: 'http://127.0.0.1:3742',
      tailscaleServe: true,
      tailscaleUrl: undefined,
    });

    expect(summary).toEqual(expect.objectContaining({
      tailnetUrl: null,
      secureOriginReady: false,
      statusLabel: 'resolving',
    }));
  });
});
