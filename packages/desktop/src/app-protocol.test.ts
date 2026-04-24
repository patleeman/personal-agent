import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalApiModule } from './local-api-module.js';

const electronMocks = vi.hoisted(() => ({
  registerSchemesAsPrivileged: vi.fn(),
  protocolHandle: vi.fn(),
  partitionProtocolHandle: vi.fn(),
  partitionSetProxy: vi.fn().mockResolvedValue(undefined),
  fromPartition: vi.fn(() => ({
    protocol: {
      handle: electronMocks.partitionProtocolHandle,
    },
    setProxy: electronMocks.partitionSetProxy,
  })),
}));

const daemonMocks = vi.hoisted(() => ({
  loadDaemonConfig: vi.fn(() => ({
    companion: {
      host: '127.0.0.1',
      port: 3843,
    },
  })),
  getDaemonClientTransportOverride: vi.fn(() => undefined),
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

vi.mock('@personal-agent/daemon', () => ({
  loadDaemonConfig: daemonMocks.loadDaemonConfig,
  getDaemonClientTransportOverride: daemonMocks.getDaemonClientTransportOverride,
}));

import { createDesktopProtocolHandler, ensureDesktopAppProtocolForHost } from './app-protocol.js';

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
    setDesktopProviderApiKey: vi.fn(),
    removeDesktopProviderCredential: vi.fn(),
    startDesktopProviderOAuthLogin: vi.fn(),
    readDesktopProviderOAuthLogin: vi.fn(),
    submitDesktopProviderOAuthLoginInput: vi.fn(),
    cancelDesktopProviderOAuthLogin: vi.fn(),
    subscribeDesktopProviderOAuthLogin: vi.fn(),
    markDesktopConversationAttention: vi.fn(),
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
    electronMocks.partitionSetProxy.mockResolvedValue(undefined);
    daemonMocks.loadDaemonConfig.mockReturnValue({
      companion: {
        host: '127.0.0.1',
        port: 3843,
      },
    });
    daemonMocks.getDaemonClientTransportOverride.mockReturnValue(undefined);
  });

  it('configures the local desktop partition to bypass proxy resolution', () => {
    ensureDesktopAppProtocolForHost({} as never, 'local');

    expect(electronMocks.partitionSetProxy).toHaveBeenCalledWith({ mode: 'direct' });
  });

  it('does not force direct proxy mode for non-local host partitions', () => {
    ensureDesktopAppProtocolForHost({} as never, 'remote-host');

    expect(electronMocks.partitionSetProxy).not.toHaveBeenCalled();
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

  it('routes remote-target live-session prompts through the linked remote host', async () => {
    const localDispatch = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: Buffer.from(JSON.stringify({
        id: 'conversation-1',
        file: '/tmp/conversation-1.jsonl',
        remoteHostId: 'bender',
        remoteHostLabel: 'Bender',
        remoteConversationId: 'remote-thread-1',
      }), 'utf-8'),
    });
    const remoteDispatch = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: Buffer.from(JSON.stringify({ ok: true, accepted: true, delivery: 'started' }), 'utf-8'),
    });
    const handler = createDesktopProtocolHandler({
      hostManager: {
        getHostController: (hostId: string) => {
          if (hostId === 'local') {
            return {
              dispatchApiRequest: localDispatch,
              subscribeApiStream: vi.fn(),
              readSessionMeta: vi.fn().mockResolvedValue({
                id: 'conversation-1',
                file: '/tmp/conversation-1.jsonl',
                remoteHostId: 'bender',
                remoteHostLabel: 'Bender',
                remoteConversationId: 'remote-thread-1',
              }),
            };
          }

          return {
            dispatchApiRequest: remoteDispatch,
            subscribeApiStream: vi.fn(),
          };
        },
      } as never,
      hostId: 'local',
    });

    const response = await handler(new Request('personal-agent://app/api/live-sessions/conversation-1/prompt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'continue remotely' }),
    }));

    expect(localDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ path: '/api/live-sessions/conversation-1/prompt' }));
    expect(remoteDispatch).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      path: '/api/live-sessions/remote-thread-1/prompt',
      body: { text: 'continue remotely' },
    }));
    expect(await response.json()).toEqual({ ok: true, accepted: true, delivery: 'started' });
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

  it('routes readonly knowledge api reads through the worker dispatcher on the local host', async () => {
    const dispatchReadonlyLocalApiRequest = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: Buffer.from(JSON.stringify({ root: '/vault', files: [] }), 'utf-8'),
    });
    const dispatchApiRequest = vi.fn();
    const handler = createDesktopProtocolHandler({
      dispatchReadonlyLocalApiRequest,
      hostManager: {
        getHostController: () => ({
          dispatchApiRequest,
          subscribeApiStream: vi.fn(),
        }),
      } as never,
      hostId: 'local',
    });

    const response = await handler(new Request('personal-agent://app/api/vault-files'));

    expect(dispatchReadonlyLocalApiRequest).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/vault-files',
      body: undefined,
      headers: {},
    });
    expect(dispatchApiRequest).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ root: '/vault', files: [] });
  });

  it('allows PUT requests for local knowledge workspace writes', async () => {
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

    const response = await handler(new Request('personal-agent://app/api/vault/file', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'notes/test.md', content: '# test' }),
    }));

    expect(dispatchDesktopLocalApiRequest).toHaveBeenCalledWith({
      method: 'PUT',
      path: '/api/vault/file',
      body: { id: 'notes/test.md', content: '# test' },
      headers: {
        'content-type': 'application/json',
      },
    });
    expect(await response.json()).toEqual({ ok: true });
  });

  it('proxies companion requests through loopback when the daemon listens on a wildcard host', async () => {
    daemonMocks.loadDaemonConfig.mockReturnValue({
      companion: {
        host: '0.0.0.0',
        port: 3845,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    const handler = createDesktopProtocolHandler({
      loadLocalApiModule: vi.fn().mockResolvedValue(createLocalApiModuleMock()),
    });

    try {
      const response = await handler(new Request('personal-agent://app/companion/v1/hello'));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const targetUrl = fetchMock.mock.calls[0]?.[0];
      expect(targetUrl instanceof URL ? targetUrl.href : targetUrl).toBe('http://127.0.0.1:3845/companion/v1/hello');
      expect(fetchMock.mock.calls[0]?.[1]).toEqual({
        method: 'GET',
        headers: expect.anything(),
        body: undefined,
      });
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('prefers the live in-process companion url when the daemon fell back to another port', async () => {
    daemonMocks.loadDaemonConfig.mockReturnValue({
      companion: {
        host: '127.0.0.1',
        port: 3843,
      },
    });
    daemonMocks.getDaemonClientTransportOverride.mockImplementation(() => ({
      getCompanionUrl: vi.fn().mockResolvedValue('http://0.0.0.0:4123'),
    }) as never);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    const handler = createDesktopProtocolHandler({
      loadLocalApiModule: vi.fn().mockResolvedValue(createLocalApiModuleMock()),
    });

    try {
      const response = await handler(new Request('personal-agent://app/companion/v1/hello'));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const targetUrl = fetchMock.mock.calls[0]?.[0];
      expect(targetUrl instanceof URL ? targetUrl.href : targetUrl).toBe('http://127.0.0.1:4123/companion/v1/hello');
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
