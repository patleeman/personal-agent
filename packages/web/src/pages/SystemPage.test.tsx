import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SseConnectionContext, SystemStatusContext } from '../contexts.js';
import { SystemSettingsContent } from '../components/SystemSettingsContent.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function renderSystem(initialEntry: string, element: React.ReactElement) {
  return renderToString(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SseConnectionContext.Provider value={{ status: 'open' }}>
        <SystemStatusContext.Provider value={{
          daemon: {
            warnings: [],
            service: {
              platform: 'launchd',
              identifier: 'io.test.daemon',
              manifestPath: '/tmp/io.test.daemon.plist',
              installed: true,
              running: true,
            },
            runtime: {
              running: true,
              socketPath: '/tmp/personal-agentd.sock',
              pid: 123,
              startedAt: '2026-03-18T17:00:00.000Z',
              moduleCount: 4,
              queueDepth: 0,
              maxQueueDepth: 1000,
            },
            log: {
              path: '/tmp/daemon.log',
              lines: ['daemon ready'],
            },
          },
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
              companionPort: 3742,
              companionUrl: 'http://127.0.0.1:3742',
              tailscaleServe: false,
              resumeFallbackPrompt: 'Resume the conversation from the latest durable state.',
              deployment: {
                stablePort: 3741,
                activeRelease: {
                  distDir: '/repo/packages/web/dist',
                  serverDir: '/repo/packages/web/dist-server',
                  serverEntryFile: '/repo/packages/web/dist-server/index.js',
                  sourceRepoRoot: '/repo',
                  revision: '123abc',
                },
              },
            },
            log: {
              path: '/tmp/web-ui.log',
              lines: ['listening'],
            },
          },
          setDaemon: vi.fn(),
          setWebUi: vi.fn(),
        }}>
          {element}
        </SystemStatusContext.Provider>
      </SseConnectionContext.Provider>
    </MemoryRouter>,
  );
}

describe('System settings integration', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('useLayoutEffect does nothing on the server')) {
        return;
      }

      originalConsoleError(message, ...args);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('renders the consolidated system section inline', () => {
    const html = renderSystem('/settings', <SystemSettingsContent />);

    expect(html).toContain('Runtime services');
    expect(html).toContain('Web UI and daemon status, restart controls, logs, and companion transport settings stay inline here.');
    expect(html).toContain('Restart daemon');
    expect(html).toContain('Restart web UI');
    expect(html).toContain('Queue');
    expect(html).toContain('Modules');
    expect(html).not.toContain('Operational overview');
    expect(html).not.toContain('Update + restart');
    expect(html).not.toContain('Restart everything');
    expect(html).not.toContain('Related Views');
  });

  it('ignores legacy system subpage selection and still renders both services', () => {
    const html = renderSystem('/settings?page=system-daemon', <SystemSettingsContent componentId="daemon" />);

    expect(html).toContain('Runtime services');
    expect(html).not.toContain('Operational overview');
    expect(html).toContain('Restart daemon');
    expect(html).toContain('Restart web UI');
    expect(html).toContain('daemon ready');
    expect(html).not.toContain('Related Views');
  });
});
