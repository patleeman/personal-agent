import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useApi } from '../hooks';
import { useSseConnection, useSystemStatus } from '../contexts';
import { useTheme } from '../theme';
import { SettingsPage } from './SettingsPage.js';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

vi.mock('../contexts', () => ({
  useSseConnection: vi.fn(),
  useSystemStatus: vi.fn(),
}));

vi.mock('../theme', () => ({
  useTheme: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function buildUseApiResult<T>(data: T) {
  return {
    data,
    loading: false,
    refreshing: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(data),
    replaceData: vi.fn(),
  };
}

function renderPage(pathname: string): string {
  return renderToString(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsPage', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('useLayoutEffect does nothing on the server')) {
        return;
      }

      originalConsoleError(message, ...args);
    });

    vi.mocked(useTheme).mockReturnValue({
      theme: 'dark',
      themePreference: 'system',
      setThemePreference: vi.fn(),
      toggle: vi.fn(),
    });

    vi.mocked(useSseConnection).mockReturnValue({
      status: 'open',
    });

    vi.mocked(useSystemStatus).mockReturnValue({
      daemon: {
        warnings: [],
        service: {
          platform: 'launchctl',
          identifier: 'app.personal-agent.daemon',
          manifestPath: '/tmp/daemon.plist',
          installed: true,
          running: true,
        },
        runtime: {
          running: true,
          socketPath: '/tmp/daemon.sock',
          pid: 123,
          startedAt: '2026-03-28T00:00:00.000Z',
          moduleCount: 8,
          queueDepth: 1,
          maxQueueDepth: 4,
        },
        log: {
          lines: [],
        },
      },
      webUi: {
        warnings: [],
        service: {
          platform: 'launchctl',
          identifier: 'app.personal-agent.web',
          manifestPath: '/tmp/web-ui.plist',
          installed: true,
          running: true,
          repoRoot: '/Users/patrick/workingdir/personal-agent',
          port: 3000,
          url: 'http://127.0.0.1:3000',
          companionPort: 3001,
          companionUrl: 'http://127.0.0.1:3001',
          tailscaleServe: false,
          resumeFallbackPrompt: 'Continue where you left off.',
          deployment: {
            stablePort: 3000,
            activeSlot: 'blue',
            activeRelease: {
              slot: 'blue',
              slotDir: '/tmp/releases/blue',
              distDir: '/tmp/releases/blue/dist',
              serverDir: '/tmp/releases/blue/server',
              serverEntryFile: '/tmp/releases/blue/server/index.js',
              sourceRepoRoot: '/Users/patrick/workingdir/personal-agent',
              builtAt: '2026-03-28T00:00:00.000Z',
              revision: 'abc123',
            },
            badReleases: [],
          },
        },
        log: {
          lines: [],
        },
      },
      setDaemon: vi.fn(),
      setWebUi: vi.fn(),
    });

    vi.mocked(useApi).mockImplementation((fetcher, key) => {
      if (fetcher === api.profiles) {
        return buildUseApiResult({
          currentProfile: 'assistant',
          profiles: ['assistant', 'shared'],
        });
      }

      if (fetcher === api.models) {
        return buildUseApiResult({
          currentModel: 'gpt-5.4',
          currentThinkingLevel: 'medium',
          models: [
            {
              id: 'gpt-5.4',
              provider: 'openai-codex',
              name: 'GPT-5.4',
              context: 200000,
            },
            {
              id: 'qwen-reap',
              provider: 'desktop',
              name: 'Qwen REAP',
              context: 262144,
            },
          ],
        });
      }

      if (fetcher === api.modelProviders) {
        return buildUseApiResult({
          profile: 'assistant',
          filePath: '/tmp/assistant-models.json',
          providers: [
            {
              id: 'desktop',
              baseUrl: 'http://desktop:8000/v1',
              api: 'openai-completions',
              apiKey: 'local-dev',
              authHeader: false,
              headers: undefined,
              compat: undefined,
              modelOverrides: undefined,
              models: [
                {
                  id: 'qwen-reap',
                  name: 'Qwen REAP',
                  api: undefined,
                  baseUrl: undefined,
                  reasoning: true,
                  input: ['text'],
                  contextWindow: 262144,
                  maxTokens: 32768,
                  headers: undefined,
                  cost: undefined,
                  compat: undefined,
                },
              ],
            },
          ],
        });
      }

      if (fetcher === api.vaultRoot) {
        return buildUseApiResult({
          currentRoot: '~/Documents/personal-agent',
          effectiveRoot: '/Users/patrick/Documents/personal-agent',
          defaultRoot: '/Users/patrick/Documents/personal-agent',
          source: 'config',
        });
      }

      if (fetcher === api.defaultCwd) {
        return buildUseApiResult({
          currentCwd: '',
          effectiveCwd: '/Users/patrick/workingdir/personal-agent',
        });
      }

      if (fetcher === api.conversationTitleSettings) {
        return buildUseApiResult({
          enabled: true,
          currentModel: '',
          effectiveModel: 'openai-codex/gpt-5.4',
        });
      }

      if (fetcher === api.status) {
        return buildUseApiResult({
          profile: 'assistant',
          repoRoot: '/Users/patrick/workingdir/personal-agent',
          activityCount: 3,
          projectCount: 5,
          webUiSlot: 'blue',
          webUiRevision: 'abc123',
        });
      }

      if (fetcher === api.providerAuth) {
        return buildUseApiResult({
          authFile: '/tmp/auth.json',
          providers: [
            {
              id: 'openai-codex',
              modelCount: 12,
              authType: 'oauth',
              hasStoredCredential: true,
              apiKeySupported: false,
              oauthSupported: true,
              oauthProviderName: 'OpenAI',
              oauthUsesCallbackServer: true,
            },
          ],
        });
      }

      if (key?.startsWith('codex-plan-usage:')) {
        return buildUseApiResult({
          available: true,
          planType: 'pro',
          fiveHour: {
            remainingPercent: 72,
            usedPercent: 28,
            windowMinutes: 300,
            resetsAt: '2026-03-28T05:00:00.000Z',
          },
          weekly: {
            remainingPercent: 84,
            usedPercent: 16,
            windowMinutes: 10080,
            resetsAt: '2026-04-04T00:00:00.000Z',
          },
          credits: {
            hasCredits: true,
            unlimited: false,
            balance: '$20.00',
          },
          updatedAt: '2026-03-28T00:15:00.000Z',
          error: null,
        });
      }

      if (key === 'system-companion-auth') {
        return buildUseApiResult({
          sessions: [],
          pendingPairings: [],
        });
      }

      throw new Error(`Unexpected SettingsPage useApi call for key ${key ?? '<none>'}`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('renders the condensed single-page settings view', () => {
    const html = renderPage('/settings');

    expect(html).toContain('ui-page-title">Settings</h1>');
    expect(html).toContain('Theme');
    expect(html).toContain('Profile');
    expect(html).toContain('Default model');
    expect(html).toContain('Provider &amp; model definitions');
    expect(html).toContain('Operational overview');
    expect(html).toContain('Web UI');
    expect(html).toContain('Daemon');
    expect(html).toContain('Repo root');
  });

  it('renders the same consolidated settings page for legacy query routes', () => {
    const html = renderPage('/settings?page=system-daemon');

    expect(html).toContain('ui-page-title">Settings</h1>');
    expect(html).toContain('Operational overview');
    expect(html).toContain('Restart daemon');
    expect(html).toContain('Provider credentials');
    expect(html).not.toContain('Related Views');
  });
});
