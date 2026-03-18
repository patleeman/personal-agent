import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemPage } from './SystemPage.js';
import { useApi } from '../hooks';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('SystemPage', () => {
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

  it('renders individual subsystem reset controls on the system page', () => {
    const refetch = vi.fn();

    vi.mocked(useApi)
      .mockReturnValueOnce({
        data: {
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
            lines: [],
          },
        },
        loading: false,
        refreshing: false,
        error: null,
        refetch,
      })
      .mockReturnValueOnce({
        data: {
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
            dirtyEntries: 0,
            lastCommit: 'abc123 2026-03-18 sync ready',
            remoteUrl: 'git@example.com:state.git',
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
            path: '/tmp/daemon.log',
            lines: [],
          },
        },
        loading: false,
        refreshing: false,
        error: null,
        refetch,
      })
      .mockReturnValueOnce({
        data: {
          provider: 'telegram',
          currentProfile: 'datadog',
          configuredProfile: 'datadog',
          configFilePath: '/tmp/gateway.json',
          envOverrideKeys: [],
          warnings: [],
          service: {
            provider: 'telegram',
            platform: 'launchd',
            identifier: 'io.test.gateway',
            manifestPath: '/tmp/io.test.gateway.plist',
            installed: true,
            running: true,
          },
          access: {
            tokenConfigured: true,
            tokenSource: 'plain',
            allowlistChatIds: [],
            allowedUserIds: [],
            blockedUserIds: [],
          },
          conversations: [],
          pendingMessages: [],
          gatewayLog: {
            path: '/tmp/gateway.log',
            lines: [],
          },
        },
        loading: false,
        refreshing: false,
        error: null,
        refetch,
      })
      .mockReturnValueOnce({
        data: {
          warnings: [],
          service: {
            platform: 'launchd',
            identifier: 'io.test.web-ui',
            manifestPath: '/tmp/io.test.web-ui.plist',
            installed: true,
            running: true,
            repoRoot: '/repo',
            port: 3741,
            url: 'http://localhost:3741',
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
            lines: [],
          },
        },
        loading: false,
        refreshing: false,
        error: null,
        refetch,
      });

    const html = renderToString(
      <MemoryRouter initialEntries={['/system']}>
        <Routes>
          <Route path="/system" element={<SystemPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('Restart web UI');
    expect(html).toContain('Restart daemon');
    expect(html).toContain('Restart gateway');
    expect(html).toContain('Run sync now');
  });
});
