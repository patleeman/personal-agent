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
      loadLocalApiModule: vi.fn().mockResolvedValue({
        invokeDesktopLocalApi: vi.fn(),
        dispatchDesktopLocalApiRequest,
        subscribeDesktopLocalApiStream: vi.fn(),
        subscribeDesktopAppEvents: vi.fn(),
      } satisfies LocalApiModule),
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
      loadLocalApiModule: vi.fn().mockResolvedValue({
        invokeDesktopLocalApi: vi.fn(),
        dispatchDesktopLocalApiRequest,
        subscribeDesktopLocalApiStream: vi.fn(),
        subscribeDesktopAppEvents: vi.fn(),
      } satisfies LocalApiModule),
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
