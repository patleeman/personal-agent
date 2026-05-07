import { describe, expect, it, vi } from 'vitest';

const { mockIpcHandle } = vi.hoisted(() => ({
  mockIpcHandle: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcHandle,
  },
  shell: {
    openPath: vi.fn(),
    openExternal: vi.fn(),
    trashItem: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
    getName: vi.fn().mockReturnValue('Personal Agent'),
    name: 'Personal Agent',
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  session: {
    fromPartition: vi.fn().mockReturnValue({
      protocol: { handle: vi.fn() },
      setProxy: vi.fn(),
    }),
  },
  screen: {
    getAllDisplays: vi.fn().mockReturnValue([]),
  },
}));

import { registerDesktopIpc } from './ipc.js';

function createMockController() {
  return {
    dispatchApiRequest: vi.fn(),
    subscribeApiStream: vi.fn(),
    readLiveSession: vi.fn(),
    readScheduledTasks: vi.fn(),
    createLiveSession: vi.fn(),
    resumeLiveSession: vi.fn(),
    takeOverLiveSession: vi.fn(),
    compactLiveSession: vi.fn(),
    exportLiveSession: vi.fn(),
    reloadLiveSession: vi.fn(),
    destroyLiveSession: vi.fn(),
    branchLiveSession: vi.fn(),
    forkLiveSession: vi.fn(),
    summarizeAndForkLiveSession: vi.fn(),
    abortLiveSession: vi.fn(),
    renameConversation: vi.fn(),
    recoverConversation: vi.fn(),
    markConversationAttention: vi.fn(),
    markDurableRunAttention: vi.fn(),
    openNewConversation: vi.fn(),
    readConversationArtifacts: vi.fn(),
    readConversationCheckpoints: vi.fn(),
    readConversationAttachments: vi.fn(),
    readConversationAttachment: vi.fn(),
    createConversationAttachment: vi.fn(),
    updateConversationAttachment: vi.fn(),
    readConversationAttachmentAsset: vi.fn(),
    readConversationDeferredResumes: vi.fn(),
    scheduleConversationDeferredResume: vi.fn(),
    cancelConversationDeferredResume: vi.fn(),
    fireConversationDeferredResume: vi.fn(),
    readConversationModelPreferences: vi.fn(),
    updateConversationModelPreferences: vi.fn(),
  };
}

describe('registerDesktopIpc', () => {
  it('registers all IPC handlers without throwing', () => {
    expect(() => {
      registerDesktopIpc({
        hostManager: {
          getActiveHostId: () => 'local',
          getActiveHostController: () => createMockController(),
          getHostController: () => createMockController(),
          getHostRecord: (id: string) => ({ id: id ?? 'local', kind: 'local' }),
          getHostBaseUrl: vi.fn().mockResolvedValue('personal-agent://app/'),
          openNewConversation: vi.fn().mockResolvedValue('/conversations/new'),
          openNewConversationInHost: vi.fn(),
        } as never,
        windowController: {
          sendShortcutToFocusedWindow: vi.fn(),
          setWorkbenchBrowserBoundsForWebContents: vi.fn(),
          getWorkbenchBrowserStateForWebContents: vi.fn(),
          navigateWorkbenchBrowserForWebContents: vi.fn(),
          goBackWorkbenchBrowserForWebContents: vi.fn(),
          goForwardWorkbenchBrowserForWebContents: vi.fn(),
          reloadWorkbenchBrowserForWebContents: vi.fn(),
          stopWorkbenchBrowserForWebContents: vi.fn(),
          snapshotWorkbenchBrowserForWebContents: vi.fn(),
          getNavigationStateForWebContents: vi.fn(),
          goBackForWebContents: vi.fn(),
          goForwardForWebContents: vi.fn(),
          handleRendererProcessGone: vi.fn(),
          openConversationPopoutWindow: vi.fn().mockResolvedValue(undefined),
          openMainWindow: vi.fn().mockResolvedValue(undefined),
          openNewWindow: vi.fn().mockResolvedValue(undefined),
          openAbsoluteUrl: vi.fn().mockResolvedValue(undefined),
          getMainWindowRoute: vi.fn().mockReturnValue('/'),
          openHostAbsoluteUrl: vi.fn().mockResolvedValue(undefined),
          snapshotWorkbenchBrowser: vi.fn(),
        } as never,
      });
    }).not.toThrow();
  });

  it('registers at least 100 IPC handlers', () => {
    expect(mockIpcHandle.mock.calls.length).toBeGreaterThanOrEqual(100);
  });

  it('registers a conversation lifecycle handler', () => {
    const calls = mockIpcHandle.mock.calls;
    const conversationHandler = calls.find(
      (call: any[]) => (call[0] as string).includes('conversation') || (call[0] as string).includes('live-session'),
    );
    expect(conversationHandler).toBeDefined();
  });

  it('registers settings-related handlers', () => {
    const calls = mockIpcHandle.mock.calls;
    const hasSettingsHandler = calls.some(
      (call: any[]) => (call[0] as string).includes('preferences') || (call[0] as string).includes('default-cwd'),
    );
    expect(hasSettingsHandler).toBe(true);
  });

  it('registers workbench browser handlers', () => {
    const calls = mockIpcHandle.mock.calls;
    const hasBrowserHandler = calls.some((call: any[]) => (call[0] as string).includes('workbench-browser'));
    expect(hasBrowserHandler).toBe(true);
  });
});
