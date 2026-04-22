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

  it('reads model state through the local controller when available', async () => {
    const localController = {
      readModels: vi.fn().mockResolvedValue({
        currentModel: 'gpt-5.4',
        currentThinkingLevel: 'high',
        currentServiceTier: '',
        models: [{ id: 'gpt-5.4', provider: 'openai', name: 'GPT-5.4', context: 128000, supportedServiceTiers: ['priority'] }],
      }),
    };

    const hostManager = {
      getHostController: vi.fn().mockReturnValue(localController),
      getConnectionsState: vi.fn().mockReturnValue({ hosts: [] }),
    } as unknown as HostManager;

    const runtime = createDesktopCompanionRuntime(hostManager);
    await expect(runtime.readModels()).resolves.toEqual({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
      models: [{ id: 'gpt-5.4', provider: 'openai', name: 'GPT-5.4', context: 128000, supportedServiceTiers: ['priority'] }],
    });
  });

  it('routes knowledge rename, delete, and import calls to vault endpoints', async () => {
    const localController = {
      dispatchApiRequest: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ id: 'Inbox/renamed.md', kind: 'file', name: 'renamed.md' }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }))
        .mockResolvedValueOnce(jsonResponse({
          note: { id: 'Inbox/shared-link.md', kind: 'file', name: 'shared-link.md' },
          sourceKind: 'url',
          title: 'Shared link',
        })),
    };

    const hostManager = {
      getHostController: vi.fn().mockReturnValue(localController),
      getConnectionsState: vi.fn().mockReturnValue({ hosts: [] }),
    } as unknown as HostManager;

    const runtime = createDesktopCompanionRuntime(hostManager);
    await expect(runtime.renameKnowledgeEntry({ id: 'Inbox/original.md', newName: 'renamed.md' })).resolves.toEqual({
      id: 'Inbox/renamed.md', kind: 'file', name: 'renamed.md',
    });
    await expect(runtime.deleteKnowledgeEntry('Inbox/renamed.md')).resolves.toEqual({ ok: true });
    await expect(runtime.importKnowledge({
      kind: 'url',
      directoryId: 'Inbox',
      title: 'Shared link',
      url: 'https://example.com/post',
    })).resolves.toEqual({
      note: { id: 'Inbox/shared-link.md', kind: 'file', name: 'shared-link.md' },
      sourceKind: 'url',
      title: 'Shared link',
    });

    expect(localController.dispatchApiRequest).toHaveBeenNthCalledWith(1, {
      method: 'POST',
      path: '/api/vault/rename',
      body: { id: 'Inbox/original.md', newName: 'renamed.md' },
    });
    expect(localController.dispatchApiRequest).toHaveBeenNthCalledWith(2, {
      method: 'DELETE',
      path: '/api/vault/file?id=Inbox%2Frenamed.md',
    });
    expect(localController.dispatchApiRequest).toHaveBeenNthCalledWith(3, {
      method: 'POST',
      path: '/api/vault/share-import',
      body: {
        kind: 'url',
        directoryId: 'Inbox',
        title: 'Shared link',
        url: 'https://example.com/post',
      },
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

  it('restores queued prompts and manages parallel jobs through local controller helpers', async () => {
    const localController = {
      restoreQueuedLiveSessionMessage: vi.fn().mockResolvedValue({ ok: true, text: 'queued hello', images: [] }),
      manageLiveSessionParallelJob: vi.fn().mockResolvedValue({ ok: true, status: 'imported' }),
    };

    const hostManager = {
      getHostController: vi.fn().mockReturnValue(localController),
      getConnectionsState: vi.fn().mockReturnValue({ hosts: [] }),
    } as unknown as HostManager;

    const runtime = createDesktopCompanionRuntime(hostManager);
    await expect(runtime.restoreConversationQueuePrompt({
      conversationId: 'conv-1',
      behavior: 'followUp',
      index: 0,
      previewId: 'queue-1',
    })).resolves.toEqual({ ok: true, text: 'queued hello', images: [] });
    await expect(runtime.manageConversationParallelJob({
      conversationId: 'conv-1',
      jobId: 'job-1',
      action: 'importNow',
    })).resolves.toEqual({ ok: true, status: 'imported' });

    expect(localController.restoreQueuedLiveSessionMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      behavior: 'followUp',
      index: 0,
      previewId: 'queue-1',
    });
    expect(localController.manageLiveSessionParallelJob).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      jobId: 'job-1',
      action: 'importNow',
    });
  });

  it('routes parallel prompts to the dedicated live-session endpoint', async () => {
    const localController = {
      dispatchApiRequest: vi.fn().mockResolvedValue(jsonResponse({ ok: true, accepted: true, jobId: 'job-1', childConversationId: 'child-1' })),
    };

    const hostManager = {
      getHostController: vi.fn().mockReturnValue(localController),
      getConnectionsState: vi.fn().mockReturnValue({ hosts: [] }),
    } as unknown as HostManager;

    conversationExecutionMocks.dispatchConversationExecutionRequest.mockResolvedValueOnce(null);

    const runtime = createDesktopCompanionRuntime(hostManager);
    await expect(runtime.parallelPromptConversation({
      conversationId: 'conv-1',
      text: 'Investigate this in parallel.',
      surfaceId: 'ios-surface-1',
    })).resolves.toEqual({ ok: true, accepted: true, jobId: 'job-1', childConversationId: 'child-1' });

    expect(localController.dispatchApiRequest).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/live-sessions/conv-1/parallel-prompt',
      body: {
        text: 'Investigate this in parallel.',
        surfaceId: 'ios-surface-1',
      },
    });
  });

  it('emits lightweight app invalidation events instead of resending the full conversation list', async () => {
    let appListener: ((event: { type: string; event?: unknown; message?: string }) => void) | null = null;
    const unsubscribe = vi.fn();
    const localController = {
      subscribeDesktopAppEvents: vi.fn().mockImplementation(async (listener: (event: { type: string; event?: unknown; message?: string }) => void) => {
        appListener = listener;
        return unsubscribe;
      }),
    };

    const hostManager = {
      getHostController: vi.fn().mockReturnValue(localController),
      getConnectionsState: vi.fn().mockReturnValue({ hosts: [] }),
    } as unknown as HostManager;

    const runtime = createDesktopCompanionRuntime(hostManager);
    const events: unknown[] = [];
    const stop = await runtime.subscribeApp((event) => {
      events.push(event);
    });

    expect(events).toEqual([{ type: 'open' }]);
    if (!appListener) {
      throw new Error('App listener was not registered.');
    }
    const emitAppEvent = appListener as (event: { type: string; event?: unknown; message?: string }) => void;
    emitAppEvent({ type: 'event', event: { type: 'session_meta_changed', sessionId: 'conv-1' } });
    expect(events).toEqual([
      { type: 'open' },
      { type: 'conversation_list_changed', sourceEvent: { type: 'session_meta_changed', sessionId: 'conv-1' } },
    ]);

    stop();
    expect(unsubscribe).toHaveBeenCalled();
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
