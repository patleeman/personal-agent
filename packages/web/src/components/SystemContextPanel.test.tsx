import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SystemStatusContext } from '../app/contexts.js';
import { SystemContextPanel } from './SystemContextPanel.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('SystemContextPanel', () => {
  it('shows remote browser access details for the web ui service', () => {
    const html = renderToString(
      <SystemStatusContext.Provider value={{
        daemon: null,
        webUi: {
          warnings: [],
          service: {
            platform: 'launchd',
            identifier: 'io.test.web-ui',
            manifestPath: '/tmp/io.test.web-ui.plist',
            installed: true,
            running: true,
            repoRoot: '/repo',
            port: 3741,
            url: 'http://127.0.0.1:3741',
            tailscaleServe: true,
            tailscaleUrl: 'https://agent.tail.ts.net',
            resumeFallbackPrompt: 'Continue from where you left off.',
          },
          log: {
            path: '/tmp/web-ui.log',
            lines: ['listening'],
          },
        },
        setDaemon: vi.fn(),
        setWebUi: vi.fn(),
      }}>
        <SystemContextPanel componentId="web-ui" />
      </SystemStatusContext.Provider>,
    );

    expect(html).toContain('Remote pairing');
    expect(html).toContain('Open tailnet desktop');
    expect(html).toContain('Open local web UI');
    expect(html).toContain('Open tailnet web UI');
    expect(html).toContain('https-ready');
  });
});
