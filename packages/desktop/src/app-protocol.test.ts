import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalApiModule } from './local-api-module.js';

const electronMocks = vi.hoisted(() => ({
  registerSchemesAsPrivileged: vi.fn(),
  protocolHandle: vi.fn(),
  partitionProtocolHandle: vi.fn(),
  fromPartition: vi.fn(() => ({
    protocol: {
      handle: electronMocks.partitionProtocolHandle,
    },
  })),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(),
  },
  protocol: {
    registerSchemesAsPrivileged: electronMocks.registerSchemesAsPrivileged,
    handle: electronMocks.protocolHandle,
  },
  session: {
    fromPartition: electronMocks.fromPartition,
  },
}));

import { createDesktopProtocolHandler } from './app-protocol.js';

function createLocalApiModuleMock(overrides: Partial<LocalApiModule> = {}): LocalApiModule {
  return {
    invokeDesktopLocalApi: vi.fn(),
    dispatchDesktopLocalApiRequest: vi.fn(),
    readDesktopModels: vi.fn(),
    updateDesktopModelPreferences: vi.fn(),
    readDesktopModelProviders: vi.fn(),
    saveDesktopModelProvider: vi.fn(),
    deleteDesktopModelProvider: vi.fn(),
    saveDesktopModelProviderModel: vi.fn(),
    deleteDesktopModelProviderModel: vi.fn(),
    readDesktopProviderAuth: vi.fn(),
    readDesktopCodexPlanUsage: vi.fn(),
    setDesktopProviderApiKey: vi.fn(),
    removeDesktopProviderCredential: vi.fn(),
    startDesktopProviderOAuthLogin: vi.fn(),
    readDesktopProviderOAuthLogin: vi.fn(),
    submitDesktopProviderOAuthLoginInput: vi.fn(),
    cancelDesktopProviderOAuthLogin: vi.fn(),
    subscribeDesktopProviderOAuthLogin: vi.fn(),
    readDesktopActivity: vi.fn(),
    readDesktopActivityById: vi.fn(),
    markDesktopActivityRead: vi.fn(),
    clearDesktopInbox: vi.fn(),
    startDesktopActivityConversation: vi.fn(),
    markDesktopConversationAttention: vi.fn(),
    readDesktopAlerts: vi.fn(),
    acknowledgeDesktopAlert: vi.fn(),
    dismissDesktopAlert: vi.fn(),
    snoozeDesktopAlert: vi.fn(),
    readDesktopScheduledTasks: vi.fn(),
    readDesktopScheduledTaskDetail: vi.fn(),
    readDesktopScheduledTaskLog: vi.fn(),
    createDesktopScheduledTask: vi.fn(),
    updateDesktopScheduledTask: vi.fn(),
    runDesktopScheduledTask: vi.fn(),
    readDesktopDurableRuns: vi.fn(),
    readDesktopDurableRun: vi.fn(),
    readDesktopDurableRunLog: vi.fn(),
    cancelDesktopDurableRun: vi.fn(),
    readDesktopConversationBootstrap: vi.fn(),
    renameDesktopConversation: vi.fn(),
    changeDesktopConversationCwd: vi.fn(),
    recoverDesktopConversation: vi.fn(),
    readDesktopConversationModelPreferences: vi.fn(),
    updateDesktopConversationModelPreferences: vi.fn(),
    readDesktopLiveSession: vi.fn(),
    readDesktopLiveSessionForkEntries: vi.fn(),
    readDesktopLiveSessionContext: vi.fn(),
    readDesktopSessionDetail: vi.fn(),
    readDesktopSessionBlock: vi.fn(),
    createDesktopLiveSession: vi.fn(),
    resumeDesktopLiveSession: vi.fn(),
    submitDesktopLiveSessionPrompt: vi.fn(),
    takeOverDesktopLiveSession: vi.fn(),
    restoreDesktopQueuedLiveSessionMessage: vi.fn(),
    compactDesktopLiveSession: vi.fn(),
    reloadDesktopLiveSession: vi.fn(),
    destroyDesktopLiveSession: vi.fn(),
    branchDesktopLiveSession: vi.fn(),
    forkDesktopLiveSession: vi.fn(),
    summarizeAndForkDesktopLiveSession: vi.fn(),
    abortDesktopLiveSession: vi.fn(),
    subscribeDesktopLocalApiStream: vi.fn(),
    subscribeDesktopAppEvents: vi.fn(),
    ...overrides,
  } as LocalApiModule;
}

describe('createDesktopProtocolHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serves local conversation resources through the in-process API dispatcher', async () => {
    const dispatchDesktopLocalApiRequest = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'private, max-age=3600',
      },
      body: Uint8Array.from([1, 2, 3, 4]),
    });
    const handler = createDesktopProtocolHandler({
      loadLocalApiModule: vi.fn().mockResolvedValue(createLocalApiModuleMock({
        dispatchDesktopLocalApiRequest,
      })),
    });

    const response = await handler(new Request('personal-agent://app/api/sessions/conversation-1/blocks/block-1/image'));

    expect(dispatchDesktopLocalApiRequest).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/sessions/conversation-1/blocks/block-1/image',
      body: undefined,
      headers: {},
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3, 4]));
  });

  it('parses JSON bodies for local live-session mutations', async () => {
    const dispatchDesktopLocalApiRequest = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: Buffer.from(JSON.stringify({ ok: true }), 'utf-8'),
    });
    const handler = createDesktopProtocolHandler({
      loadLocalApiModule: vi.fn().mockResolvedValue(createLocalApiModuleMock({
        dispatchDesktopLocalApiRequest,
      })),
    });

    const response = await handler(new Request('personal-agent://app/api/live-sessions/live-1', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ surfaceId: 'surface-1' }),
    }));

    expect(dispatchDesktopLocalApiRequest).toHaveBeenCalledWith({
      method: 'DELETE',
      path: '/api/live-sessions/live-1',
      body: { surfaceId: 'surface-1' },
      headers: {
        'content-type': 'application/json',
      },
    });
    expect(await response.json()).toEqual({ ok: true });
  });
});
