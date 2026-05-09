// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPage } from '../../../../../extensions/system-settings/src/SettingsPage';
import { useAppEvents, useSseConnection } from '../app/contexts';
import { api } from '../client/api';
import { useApi } from '../hooks/useApi';
import { useTheme } from '../ui-state/theme';

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

function queryProviderPicker(container: HTMLElement): HTMLSelectElement {
  const picker = Array.from(container.querySelectorAll('select')).find((select) => select.textContent?.includes('Choose provider…'));
  if (!(picker instanceof HTMLSelectElement)) {
    throw new Error('Expected provider picker');
  }
  return picker;
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
  let updateModelPreferencesMock: ReturnType<typeof vi.spyOn>;
  let startProviderOAuthLoginMock: ReturnType<typeof vi.spyOn>;
  let removeProviderCredentialMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    saveModelProviderModelMock = vi.spyOn(api, 'saveModelProviderModel');
    updateModelPreferencesMock = vi.spyOn(api, 'updateModelPreferences');
    startProviderOAuthLoginMock = vi.spyOn(api, 'startProviderOAuthLogin');
    removeProviderCredentialMock = vi.spyOn(api, 'removeProviderCredential');
    vi.clearAllMocks();

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
      currentVisionModel: '',
      currentThinkingLevel: 'medium',
      currentServiceTier: '',
      models: [
        {
          id: 'gpt-5.4',
          provider: 'openai-codex',
          name: 'GPT-5.4',
          context: 200000,
          input: ['text', 'image'],
          supportedServiceTiers: ['auto', 'priority'],
        },
        {
          id: 'qwen-reap',
          provider: 'desktop',
          name: 'Qwen REAP',
          context: 262144,
          input: ['text'],
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
    const defaultCwdResult = buildUseApiResult({
      currentCwd: '',
      effectiveCwd: '/Users/patrick/workingdir/personal-agent',
    });
    const conversationTitleSettingsResult = buildUseApiResult({
      enabled: true,
      currentModel: '',
      effectiveModel: 'openai-codex/gpt-5.4',
    });
    const transcriptionSettingsResult = buildUseApiResult({
      settings: {
        provider: 'local-whisper',
        model: 'base.en',
      },
      providers: [],
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

      if (fetcher === api.defaultCwd) {
        return defaultCwdResult;
      }

      if (fetcher === api.conversationTitleSettings) {
        return conversationTitleSettingsResult;
      }

      if (fetcher === api.transcriptionSettings) {
        return transcriptionSettingsResult;
      }

      if (fetcher === api.status) {
        return statusResult;
      }

      if (fetcher === api.providerAuth) {
        return providerAuthResult;
      }

      if (fetcher === api.telegramGatewayToken) {
        return buildUseApiResult({ configured: false });
      }

      if (key === 'system-remote-auth') {
        return remoteAuthResult;
      }

      if (key === 'knowledge-settings-knowledge-base') {
        return buildUseApiResult({ configured: false, repoUrl: '', branch: 'main', status: 'idle' });
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
    updateModelPreferencesMock.mockRestore();
    startProviderOAuthLoginMock.mockRestore();
    removeProviderCredentialMock.mockRestore();
    delete (window as { personalAgentDesktop?: unknown }).personalAgentDesktop;
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

    updateSelectValue(queryProviderPicker(container), 'anthropic');
    click(queryButton(container, 'Continue'));

    expect(container.textContent).toContain('Provider · anthropic');
    expect(container.textContent).toContain('Additional models');

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

    expect(saveModelProviderModelMock).toHaveBeenCalledWith(
      'anthropic',
      expect.objectContaining({
        modelId: 'claude-sonnet-4-7',
      }),
    );
  });

  it('opens OAuth login URLs through the desktop shell bridge', async () => {
    const openExternalUrl = vi.fn().mockResolvedValue({ url: 'https://auth.openai.com/oauth', opened: true });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({ isElectron: false, activeHostKind: 'local' }),
        readDesktopAppPreferences: vi.fn().mockResolvedValue({
          available: true,
          supportsStartOnSystemStart: true,
          autoInstallUpdates: false,
          startOnSystemStart: false,
          keyboardShortcuts: {
            showApp: 'CommandOrControl+Shift+A',
            newConversation: 'CommandOrControl+N',
            closeTab: 'CommandOrControl+W',
            reopenClosedTab: 'Command+Shift+N',
            previousConversation: 'CommandOrControl+[',
            nextConversation: 'CommandOrControl+]',
            togglePinned: 'CommandOrControl+Alt+P',
            archiveRestoreConversation: 'CommandOrControl+Alt+A',
            renameConversation: 'CommandOrControl+Alt+R',
            focusComposer: 'CommandOrControl+L',
            editWorkingDirectory: 'CommandOrControl+Shift+L',
            findOnPage: 'CommandOrControl+F',
            settings: 'CommandOrControl+,',
            quit: 'CommandOrControl+Q',
            conversationMode: 'F1',
            workbenchMode: 'F2',
            toggleSidebar: 'CommandOrControl+/',
            toggleRightRail: 'CommandOrControl+\\',
          },
          update: { supported: false, status: 'idle', currentVersion: '0.0.0' },
        }),
        updateDesktopAppPreferences: vi.fn(),
        startProviderOAuthLogin: vi.fn(),
        subscribeProviderOAuthLogin: vi.fn().mockResolvedValue({ subscriptionId: 'oauth-sub-1' }),
        unsubscribeProviderOAuthLogin: vi.fn().mockResolvedValue(undefined),
        openExternalUrl,
      },
    });
    startProviderOAuthLoginMock.mockResolvedValue({
      id: 'login-1',
      provider: 'openai-codex',
      providerName: 'OpenAI',
      status: 'running',
      authUrl: 'https://auth.openai.com/oauth',
      authInstructions: 'A browser window should open.',
      prompt: null,
      progress: [],
      error: '',
      createdAt: '2026-05-07T00:00:00.000Z',
      updatedAt: '2026-05-07T00:00:00.000Z',
    });

    const { container } = renderPage();
    await flushAsyncWork();

    const providerButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('openai-codex'));
    if (!(providerButton instanceof HTMLButtonElement)) {
      throw new Error('Expected openai-codex provider button');
    }
    click(providerButton);
    await flushAsyncWork();

    const oauthButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Start OAuth login'),
    );
    if (!(oauthButton instanceof HTMLButtonElement)) {
      throw new Error('Expected OAuth login button');
    }
    click(oauthButton);
    await flushAsyncWork();

    expect(startProviderOAuthLoginMock).toHaveBeenCalledWith('openai-codex');
    expect(openExternalUrl).toHaveBeenCalledWith('https://auth.openai.com/oauth');
  });

  it('removes a stored provider credential from the provider editor', async () => {
    const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true);
    removeProviderCredentialMock.mockResolvedValue({
      authFile: '/tmp/auth.json',
      providers: [
        {
          id: 'openai-codex',
          modelCount: 12,
          authType: 'none',
          hasStoredCredential: false,
          apiKeySupported: false,
          oauthSupported: true,
          oauthProviderName: 'OpenAI',
          oauthUsesCallbackServer: true,
        },
      ],
    });

    try {
      const { container } = renderPage();
      await flushAsyncWork();

      const providerButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('openai-codex'),
      );
      if (!(providerButton instanceof HTMLButtonElement)) {
        throw new Error('Expected openai-codex provider button');
      }
      click(providerButton);
      await flushAsyncWork();

      const removeButton = queryButton(container, 'Remove stored credential');
      expect(removeButton.disabled).toBe(false);
      click(removeButton);
      await flushAsyncWork();

      expect(confirmMock).toHaveBeenCalledWith('Remove the stored credential for openai-codex from auth.json?');
      expect(removeProviderCredentialMock).toHaveBeenCalledWith('openai-codex');
    } finally {
      confirmMock.mockRestore();
    }
  });

  it('opens known providers from the preconfigured provider picker', async () => {
    const { container } = renderPage();
    await flushAsyncWork();

    expect(container.textContent).toContain('Add provider');

    updateSelectValue(queryProviderPicker(container), 'anthropic');
    click(queryButton(container, 'Continue'));

    expect(container.querySelector('#settings-model-provider-id')).toBeNull();
    expect(container.textContent).toContain('Provider · anthropic');
  });

  it('renders the vision model selector with image-capable models', async () => {
    const { container } = renderPage();
    await flushAsyncWork();

    const visionSelect = container.querySelector<HTMLSelectElement>('#settings-vision-model');
    expect(visionSelect).toBeTruthy();
    expect(visionSelect!.disabled).toBe(false);
    expect(visionSelect!.value).toBe('');
    expect(container.textContent).toContain('Vision model for text-only chats');
    expect(container.textContent).toContain('Not configured');
    expect(container.textContent).toContain('GPT-5.4');
    expect(container.textContent).toContain('Required before text-only models can inspect uploaded images.');
  });

  it('shows the configured vision model label when a vision model is selected', async () => {
    // Set currentVisionModel so the page shows which model is being used
    const modelsWithVision = buildUseApiResult({
      currentModel: 'gpt-5.4',
      currentVisionModel: 'openai-codex/gpt-5.4',
      currentThinkingLevel: 'medium',
      currentServiceTier: '',
      models: [
        {
          id: 'gpt-5.4',
          provider: 'openai-codex',
          name: 'GPT-5.4',
          context: 200000,
          input: ['text', 'image'],
          supportedServiceTiers: ['auto', 'priority'],
        },
      ],
    });

    const fallbackImpl = vi.mocked(useApi).getMockImplementation()!;
    vi.mocked(useApi).mockImplementation((fetcher, _key) => {
      if (fetcher === api.models) {
        return modelsWithVision;
      }
      // Return empty defaults for everything else to keep the page rendering
      return buildUseApiResult(Array.isArray(null) ? [] : null);
    });

    const { container } = renderPage();
    await flushAsyncWork();

    const visionSelect = container.querySelector<HTMLSelectElement>('#settings-vision-model');
    expect(visionSelect).toBeTruthy();
    expect(visionSelect!.value).toBe('openai-codex/gpt-5.4');
    expect(container.textContent).toContain('Text-only image probing uses');

    vi.mocked(useApi).mockImplementation(fallbackImpl);
  });

  it('calls updateModelPreferences when vision model is changed', async () => {
    updateModelPreferencesMock.mockResolvedValue(undefined);

    const { container } = renderPage();
    await flushAsyncWork();

    const visionSelect = container.querySelector<HTMLSelectElement>('#settings-vision-model');
    expect(visionSelect).toBeTruthy();

    updateSelectValue(visionSelect!, 'openai-codex/gpt-5.4');
    await flushAsyncWork();

    expect(updateModelPreferencesMock).toHaveBeenCalledWith({
      visionModel: 'openai-codex/gpt-5.4',
    });
  });
});
