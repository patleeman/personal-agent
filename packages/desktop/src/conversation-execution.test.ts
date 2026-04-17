import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import type { HostApiDispatchResult } from './hosts/types.js';
import type { HostManager } from './hosts/host-manager.js';
import {
  dispatchConversationExecutionRequest,
  subscribeConversationExecutionApiStream,
} from './conversation-execution.js';

function jsonResult(body: unknown, statusCode = 200): HostApiDispatchResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: Uint8Array.from(Buffer.from(JSON.stringify(body), 'utf-8')),
  };
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
    expect(remoteController.dispatchApiRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'PATCH',
      path: '/api/conversations/remote-conversation/title',
      body: { name: 'Ship this fix' },
    }));
    expect(remoteController.dispatchApiRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      path: '/api/live-sessions/remote-conversation/prompt',
      body: { text: 'Ship this fix' },
    }));
  });

  it('syncs remote title_update stream events back into the local conversation title', async () => {
    const { hostManager, localController, remoteController } = createHostManagerMock();

    let streamHandler: ((event: { type: 'message'; data?: string }) => void) | null = null;
    remoteController.subscribeApiStream.mockImplementation((_path: string, handler: (event: { type: 'message'; data?: string }) => void) => {
      streamHandler = handler;
      return Promise.resolve(() => undefined);
    });

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

    expect(forwardedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'message' }),
    ]));
  });
});
