// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../client/api';
import { useApi } from '../hooks/useApi';
import { useAppEvents, useSseConnection } from '../app/contexts';
import { useTheme } from '../ui-state/theme';
import { SettingsPage } from './SettingsPage';

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

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];

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

function renderPage() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });

  mountedRoots.push(root);
  return { container };
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function queryButton(container: HTMLElement, label: string, index = 0): HTMLButtonElement {
  const matches = Array.from(container.querySelectorAll('button')).filter((node) => node.textContent?.trim() === label);
  const button = matches[index];
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected button ${label} at index ${index}`);
  }
  return button;
}

function queryInput(container: HTMLElement, selector: string): HTMLInputElement {
  const input = container.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Expected input for selector ${selector}`);
  }
  return input;
}

function querySelect(container: HTMLElement, selector: string): HTMLSelectElement {
  const select = container.querySelector(selector);
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`Expected select for selector ${selector}`);
  }
  return select;
}

function click(button: HTMLButtonElement) {
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function updateInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (!descriptor?.set) {
    throw new Error('Expected HTMLInputElement value setter');
  }

  act(() => {
    descriptor.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function updateSelectValue(select: HTMLSelectElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (!descriptor?.set) {
    throw new Error('Expected HTMLSelectElement value setter');
  }

  act(() => {
    descriptor.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('SettingsPage provider model editor', () => {
  let saveModelProviderModelMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    saveModelProviderModelMock = vi.spyOn(api, 'saveModelProviderModel');
    vi.clearAllMocks();

    vi.mocked(useTheme).mockReturnValue({
      theme: 'dark',
      themePreference: 'system',
      setThemePreference: vi.fn(),
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

    const skillFoldersResult = buildUseApiResult({
      configFile: '/tmp/config.json',
      skillDirs: ['/Users/patrick/Documents/personal-agent/skills'],
    });
    const instructionsResult = buildUseApiResult({
      configFile: '/tmp/config.json',
      instructionFiles: ['/Users/patrick/Documents/personal-agent/AGENTS.md'],
    });
    const modelsResult = buildUseApiResult({
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
    const toolsResult = buildUseApiResult({
      profile: 'assistant',
      tools: [],
      toolsets: [],
      dependentCliTools: [],
      mcp: {
        configPath: '/tmp/mcp_servers.json',
        configExists: true,
        searchedPaths: ['/tmp/mcp_servers.json'],
        servers: [],
        bundledSkills: [],
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
    const modelProvidersResult = buildUseApiResult({
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
    const vaultRootResult = buildUseApiResult({
      currentRoot: '~/Documents/personal-agent',
      effectiveRoot: '/Users/patrick/Documents/personal-agent',
      defaultRoot: '/Users/patrick/Documents/personal-agent',
      source: 'config',
    });
    const knowledgeBaseResult = buildUseApiResult({
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
    const defaultCwdResult = buildUseApiResult({
      currentCwd: '',
      effectiveCwd: '/Users/patrick/workingdir/personal-agent',
    });
    const conversationTitleSettingsResult = buildUseApiResult({
      enabled: true,
      currentModel: '',
      effectiveModel: 'openai-codex/gpt-5.4',
    });
    const statusResult = buildUseApiResult({
      profile: 'assistant',
      repoRoot: '/Users/patrick/workingdir/personal-agent',
      projectCount: 5,
      appRevision: 'abc123',
    });
    const providerAuthResult = buildUseApiResult({
      authFile: '/tmp/auth.json',
      providers: [
        {
          id: 'anthropic',
          modelCount: 3,
          authType: 'none',
          hasStoredCredential: false,
          apiKeySupported: true,
          oauthSupported: false,
          oauthProviderName: '',
          oauthUsesCallbackServer: false,
        },
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
    const remoteAuthResult = buildUseApiResult({
      sessions: [],
      pendingPairings: [],
    });

    vi.mocked(useApi).mockImplementation((fetcher, key) => {
      if (fetcher === api.skillFolders) {
        return skillFoldersResult;
      }

      if (fetcher === api.instructions) {
        return instructionsResult;
      }

      if (fetcher === api.models) {
        return modelsResult;
      }

      if (fetcher === api.tools) {
        return toolsResult;
      }

      if (fetcher === api.modelProviders) {
        return modelProvidersResult;
      }

      if (fetcher === api.vaultRoot) {
        return vaultRootResult;
      }

      if (fetcher === api.knowledgeBase) {
        return knowledgeBaseResult;
      }

      if (fetcher === api.defaultCwd) {
        return defaultCwdResult;
      }

      if (fetcher === api.conversationTitleSettings) {
        return conversationTitleSettingsResult;
      }

      if (fetcher === api.status) {
        return statusResult;
      }

      if (fetcher === api.providerAuth) {
        return providerAuthResult;
      }

      if (key === 'system-remote-auth') {
        return remoteAuthResult;
      }

      throw new Error(`Unexpected SettingsPage useApi call for key ${key ?? '<none>'}`);
    });

    saveModelProviderModelMock.mockResolvedValue({
      profile: 'assistant',
      filePath: '/tmp/assistant-models.json',
      providers: [
        {
          id: 'anthropic',
          baseUrl: undefined,
          api: undefined,
          apiKey: undefined,
          authHeader: false,
          headers: undefined,
          compat: undefined,
          modelOverrides: undefined,
          models: [
            {
              id: 'claude-sonnet-4-7',
              name: undefined,
              api: undefined,
              baseUrl: undefined,
              reasoning: false,
              input: ['text'],
              contextWindow: 128000,
              maxTokens: 16384,
              headers: undefined,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
              compat: undefined,
            },
          ],
        },
      ],
    });
  });

  afterEach(() => {
    saveModelProviderModelMock.mockRestore();
    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
  });

  it('adds a model directly to a picked built-in provider without saving the provider first', async () => {
    const { container } = renderPage();
    await flushAsyncWork();

    click(queryButton(container, 'New provider'));
    updateSelectValue(querySelect(container, '#settings-model-provider-existing'), 'anthropic');

    expect(queryInput(container, '#settings-model-provider-id').value).toBe('anthropic');
    expect(container.textContent).toContain('Saving a model creates that provider entry in models.json immediately.');

    click(queryButton(container, 'Add model'));
    const modelIdInput = queryInput(container, '#settings-provider-model-id');
    updateInputValue(modelIdInput, 'claude-sonnet-4-7');
    await flushAsyncWork();

    const modelForm = modelIdInput.closest('form');
    if (!(modelForm instanceof HTMLFormElement)) {
      throw new Error('Expected model editor form');
    }

    act(() => {
      modelForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flushAsyncWork();

    expect(saveModelProviderModelMock).toHaveBeenCalledWith('anthropic', expect.objectContaining({
      modelId: 'claude-sonnet-4-7',
    }));
  });
});
