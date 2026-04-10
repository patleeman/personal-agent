import { describe, expect, it, vi } from 'vitest';
import { buildDesktopTrayMenuTemplate, type DesktopTrayActions } from './tray.js';

function createActions(): DesktopTrayActions {
  return {
    onOpen: vi.fn(),
    onNewConversation: vi.fn(),
    onSettings: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onRestartRuntime: vi.fn(),
    onOpenLogs: vi.fn(),
    onQuit: vi.fn(),
  };
}

describe('buildDesktopTrayMenuTemplate', () => {
  it('shows the connected host when the desktop backend is ready', () => {
    const template = buildDesktopTrayMenuTemplate({
      activeHostLabel: 'Local',
      startupState: { kind: 'ready' },
      actions: createActions(),
    });

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Connected to: Local', enabled: false }),
      expect.objectContaining({ label: 'Show Personal Agent', enabled: true }),
      expect.objectContaining({ label: 'New Conversation', enabled: true }),
      expect.objectContaining({ label: 'Settings…', enabled: true }),
      expect.objectContaining({ label: 'Restart Runtime', enabled: true }),
      expect.objectContaining({ label: 'Quit Personal Agent' }),
    ]));
  });

  it('surfaces startup failures with retry and log actions', () => {
    const template = buildDesktopTrayMenuTemplate({
      activeHostLabel: 'Local',
      startupState: { kind: 'error', message: 'Port 3741 on 127.0.0.1 is already in use.' },
      actions: createActions(),
    });

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Startup failed: Local', enabled: false }),
      expect.objectContaining({ label: 'Port 3741 on 127.0.0.1 is already in use.', enabled: false }),
      expect.objectContaining({ label: 'Retry Personal Agent', enabled: true }),
      expect.objectContaining({ label: 'New Conversation', enabled: false }),
      expect.objectContaining({ label: 'Settings…', enabled: false }),
      expect.objectContaining({ label: 'Restart Runtime', enabled: true }),
      expect.objectContaining({ label: 'Open Desktop Logs' }),
    ]));
  });
});
