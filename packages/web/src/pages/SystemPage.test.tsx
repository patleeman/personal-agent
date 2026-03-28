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
          sync: {
            warnings: [],
            config: {
              enabled: true,
              repoDir: '/tmp/sync',
              remote: 'origin',
              branch: 'main',
              intervalSeconds: 120,
              autoResolveWithAgent: true,
              conflictResolverTaskSlug: 'sync-conflict-resolver',
              resolverCooldownMinutes: 30,
              autoResolveErrorsWithAgent: true,
              errorResolverTaskSlug: 'sync-error-resolver',
              errorResolverCooldownMinutes: 30,
            },
            git: {
              hasRepo: true,
              dirtyEntries: 1,
            },
            daemon: {
              connected: true,
              moduleLoaded: true,
              moduleEnabled: true,
              moduleDetail: {
                running: false,
                lastRunAt: '2026-03-18T17:01:00.000Z',
                lastSuccessAt: '2026-03-18T17:01:10.000Z',
                lastCommitAt: '2026-03-18T17:01:12.000Z',
                lastConflictFiles: [],
              },
            },
            log: {
              path: '/tmp/sync.log',
              lines: ['sync complete'],
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
                activeSlot: 'green',
                activeRelease: {
                  slot: 'green',
                  slotDir: '/tmp/web-ui/green',
                  distDir: '/tmp/web-ui/green/dist',
                  serverDir: '/tmp/web-ui/green/server',
                  serverEntryFile: '/tmp/web-ui/green/server/index.js',
                  sourceRepoRoot: '/repo',
                  builtAt: '2026-03-18T17:00:00.000Z',
                  revision: '123abc',
                },
                badReleases: [],
              },
            },
            log: {
              path: '/tmp/web-ui.log',
              lines: ['listening'],
            },
          },
          setDaemon: vi.fn(),
          setSync: vi.fn(),
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

  it('renders the system overview with service cards in settings', () => {
    const html = renderSystem('/settings?page=system', <SystemSettingsContent />);

    expect(html).toContain('Operational Overview');
    expect(html).toContain('Open runs');
    expect(html).toContain('Update + restart');
    expect(html).toContain('Restart everything');
    expect(html).toContain('Each service has its own page in the settings rail. Use these cards for a quick status scan.');
    expect(html).toContain('href="/settings?page=system-sync"');
    expect(html).toContain('href="/settings?page=system-web-ui"');
    expect(html).toContain('1 local file changed in the sync repo');
    expect(html).toContain('Connected via SSE');
    expect(html).toContain('Related Views');
    expect(html).not.toContain('Remote pairing');
    expect(html).not.toContain('daemon ready');
  });

  it('renders a dedicated system service page from the settings rail', () => {
    const html = renderSystem('/settings?page=system-sync', <SystemSettingsContent componentId="sync" />);

    expect(html).toContain('System overview');
    expect(html).toContain('Open runs');
    expect(html).toContain('Run sync now');
    expect(html).toContain('tracking origin/main');
    expect(html).toContain('sync complete');
    expect(html).not.toContain('Remote pairing');
    expect(html).toContain('href="/settings?page=system"');
    expect(html).toContain('via SSE');
    expect(html).toContain('Related Views');
  });
});
