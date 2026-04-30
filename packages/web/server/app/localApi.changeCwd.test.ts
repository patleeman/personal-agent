import { mkdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  liveRegistry: new Map<string, { cwd: string; session: { sessionFile: string; isStreaming: boolean } }>(),
  createSessionFromExisting: vi.fn(),
  destroySession: vi.fn(),
  readSessionBlocks: vi.fn(),
  appendConversationWorkspaceMetadata: vi.fn(),
  publishConversationSessionMetaChanged: vi.fn(),
  startKnowledgeBaseSyncLoop: vi.fn(),
  subscribeKnowledgeBaseState: vi.fn(() => vi.fn()),
}));

vi.mock('./bootstrap.js', async () => {
  const actual = await vi.importActual<typeof import('./bootstrap.js')>('./bootstrap.js');
  return {
    ...actual,
    startConversationRecovery: vi.fn(),
    startDeferredResumeLoop: vi.fn(),
  };
});

vi.mock('@personal-agent/core', async () => {
  const actual = await vi.importActual<typeof import('@personal-agent/core')>('@personal-agent/core');
  return {
    ...actual,
    startKnowledgeBaseSyncLoop: mocks.startKnowledgeBaseSyncLoop,
    subscribeKnowledgeBaseState: mocks.subscribeKnowledgeBaseState,
  };
});

vi.mock('../conversations/liveSessions.js', async () => {
  const actual = await vi.importActual<typeof import('../conversations/liveSessions.js')>('../conversations/liveSessions.js');
  return {
    ...actual,
    registry: mocks.liveRegistry,
    createSessionFromExisting: mocks.createSessionFromExisting,
    destroySession: mocks.destroySession,
  };
});

vi.mock('../conversations/sessions.js', async () => {
  const actual = await vi.importActual<typeof import('../conversations/sessions.js')>('../conversations/sessions.js');
  return {
    ...actual,
    readSessionBlocks: mocks.readSessionBlocks,
    appendConversationWorkspaceMetadata: mocks.appendConversationWorkspaceMetadata,
  };
});

vi.mock('../conversations/conversationService.js', async () => {
  const actual = await vi.importActual<typeof import('../conversations/conversationService.js')>('../conversations/conversationService.js');
  return {
    ...actual,
    publishConversationSessionMetaChanged: mocks.publishConversationSessionMetaChanged,
  };
});

describe('changeDesktopConversationCwd', () => {
  beforeEach(() => {
    mocks.liveRegistry.clear();
    mocks.createSessionFromExisting.mockReset();
    mocks.destroySession.mockReset();
    mocks.readSessionBlocks.mockReset();
    mocks.appendConversationWorkspaceMetadata.mockReset();
    mocks.publishConversationSessionMetaChanged.mockReset();
    mocks.startKnowledgeBaseSyncLoop.mockClear();
    mocks.subscribeKnowledgeBaseState.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('writes workspace metadata to the new desktop session when moving a neutral chat into a project cwd', async () => {
    const targetCwd = await mkdtemp(join(tmpdir(), 'pa-local-cwd-target-'));
    const sourceSessionFile = join(targetCwd, 'source.jsonl');
    const nextSessionFile = join(targetCwd, 'next.jsonl');
    const sourceCwd = join(tmpdir(), 'pi-agent-runtime', 'chat-workspaces', 'testing');
    mkdirSync(sourceCwd, { recursive: true });

    mocks.liveRegistry.set('conversation-1', {
      cwd: sourceCwd,
      session: { sessionFile: sourceSessionFile, isStreaming: false },
    });
    mocks.readSessionBlocks.mockReturnValue({
      meta: {
        id: 'conversation-1',
        file: sourceSessionFile,
        timestamp: '2026-04-26T00:00:00.000Z',
        cwd: sourceCwd,
        workspaceCwd: null,
        cwdSlug: 'testing',
        model: 'gpt-5.5',
        title: 'Test conversation',
        messageCount: 2,
      },
      blocks: [],
      blockOffset: 0,
      totalBlocks: 0,
      contextUsage: null,
    });
    mocks.createSessionFromExisting.mockResolvedValue({
      id: 'conversation-2',
      sessionFile: nextSessionFile,
    });

    const { changeDesktopConversationCwd } = await import('./localApi.js');
    const result = await changeDesktopConversationCwd({
      conversationId: 'conversation-1',
      cwd: targetCwd,
    });

    expect(result).toEqual({
      id: 'conversation-2',
      sessionFile: nextSessionFile,
      cwd: targetCwd,
      changed: true,
    });
    expect(mocks.appendConversationWorkspaceMetadata).toHaveBeenCalledWith({
      sessionFile: nextSessionFile,
      previousCwd: sourceCwd,
      previousWorkspaceCwd: null,
      cwd: targetCwd,
      workspaceCwd: targetCwd,
      visibleMessage: true,
    });
    expect(mocks.destroySession).toHaveBeenCalledWith('conversation-1');
    expect(mocks.publishConversationSessionMetaChanged).toHaveBeenCalledWith('conversation-1', 'conversation-2');
  });
});
