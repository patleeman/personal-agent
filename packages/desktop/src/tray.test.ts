import { describe, expect, it, vi } from 'vitest';
import { buildDesktopTrayMenuTemplate, type DesktopTrayActions } from './tray.js';

function createActions(): DesktopTrayActions {
  return {
    onOpen: vi.fn(),
    onOpenConversation: vi.fn(),
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

  it('shows recent conversations ahead of the main actions', () => {
    const template = buildDesktopTrayMenuTemplate({
      activeHostLabel: 'Local',
      startupState: { kind: 'ready' },
      recentConversationsState: {
        kind: 'ready',
        totalCount: 2,
        conversations: [
          {
            id: 'conversation-2',
            title: 'Fix desktop tray menu ordering',
            cwd: '/Users/patrick/workingdir/personal-agent',
            timestamp: '2026-04-09T10:00:00.000Z',
            lastActivityAt: '2026-04-09T10:05:00.000Z',
            isRunning: true,
          },
          {
            id: 'conversation-1',
            title: 'Review release notes',
            cwd: '/Users/patrick/workingdir/release-notes',
            timestamp: '2026-04-08T10:00:00.000Z',
            needsAttention: true,
          },
        ],
      },
      actions: createActions(),
    });

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Recent', enabled: false }),
      expect.objectContaining({ label: 'Fix desktop tray menu ordering', sublabel: 'personal-agent · running', enabled: true }),
      expect.objectContaining({ label: 'Review release notes', sublabel: 'release-notes · attention', enabled: true }),
      expect.objectContaining({ label: 'Show Personal Agent', enabled: true }),
    ]));
  });

  it('limits the recent conversation section to the top 10 and exposes a more action', () => {
    const template = buildDesktopTrayMenuTemplate({
      activeHostLabel: 'Local',
      startupState: { kind: 'ready' },
      recentConversationsState: {
        kind: 'ready',
        totalCount: 12,
        conversations: Array.from({ length: 10 }, (_, index) => ({
          id: `conversation-${String(index + 1)}`,
          title: `Conversation ${String(index + 1)}`,
          cwd: `/tmp/project-${String(index + 1)}`,
          timestamp: `2026-04-${String(10 - index).padStart(2, '0')}T10:00:00.000Z`,
        })),
      },
      actions: createActions(),
    });

    expect(template.filter((item) => item.label?.startsWith('Conversation '))).toHaveLength(10);
    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Conversation 10' }),
      expect.objectContaining({ label: 'More Conversations…', enabled: true }),
    ]));
    expect(template).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Conversation 11' }),
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
