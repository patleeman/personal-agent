import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../client/api';
import { useApi } from '../hooks';
import { useSseConnection, useSystemStatus } from '../app/contexts';
import { useTheme } from '../ui-state/theme';
import { SettingsPage } from './SettingsPage.js';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

vi.mock('../app/contexts', () => ({
  useSseConnection: vi.fn(),
  useSystemStatus: vi.fn(),
}));

vi.mock('../ui-state/theme', () => ({
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
          tailscaleServe: false,
          resumeFallbackPrompt: 'Continue where you left off.',
          deployment: {
            stablePort: 3000,
            activeRelease: {
              distDir: '/Users/patrick/workingdir/personal-agent/packages/web/dist',
              serverDir: '/Users/patrick/workingdir/personal-agent/packages/web/dist-server',
              serverEntryFile: '/Users/patrick/workingdir/personal-agent/packages/web/dist-server/index.js',
              sourceRepoRoot: '/Users/patrick/workingdir/personal-agent',
              revision: 'abc123',
            },
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
      if (fetcher === api.skillFolders) {
        return buildUseApiResult({
          configFile: '/tmp/config.json',
          skillDirs: ['/Users/patrick/Documents/personal-agent/skills'],
        });
      }

      if (fetcher === api.instructions) {
        return buildUseApiResult({
          configFile: '/tmp/config.json',
          instructionFiles: ['/Users/patrick/Documents/personal-agent/AGENTS.md'],
        });
      }

      if (fetcher === api.models) {
        return buildUseApiResult({
          currentModel: 'gpt-5.4',
          currentThinkingLevel: 'medium',
          currentServiceTier: '',
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

      if (fetcher === api.tools) {
        return buildUseApiResult({
          profile: 'assistant',
          tools: [],
          toolsets: [],
          dependentCliTools: [],
          mcp: {
            configPath: '/tmp/mcp_servers.json',
            configExists: true,
            searchedPaths: ['/tmp/mcp_servers.json'],
            servers: [
              {
                name: 'atlassian',
                transport: 'remote',
                args: [],
                url: 'https://mcp.atlassian.com/v1/mcp',
                source: 'skill',
                sourcePath: '/vault/skills/dd-atlassian-mcp/mcp.json',
                skillName: 'dd-atlassian-mcp',
                skillPath: '/vault/skills/dd-atlassian-mcp',
                manifestPath: '/vault/skills/dd-atlassian-mcp/mcp.json',
                hasOAuth: true,
                callbackUrl: 'http://localhost:3118/callback',
                authorizeResource: 'https://datadoghq.atlassian.net/',
                raw: {},
              },
              {
                name: 'github',
                transport: 'stdio',
                command: 'npx',
                args: ['@mcp/github'],
                source: 'config',
                sourcePath: '/tmp/mcp_servers.json',
                hasOAuth: false,
                raw: {},
              },
            ],
            bundledSkills: [
              {
                skillName: 'dd-atlassian-mcp',
                skillPath: '/vault/skills/dd-atlassian-mcp',
                manifestPath: '/vault/skills/dd-atlassian-mcp/mcp.json',
                serverNames: ['atlassian'],
                overriddenServerNames: [],
              },
            ],
          },
          packageInstall: {
            currentProfile: 'assistant',
            profileTargets: [],
            localTarget: {
              target: 'local',
              settingsPath: '/tmp/packages.json',
              packages: [],
            },
          },
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

      if (fetcher === api.knowledgeBase) {
        return buildUseApiResult({
          repoUrl: 'https://github.com/patleeman/knowledge-base.git',
          branch: 'main',
          configured: true,
          effectiveRoot: '/Users/patrick/Documents/personal-agent',
          managedRoot: '/Users/patrick/.local/state/personal-agent/knowledge-base/repo',
          usesManagedRoot: true,
          syncStatus: 'idle',
          lastSyncAt: '2026-04-16T12:00:00.000Z',
          recoveredEntryCount: 1,
          recoveryDir: '/Users/patrick/.local/state/personal-agent/knowledge-base/recovered',
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
          projectCount: 5,
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

      if (key === 'system-remote-auth') {
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
    vi.unstubAllGlobals();
  });

  it('renders the reorganized single-page settings view', () => {
    const html = renderPage('/settings');

    expect(html).toContain('ui-page-title');
    expect(html).toContain('>Settings<');
    expect(html).toContain('aria-label="Settings sections"');
    expect(html.indexOf('href="#settings-appearance"')).toBeLessThan(html.indexOf('href="#settings-general"'));
    expect(html.indexOf('href="#settings-general"')).toBeLessThan(html.indexOf('href="#settings-providers"'));
    expect(html).toContain('Theme');
    expect(html).toContain('Skill folders');
    expect(html).toContain('Knowledge base');
    expect(html).toContain('/Users/patrick/.local/state/personal-agent/knowledge-base/repo');
    expect(html).toContain('Bundled MCP wrappers');
    expect(html).toContain('Bundled with dd-atlassian-mcp');
    expect(html).toContain('Callback');
    expect(html).toContain('http://localhost:3118/callback');
    expect(html).toContain('Manifest');
    expect(html).toContain('AGENTS.md files');
    expect(html).toContain('Default model');
    expect(html).toContain('Provider &amp; model definitions');
    expect(html).not.toContain('Runtime services');
    expect(html).not.toContain('Operational overview');
    expect(html).not.toContain('Web UI');
    expect(html).not.toContain('Daemon');
    expect(html).toContain('Theme and other visual preferences for the web UI.');
    expect(html).toContain('Load extra skill folders alongside the root skills directory.');
    expect(html).toContain('Append extra AGENTS.md-style files to the runtime prompt.');
    expect(html).toContain('Leave blank to use the runtime process cwd.');
    expect(html).toContain('aria-label="Choose indexed root"');
    expect(html).toContain('aria-label="Choose default working directory"');
    expect(html).not.toContain('Repo root');
  });

  it('renders the same consolidated settings page for legacy query routes', () => {
    const html = renderPage('/settings?page=system-daemon');

    expect(html).toContain('ui-page-title');
    expect(html).toContain('>Settings<');
    expect(html).not.toContain('Runtime services');
    expect(html).not.toContain('Operational overview');
    expect(html).not.toContain('Restart daemon');
    expect(html).toContain('Provider credentials');
    expect(html).not.toContain('Related Views');
  });

  it('shows a desktop bridge warning instead of hiding desktop connections when preload is unavailable', () => {
    vi.stubGlobal('window', {
      personalAgentDesktop: undefined,
      location: { search: '' },
      sessionStorage: {
        getItem: () => null,
      },
    });
    vi.stubGlobal('document', {
      documentElement: { dataset: {} },
    });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Electron/31.0.2',
    });

    const html = renderPage('/settings');

    expect(html).toContain('Desktop');
    expect(html).toContain('Desktop bridge unavailable. Restart the desktop app and try again.');
  });
});
