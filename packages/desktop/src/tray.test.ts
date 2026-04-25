import { describe, expect, it, vi } from 'vitest';
import { buildDesktopTrayMenuTemplate, type DesktopTrayActions } from './tray.js';

function createActions(): DesktopTrayActions {
  return {
    onOpen: vi.fn(),
    onOpenConversation: vi.fn(),
    onNewConversation: vi.fn(),
    onClipUrlFromClipboard: vi.fn(),
    onSettings: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onRestartRuntime: vi.fn(),
    onOpenLogs: vi.fn(),
    onQuit: vi.fn(),
  };
}

describe('buildDesktopTrayMenuTemplate', () => {
  it('shows the ssh-only remote summary when the desktop backend is ready', () => {
    const template = buildDesktopTrayMenuTemplate({
      startupState: { kind: 'ready' },
      actions: createActions(),
    });

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Remote execution: SSH-only', enabled: false }),
      expect.objectContaining({ label: 'Show Personal Agent', enabled: true }),
      expect.objectContaining({ label: 'New Conversation', enabled: true }),
      expect.objectContaining({ label: 'Clip URL from Clipboard', enabled: true }),
      expect.objectContaining({ label: 'Settings…', enabled: true }),
      expect.objectContaining({ label: 'Restart Runtime', enabled: true }),
      expect.objectContaining({ label: 'Quit Personal Agent' }),
    ]));
  });

  it('surfaces startup failures with retry and log actions', () => {
    const template = buildDesktopTrayMenuTemplate({
      startupState: { kind: 'error', message: 'SSH handshake failed.' },
      actions: createActions(),
    });

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Remote execution: SSH-only', enabled: false }),
      expect.objectContaining({ label: 'Startup failed', enabled: false }),
      expect.objectContaining({ label: 'SSH handshake failed.', enabled: false }),
      expect.objectContaining({ label: 'Retry Personal Agent', enabled: true }),
      expect.objectContaining({ label: 'New Conversation', enabled: false }),
      expect.objectContaining({ label: 'Clip URL from Clipboard', enabled: false }),
      expect.objectContaining({ label: 'Settings…', enabled: false }),
      expect.objectContaining({ label: 'Restart Runtime', enabled: true }),
      expect.objectContaining({ label: 'Open Desktop Logs' }),
    ]));
  });

  it('uses the current app name for testing launches', () => {
    const template = buildDesktopTrayMenuTemplate({
      appName: 'Personal Agent Testing',
      startupState: { kind: 'ready' },
      actions: createActions(),
    });

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Show Personal Agent Testing', enabled: true }),
      expect.objectContaining({ label: 'Quit Personal Agent Testing' }),
    ]));
  });
});
