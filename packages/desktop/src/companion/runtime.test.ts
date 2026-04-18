import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostManager } from '../hosts/host-manager.js';
import { createDesktopCompanionRuntime } from './runtime.js';

const conversationExecutionMocks = vi.hoisted(() => ({
  continueConversationInHost: vi.fn(),
  dispatchConversationExecutionRequest: vi.fn(),
  subscribeConversationExecutionApiStream: vi.fn(),
}));

vi.mock('../conversation-execution.js', () => conversationExecutionMocks);

function jsonResponse(body: unknown) {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify(body), 'utf-8'),
  };
}

describe('desktop companion runtime', () => {
  beforeEach(() => {
    conversationExecutionMocks.continueConversationInHost.mockReset();
    conversationExecutionMocks.dispatchConversationExecutionRequest.mockReset();
    conversationExecutionMocks.subscribeConversationExecutionApiStream.mockReset();
  });

  it('mirrors local sessions, ordering, and execution target list', async () => {
    const localController = {
      readSessions: vi.fn().mockResolvedValue([{ id: 'conv-1', title: 'Conversation 1' }]),
      readOpenConversationTabs: vi.fn().mockResolvedValue({
        sessionIds: ['conv-1'],
        pinnedSessionIds: ['conv-1'],
        archivedSessionIds: [],
        workspacePaths: ['/repo'],
      }),
    };

    const hostManager = {
      getHostController: vi.fn().mockReturnValue(localController),
      getConnectionsState: vi.fn().mockReturnValue({
        hosts: [{ id: 'ssh-1', label: 'Buildbox', kind: 'ssh', sshTarget: 'buildbox' }],
      }),
    } as unknown as HostManager;

    const runtime = createDesktopCompanionRuntime(hostManager);
    await expect(runtime.listConversations()).resolves.toEqual({
      sessions: [{ id: 'conv-1', title: 'Conversation 1' }],
      ordering: {
        sessionIds: ['conv-1'],
        pinnedSessionIds: ['conv-1'],
        archivedSessionIds: [],
        workspacePaths: ['/repo'],
      },
      executionTargets: [
        { id: 'local', label: 'Local', kind: 'local' },
        { id: 'ssh-1', label: 'Buildbox', kind: 'ssh' },
      ],
    });
  });

  it('changes execution target then reloads bootstrap through the desktop API dispatcher', async () => {
    const localController = {
      dispatchApiRequest: vi.fn().mockResolvedValue(jsonResponse({ bootstrap: { conversationId: 'conv-1' } })),
      readSessionMeta: vi.fn().mockResolvedValue({ id: 'conv-1' }),
      readConversationAttachments: vi.fn().mockResolvedValue({ attachments: [] }),
    };

    const hostManager = {
      getHostController: vi.fn().mockReturnValue(localController),
      getConnectionsState: vi.fn().mockReturnValue({ hosts: [] }),
    } as unknown as HostManager;

    conversationExecutionMocks.continueConversationInHost.mockResolvedValue({
      conversationId: 'conv-1',
      remoteHostId: 'ssh-1',
      remoteConversationId: 'remote-1',
    });
    conversationExecutionMocks.dispatchConversationExecutionRequest.mockResolvedValueOnce(null);

    const runtime = createDesktopCompanionRuntime(hostManager);
    await expect(runtime.changeConversationExecutionTarget({
      conversationId: 'conv-1',
      executionTargetId: 'ssh-1',
    })).resolves.toEqual({
      bootstrap: { bootstrap: { conversationId: 'conv-1' } },
      sessionMeta: { id: 'conv-1' },
      attachments: { attachments: [] },
      executionTargets: [{ id: 'local', label: 'Local', kind: 'local' }],
    });

    expect(conversationExecutionMocks.continueConversationInHost).toHaveBeenCalledWith(hostManager, {
      conversationId: 'conv-1',
      hostId: 'ssh-1',
    });
    expect(localController.dispatchApiRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      path: '/api/conversations/conv-1/bootstrap',
    }));
  });

  it('maps ios_native conversation subscriptions onto mobile_web live-session streams', async () => {
    const unsubscribe = vi.fn();
    const localController = {
      subscribeApiStream: vi.fn().mockImplementation(async (_path: string, onEvent: (event: { type: 'message'; data?: string }) => void) => {
        onEvent({ type: 'message', data: JSON.stringify({ type: 'text_delta', delta: 'hello' }) });
        return unsubscribe;
      }),
    };

    const hostManager = {
      getHostController: vi.fn().mockReturnValue(localController),
      getConnectionsState: vi.fn().mockReturnValue({ hosts: [] }),
    } as unknown as HostManager;

    conversationExecutionMocks.subscribeConversationExecutionApiStream.mockResolvedValue(null);

    const runtime = createDesktopCompanionRuntime(hostManager);
    const events: unknown[] = [];
    const stop = await runtime.subscribeConversation({
      conversationId: 'conv-1',
      surfaceId: 'ios-surface-1',
      surfaceType: 'ios_native',
      tailBlocks: 5,
    }, (event) => {
      events.push(event);
    });

    expect(localController.subscribeApiStream).toHaveBeenCalledWith(
      '/api/live-sessions/conv-1/events?surfaceId=ios-surface-1&surfaceType=mobile_web&tailBlocks=5',
      expect.any(Function),
    );
    expect(events).toEqual([{ type: 'text_delta', delta: 'hello' }]);
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
