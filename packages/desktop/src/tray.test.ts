import { describe, expect, it, vi } from 'vitest';
import type { DesktopWorkspaceServerState } from './hosts/types.js';
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

function createWorkspaceServerState(overrides: Partial<DesktopWorkspaceServerState> = {}): DesktopWorkspaceServerState {
  return {
    enabled: false,
    port: 8390,
    useTailscaleServe: false,
    running: false,
    websocketPath: '/codex',
    localWebsocketUrl: 'ws://127.0.0.1:8390/codex',
    logFile: '/logs/codex-app-server.log',
    ...overrides,
  };
}

describe('buildDesktopTrayMenuTemplate', () => {
  it('shows the remote api status when the desktop backend is ready', () => {
    const template = buildDesktopTrayMenuTemplate({
      activeHostLabel: 'Local',
      startupState: { kind: 'ready' },
      workspaceServerState: createWorkspaceServerState(),
      actions: createActions(),
    });

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Remote API: Off', enabled: false }),
      expect.objectContaining({ label: 'Show Personal Agent', enabled: true }),
      expect.objectContaining({ label: 'New Conversation', enabled: true }),
      expect.objectContaining({ label: 'Settings…', enabled: true }),
      expect.objectContaining({ label: 'Restart Runtime', enabled: true }),
      expect.objectContaining({ label: 'Quit Personal Agent' }),
    ]));
    expect(template.map((item) => item.label)).not.toContain('Connected to: Local');
  });

  it('shows the hosted remote api endpoint when it is serving', () => {
    const template = buildDesktopTrayMenuTemplate({
      activeHostLabel: 'Local',
      startupState: { kind: 'ready' },
      workspaceServerState: createWorkspaceServerState({
        enabled: true,
        running: true,
        useTailscaleServe: true,
        tailnetWebsocketUrl: 'wss://desktop.tailnet.ts.net/codex',
      }),
      actions: createActions(),
    });

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Remote API: On',
        sublabel: 'wss://desktop.tailnet.ts.net/codex',
        enabled: false,
      }),
    ]));
  });

  it('does not show recent conversations anymore', () => {
    const template = buildDesktopTrayMenuTemplate({
      activeHostLabel: 'Local',
      startupState: { kind: 'ready' },
      workspaceServerState: createWorkspaceServerState(),
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

    const labels = template.map((item) => item.label);
    expect(labels).not.toContain('Recent');
    expect(labels).not.toContain('Fix desktop tray menu ordering');
    expect(labels).not.toContain('Review release notes');
    expect(labels).not.toContain('More Conversations…');
  });

  it('surfaces startup failures with retry and log actions', () => {
    const template = buildDesktopTrayMenuTemplate({
      activeHostLabel: 'Local',
      startupState: { kind: 'error', message: 'Port 3741 on 127.0.0.1 is already in use.' },
      workspaceServerState: createWorkspaceServerState(),
      actions: createActions(),
    });

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Remote API: Off', enabled: false }),
      expect.objectContaining({ label: 'Startup failed: Local', enabled: false }),
      expect.objectContaining({ label: 'Port 3741 on 127.0.0.1 is already in use.', enabled: false }),
      expect.objectContaining({ label: 'Retry Personal Agent', enabled: true }),
      expect.objectContaining({ label: 'New Conversation', enabled: false }),
      expect.objectContaining({ label: 'Settings…', enabled: false }),
      expect.objectContaining({ label: 'Restart Runtime', enabled: true }),
      expect.objectContaining({ label: 'Open Desktop Logs' }),
    ]));
  });

  it('uses the current app name for testing launches', () => {
    const template = buildDesktopTrayMenuTemplate({
      appName: 'Personal Agent Testing',
      activeHostLabel: 'Local',
      startupState: { kind: 'ready' },
      workspaceServerState: createWorkspaceServerState(),
      actions: createActions(),
    });

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Show Personal Agent Testing', enabled: true }),
      expect.objectContaining({ label: 'Quit Personal Agent Testing' }),
    ]));
  });
});
