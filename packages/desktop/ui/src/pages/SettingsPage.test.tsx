import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppEvents, useSseConnection } from '../app/contexts';
import { api } from '../client/api';
import { useApi } from '../hooks/useApi';
import { useTheme } from '../ui-state/theme';
import { SettingsPage } from './SettingsPage.js';

vi.mock('../hooks/useApi', () => ({
  useApi: vi.fn(),
}));

vi.mock('../app/contexts', () => ({
  useAppEvents: vi.fn(),
  useSseConnection: vi.fn(),
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
      theme: 'tokyo-night-dark',
      themePreference: 'system',
      lightTheme: 'tokyo-night-light',
      darkTheme: 'tokyo-night-dark',
      availableThemes: [
        { id: 'tokyo-night-light', label: 'Tokyo Night Light', appearance: 'light' },
        { id: 'tokyo-night-dark', label: 'Tokyo Night Dark', appearance: 'dark' },
      ],
      setThemePreference: vi.fn(),
      setLightTheme: vi.fn(),
      setDarkTheme: vi.fn(),
      toggle: vi.fn(),
    });

    vi.mocked(useSseConnection).mockReturnValue({
      status: 'open',
    });

    vi.mocked(useAppEvents).mockReturnValue({
      versions: {
        workspace: 1,
        sessions: 1,
        sessionFiles: 1,
        tasks: 1,
        runs: 1,
        daemon: 1,
      },
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
              supportedServiceTiers: ['auto', 'priority'],
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

      if (fetcher === api.knowledgeBase) {
        return buildUseApiResult({
          repoUrl: 'https://github.com/user/knowledge-base.git',
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

      if (fetcher === api.transcriptionSettings) {
        return buildUseApiResult({
          settings: { provider: 'local-whisper', model: 'base.en' },
          providers: [],
        });
      }

      if (fetcher === api.status) {
        return buildUseApiResult({
          profile: 'assistant',
          repoRoot: '/Users/patrick/workingdir/personal-agent',
          projectCount: 5,
          appRevision: 'abc123',
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

      if (fetcher === api.telegramGatewayToken) {
        return buildUseApiResult({ configured: false });
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

    expect(html).toContain('>Settings</h1>');
    expect(html).toContain('aria-label="Settings sections"');
    expect(html.indexOf('href="#settings-appearance"')).toBeLessThan(html.indexOf('href="#settings-conversation"'));
    expect(html.indexOf('href="#settings-conversation"')).toBeLessThan(html.indexOf('href="#settings-workspace"'));
    expect(html.indexOf('href="#settings-workspace"')).toBeLessThan(html.indexOf('href="#settings-dictation"'));
    expect(html.indexOf('href="#settings-dictation"')).toBeLessThan(html.indexOf('href="#settings-skills"'));
    expect(html.indexOf('href="#settings-skills"')).toBeLessThan(html.indexOf('href="#settings-tools"'));
    expect(html.indexOf('href="#settings-tools"')).toBeLessThan(html.indexOf('href="#settings-providers"'));
    expect(html).toContain('Theme');
    expect(html).toContain('Skills');
    expect(html).toContain('Skill folders');
    expect(html).toContain('Knowledge base');
    expect(html).toContain('/Users/patrick/.local/state/personal-agent/knowledge-base/repo');
    expect(html).toContain('In sync · Last synced');
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
    expect(html).toContain('Daemon');
    expect(html).toContain('Loading daemon settings');
    expect(html).toContain('Theme and other visual preferences for the desktop app.');
    expect(html).toContain('Default model, vision model, thinking level, and fast mode for new conversations.');
    expect(html).toContain('Working directory and knowledge base for project context.');
    expect(html).toContain('Skill discovery folders and extra runtime AGENTS.md instructions.');
    expect(html).toContain('MCP wrapper config for skills, explicit tool servers, and runtime tool orchestration.');
    expect(html).toContain('Load extra skill folders alongside the root skills directory.');
    expect(html).toContain('Append extra AGENTS.md-style files to the runtime prompt.');
    expect(html).toContain('Leave blank to use the runtime process cwd.');
    expect(html).not.toContain('Indexed root');
    expect(html).not.toContain('aria-label="Choose indexed root"');
    expect(html).toContain('aria-label="Choose default working directory"');
    expect(html).not.toContain('Repo root');
    expect(html).not.toContain('↻ Refresh');
    expect(html).not.toContain('Appearance, workspace defaults, providers, and local browser state in one place.');
    expect(html).not.toContain('Workspace defaults, knowledge base, and conversation behavior.');
  });

  it('renders a fast mode toggle for models that support priority tier', () => {
    const html = renderPage('/settings');

    expect(html).toContain('id="settings-fast-mode"');
    expect(html).toContain('Fast mode');
    expect(html).toContain('Fast mode is off.');
    expect(html).toContain('type="checkbox"');
  });

  it('renders the same consolidated settings page for legacy query routes', () => {
    const html = renderPage('/settings?page=system-daemon');

    expect(html).toContain('>Settings</h1>');
    expect(html).not.toContain('Runtime services');
    expect(html).not.toContain('Operational overview');
    expect(html).not.toContain('Restart daemon');
    expect(html).toContain('Provider &amp; model definitions');
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
