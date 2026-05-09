// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DesktopConnectionsSettingsPanel,
  DesktopKeyboardShortcutsSettingsSection,
} from '../../../../../extensions/system-settings/src/SettingsPage';
import type { PersonalAgentDesktopBridge } from '../desktop/desktopBridge';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const DEFAULT_KEYBOARD_SHORTCUTS = {
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
};

const mountedRoots: Root[] = [];
const mocks = vi.hoisted(() => ({
  getEnvironment: vi.fn(),
  getConnections: vi.fn(),
  readDesktopAppPreferences: vi.fn(),
  updateDesktopAppPreferences: vi.fn(),
  saveHost: vi.fn(),
  deleteHost: vi.fn(),
  testSshConnection: vi.fn(),
}));

function installDesktopBridge() {
  window.personalAgentDesktop = {
    getEnvironment: mocks.getEnvironment,
    getConnections: mocks.getConnections,
    readDesktopAppPreferences: mocks.readDesktopAppPreferences,
    updateDesktopAppPreferences: mocks.updateDesktopAppPreferences,
    saveHost: mocks.saveHost,
    deleteHost: mocks.deleteHost,
    testSshConnection: mocks.testSshConnection,
  } as unknown as PersonalAgentDesktopBridge;
  document.documentElement.dataset.personalAgentDesktop = '1';
}

function renderPanel() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<DesktopConnectionsSettingsPanel />);
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

function queryInput(container: HTMLElement, selector: string): HTMLInputElement {
  const input = container.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Expected input for selector ${selector}`);
  }
  return input;
}

function queryButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.trim() === label);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected button ${label}`);
  }
  return button;
}

function updateInputValue(input: HTMLInputElement, value: string) {
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function click(button: HTMLButtonElement) {
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('DesktopConnectionsSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDesktopBridge();
    mocks.getEnvironment.mockResolvedValue({
      isElectron: true,
      activeHostId: 'local',
      activeHostLabel: 'Local',
      activeHostKind: 'local',
      activeHostSummary: 'Local runtime is healthy.',
    });
    mocks.getConnections.mockResolvedValue({
      hosts: [{ id: 'bender', label: 'Bender', kind: 'ssh', sshTarget: 'user@bender' }],
    });
    mocks.readDesktopAppPreferences.mockResolvedValue({
      available: true,
      supportsStartOnSystemStart: true,
      autoInstallUpdates: true,
      startOnSystemStart: false,
      keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
      update: {
        supported: true,
        status: 'idle',
        currentVersion: '0.3.7',
      },
    });
    mocks.updateDesktopAppPreferences.mockResolvedValue({
      available: true,
      supportsStartOnSystemStart: true,
      autoInstallUpdates: true,
      startOnSystemStart: false,
      keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
      update: {
        supported: true,
        status: 'idle',
        currentVersion: '0.3.7',
      },
    });
    mocks.saveHost.mockResolvedValue({
      hosts: [{ id: 'bender', label: 'Bender', kind: 'ssh', sshTarget: 'user@bender' }],
    });
    mocks.deleteHost.mockResolvedValue({ hosts: [] });
    mocks.testSshConnection.mockResolvedValue({
      ok: true,
      sshTarget: 'user@bender',
      os: 'darwin',
      arch: 'arm64',
      platformKey: 'darwin-arm64',
      homeDirectory: '/Users/patrick',
      tempDirectory: '/var/folders/example/T/',
      cacheDirectory: '/Users/patrick/.cache/personal-agent/ssh-runtime',
      message: 'user@bender is reachable · macOS arm64',
    });
  });

  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
    document.documentElement.dataset.personalAgentDesktop = '';
    delete window.personalAgentDesktop;
  });

  it('tests the current SSH target and renders the probe details', async () => {
    const { container } = renderPanel();
    await flushAsyncWork();

    const sshTargetInput = queryInput(container, '#desktop-host-ssh-target');
    updateInputValue(sshTargetInput, 'user@bender   ');
    click(queryButton(container, 'Test SSH'));
    await flushAsyncWork();

    expect(mocks.testSshConnection).toHaveBeenCalledWith({ sshTarget: 'user@bender' });
    expect(container.textContent).toContain('SSH connection works.');
    expect(container.textContent).toContain('macOS arm64');
    expect(container.textContent).toContain('cache /Users/patrick/.cache/personal-agent/ssh-runtime');
    expect(container.textContent).toContain('home /Users/patrick');
  });
});

describe('DesktopKeyboardShortcutsSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDesktopBridge();
    mocks.readDesktopAppPreferences.mockResolvedValue({
      available: true,
      supportsStartOnSystemStart: true,
      autoInstallUpdates: true,
      startOnSystemStart: false,
      keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
      update: {
        supported: true,
        status: 'idle',
        currentVersion: '0.3.7',
      },
    });
    mocks.updateDesktopAppPreferences.mockImplementation(async (patch) => ({
      available: true,
      supportsStartOnSystemStart: true,
      autoInstallUpdates: true,
      startOnSystemStart: false,
      keyboardShortcuts: {
        ...DEFAULT_KEYBOARD_SHORTCUTS,
        conversationMode: 'F4',
        ...patch.keyboardShortcuts,
      },
      update: {
        supported: true,
        status: 'idle',
        currentVersion: '0.3.7',
      },
    }));
  });

  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
    document.documentElement.dataset.personalAgentDesktop = '';
    delete window.personalAgentDesktop;
  });

  it('captures arbitrary shortcut chords and auto-saves every desktop shortcut', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    act(() => {
      root.render(<DesktopKeyboardShortcutsSettingsSection />);
    });
    await flushAsyncWork();

    const shortcutButton = container.querySelector('#settings-keyboard-conversationMode');
    if (!(shortcutButton instanceof HTMLButtonElement)) {
      throw new Error('Expected conversation mode shortcut capture button');
    }

    act(() => {
      shortcutButton.focus();
      shortcutButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsyncWork();

    act(() => {
      shortcutButton.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'k',
          code: 'KeyK',
          metaKey: true,
          altKey: true,
        }),
      );
    });
    await flushAsyncWork();

    expect(mocks.updateDesktopAppPreferences).toHaveBeenCalledWith({
      keyboardShortcuts: expect.objectContaining({ conversationMode: 'CommandOrControl+Alt+K' }),
    });
    expect(container.textContent).toContain('Show Personal Agent');
    expect(container.textContent).toContain('Find on page');
    expect(container.textContent).not.toContain('Built-in shortcuts');
    expect(container.textContent).not.toContain('Save shortcuts');
  });
});
