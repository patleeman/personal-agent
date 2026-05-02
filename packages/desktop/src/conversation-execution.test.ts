import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  continueConversationInHost,
  dispatchConversationExecutionRequest,
  subscribeConversationExecutionApiStream,
} from './conversation-execution.js';
import type { HostManager } from './hosts/host-manager.js';
import type { HostApiDispatchResult } from './hosts/types.js';

function jsonResult(body: unknown, statusCode = 200): HostApiDispatchResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: Uint8Array.from(Buffer.from(JSON.stringify(body), 'utf-8')),
  };
}

function parseJsonResult(response: HostApiDispatchResult | null): unknown {
  if (!response) {
    return null;
  }

  return JSON.parse(Buffer.from(response.body).toString('utf-8')) as unknown;
}

function createHostManagerMock() {
  const localController = {
    readSessionMeta: vi.fn().mockResolvedValue({
      id: 'local-conversation',
      file: '/sessions/local-conversation.jsonl',
      title: 'New Conversation',
      remoteHostId: 'bender',
      remoteConversationId: 'remote-conversation',
    }),
    dispatchApiRequest: vi.fn().mockResolvedValue(jsonResult({ ok: true })),
    renameConversation: vi.fn().mockResolvedValue({ ok: true, title: 'updated' }),
  };

  const remoteController = {
    dispatchApiRequest: vi.fn().mockImplementation(({ path }: { path: string }) => {
      if (path === '/api/sessions/remote-conversation/meta') {
        return Promise.resolve(jsonResult({ id: 'remote-conversation' }));
      }

      if (path === '/api/live-sessions/remote-conversation/prompt') {
        return Promise.resolve(jsonResult({ ok: true, accepted: true, delivery: 'started' }));
      }

      if (path === '/api/conversations/remote-conversation/title') {
        return Promise.resolve(jsonResult({ ok: true, title: 'Ship this fix' }));
      }

      return Promise.resolve(jsonResult({ ok: true }));
    }),
    subscribeApiStream: vi.fn(),
  };

  const hostManager = {
    getHostController: vi.fn((hostId: string) => {
      if (hostId === 'local') {
        return localController;
      }

      return remoteController;
    }),
  } as unknown as HostManager;

  return { hostManager, localController, remoteController };
}

describe('conversation-execution remote routing', () => {
  it('continues remotely using the persisted local session file when live bootstrap metadata points at a directory', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pa-conversation-execution-'));
    const sessionDir = join(tempRoot, 'live-session-dir');
    const sessionFile = join(tempRoot, 'local-conversation.jsonl');
    const sessionContent = `${JSON.stringify({
      type: 'session',
      id: 'local-conversation',
      timestamp: '2026-04-17T00:00:00.000Z',
      cwd: '/repo/current',
    })}\n`;
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(sessionFile, sessionContent, 'utf-8');

    try {
      const localController = {
        readConversationBootstrap: vi.fn().mockResolvedValue({
          liveSession: {
            live: true,
            id: 'local-conversation',
            cwd: '/repo/current',
            sessionFile: sessionDir,
            title: 'Keep this thread',
          },
        }),
        readSessionMeta: vi.fn().mockResolvedValue({
          id: 'local-conversation',
          file: sessionFile,
          cwd: '/repo/current',
          title: 'Keep this thread',
        }),
        destroyLiveSession: vi.fn().mockResolvedValue(undefined),
      };
      const remoteController = {
        invokeLocalApi: vi.fn().mockImplementation((method: string, path: string, body: unknown) => {
          if (method === 'POST' && path === '/api/live-sessions') {
            expect(body).toEqual({
              conversationId: 'local-conversation',
              cwd: '/repo/current',
              sessionContent,
            });
            return Promise.resolve({ id: 'remote-conversation' });
          }

          if (method === 'PATCH' && path === '/api/conversations/remote-conversation/title') {
            expect(body).toEqual({ name: 'Keep this thread' });
            return Promise.resolve({ ok: true });
          }

          throw new Error(`Unexpected remote invokeLocalApi call: ${method} ${path}`);
        }),
        dispatchApiRequest: vi.fn().mockImplementation(({ method, path }: { method: string; path: string }) => {
          if (method === 'GET' && path === '/api/sessions/remote-conversation/meta') {
            return Promise.resolve(jsonResult({ cwd: '/repo/current' }));
          }

          throw new Error(`Unexpected remote dispatch: ${method} ${path}`);
        }),
      };

      const hostManager = {
        getHostController: vi.fn((hostId: string) => {
          if (hostId === 'local') {
            return localController;
          }

          return remoteController;
        }),
        getHostRecord: vi.fn(() => ({ kind: 'ssh', label: 'Bender' })),
        ensureHostRunning: vi.fn().mockResolvedValue(undefined),
      } as unknown as HostManager;

      await expect(
        continueConversationInHost(hostManager, {
          conversationId: 'local-conversation',
          hostId: 'bender',
        }),
      ).resolves.toEqual({
        conversationId: 'local-conversation',
        remoteHostId: 'bender',
        remoteHostLabel: 'Bender',
        remoteConversationId: 'remote-conversation',
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('throws a helpful error when the only available session path is a directory', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pa-conversation-execution-'));
    const sessionDir = join(tempRoot, 'live-session-dir');
    mkdirSync(sessionDir, { recursive: true });

    try {
      const localController = {
        readConversationBootstrap: vi.fn().mockResolvedValue({
          liveSession: {
            live: true,
            id: 'local-conversation',
            cwd: '/repo/current',
            sessionFile: sessionDir,
            title: 'Keep this thread',
          },
        }),
        readSessionMeta: vi.fn().mockResolvedValue({
          id: 'local-conversation',
          file: sessionDir,
          cwd: '/repo/current',
          title: 'Keep this thread',
        }),
      };

      const hostManager = {
        getHostController: vi.fn(() => localController),
      } as unknown as HostManager;

      await expect(
        continueConversationInHost(hostManager, {
          conversationId: 'local-conversation',
          hostId: 'bender',
        }),
      ).rejects.toThrow(`Conversation session file is invalid (expected a file, got a directory): ${sessionDir}`);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('applies a fallback title to both local and remote conversations before the first remote prompt', async () => {
    const { hostManager, localController, remoteController } = createHostManagerMock();

    const response = await dispatchConversationExecutionRequest(hostManager, {
      method: 'POST',
      path: '/api/live-sessions/local-conversation/prompt',
      body: { text: 'Ship this fix' },
    });

    expect(response).not.toBeNull();
    expect(localController.renameConversation).toHaveBeenCalledWith({
      conversationId: 'local-conversation',
      name: 'Ship this fix',
    });
    expect(remoteController.dispatchApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        path: '/api/conversations/remote-conversation/title',
        body: { name: 'Ship this fix' },
      }),
    );
    expect(remoteController.dispatchApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/live-sessions/remote-conversation/prompt',
        body: { text: 'Ship this fix' },
      }),
    );
  });

  it('does not title remote conversations from malformed prompt images', async () => {
    const { hostManager, localController, remoteController } = createHostManagerMock();

    await dispatchConversationExecutionRequest(hostManager, {
      method: 'POST',
      path: '/api/live-sessions/local-conversation/prompt',
      body: {
        images: [
          null,
          { data: '', mimeType: '' },
          { data: '   ', mimeType: 'image/png' },
          {
            data: 'not-valid-base64!',
            mimeType: 'image/png',
          },
          { data: 'aGVsbG8=', mimeType: 'text/plain' },
        ],
      },
    });

    expect(localController.renameConversation).not.toHaveBeenCalled();
    expect(remoteController.dispatchApiRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        path: '/api/conversations/remote-conversation/title',
      }),
    );
  });

  it('syncs remote title_update stream events back into the local conversation title', async () => {
    const { hostManager, localController, remoteController } = createHostManagerMock();

    let streamHandler: ((event: { type: 'message'; data?: string }) => void) | null = null;
    remoteController.subscribeApiStream.mockImplementation(
      (_path: string, handler: (event: { type: 'message'; data?: string }) => void) => {
        streamHandler = handler;
        return Promise.resolve(() => undefined);
      },
    );

    const forwardedEvents: Array<{ type: string; data?: string }> = [];
    const unsubscribe = await subscribeConversationExecutionApiStream(
      hostManager,
      '/api/live-sessions/local-conversation/events',
      (event) => {
        forwardedEvents.push(event as { type: string; data?: string });
      },
    );

    expect(unsubscribe).toBeTypeOf('function');
    expect(streamHandler).not.toBeNull();

    const activeStreamHandler = streamHandler as ((event: { type: 'message'; data?: string }) => void) | null;
    if (!activeStreamHandler) {
      throw new Error('Expected remote stream handler to be installed.');
    }

    activeStreamHandler({
      type: 'message',
      data: JSON.stringify({ type: 'title_update', title: 'Remote title' }),
    });

    await vi.waitFor(() => {
      expect(localController.renameConversation).toHaveBeenCalledWith({
        conversationId: 'local-conversation',
        name: 'Remote title',
      });
    });

    expect(forwardedEvents).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'message' })]));
  });

  it('rewrites remote cwd-change responses back to the local conversation id and updates local session mapping', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pa-conversation-execution-'));
    const sessionFile = join(tempRoot, 'local-conversation.jsonl');
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        type: 'session',
        id: 'local-conversation',
        timestamp: '2026-04-17T00:00:00.000Z',
        cwd: '/repo/current',
        remoteHostId: 'bender',
        remoteHostLabel: 'Bender',
        remoteConversationId: 'remote-conversation',
      })}\n`,
      'utf-8',
    );

    try {
      const localController = {
        readSessionMeta: vi.fn().mockResolvedValue({
          id: 'local-conversation',
          file: sessionFile,
          cwd: '/repo/current',
          title: 'Keep this thread',
          remoteHostId: 'bender',
          remoteHostLabel: 'Bender',
          remoteConversationId: 'remote-conversation',
        }),
        dispatchApiRequest: vi.fn(),
      };
      const remoteController = {
        dispatchApiRequest: vi.fn().mockImplementation(({ method, path, body }: { method: string; path: string; body?: unknown }) => {
          if (method === 'POST' && path === '/api/conversations/remote-conversation/cwd') {
            expect(body).toEqual({ cwd: '/repo/next' });
            return Promise.resolve(
              jsonResult({
                id: 'remote-conversation-2',
                sessionFile: '/sessions/remote-conversation-2.jsonl',
                cwd: '/repo/next',
                changed: true,
              }),
            );
          }

          throw new Error(`Unexpected remote request: ${method} ${path}`);
        }),
      };

      const hostManager = {
        getHostController: vi.fn((hostId: string) => {
          if (hostId === 'local') {
            return localController;
          }

          return remoteController;
        }),
      } as unknown as HostManager;

      const response = await dispatchConversationExecutionRequest(hostManager, {
        method: 'POST',
        path: '/api/conversations/local-conversation/cwd',
        body: { cwd: '/repo/next' },
      });

      expect(parseJsonResult(response as HostApiDispatchResult)).toEqual({
        id: 'local-conversation',
        sessionFile,
        cwd: '/repo/next',
        changed: true,
      });

      const headerLine = readFileSync(sessionFile, 'utf-8').trim().split('\n')[0] ?? '{}';
      const header = JSON.parse(headerLine) as {
        cwd?: string;
        remoteHostId?: string;
        remoteHostLabel?: string;
        remoteConversationId?: string;
      };
      expect(header.cwd).toBe('/repo/next');
      expect(header.remoteHostId).toBe('bender');
      expect(header.remoteHostLabel).toBe('Bender');
      expect(header.remoteConversationId).toBe('remote-conversation-2');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
