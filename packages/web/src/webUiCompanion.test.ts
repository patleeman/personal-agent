import { describe, expect, it } from 'vitest';
import { buildWebUiCompanionAccessSummary } from './webUiCompanion';

describe('buildWebUiCompanionAccessSummary', () => {
  it('marks the companion app secure-ready when a tailnet https url exists', () => {
    const summary = buildWebUiCompanionAccessSummary({
      url: 'http://localhost:3741',
      tailscaleServe: true,
      tailscaleUrl: 'https://agent.tail.ts.net',
    });

    expect(summary).toEqual(expect.objectContaining({
      localUrl: 'http://localhost:3741/app/conversations',
      tailnetUrl: 'https://agent.tail.ts.net/app/conversations',
      secureOriginReady: true,
      statusLabel: 'secure-ready',
    }));
  });

  it('marks the companion app local-only when tailscale serve is disabled', () => {
    const summary = buildWebUiCompanionAccessSummary({
      url: 'http://localhost:3741',
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
      url: 'http://localhost:3741',
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
