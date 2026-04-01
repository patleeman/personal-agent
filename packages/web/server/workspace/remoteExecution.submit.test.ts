import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  startBackgroundRunMock,
  getExecutionTargetMock,
  setConversationExecutionTargetMock,
  setConversationProjectLinksMock,
  appendDetachedUserMessageMock,
  ensureSessionFileExistsMock,
  patchSessionManagerPersistenceMock,
  liveRegistryMock,
} = vi.hoisted(() => ({
  startBackgroundRunMock: vi.fn(),
  getExecutionTargetMock: vi.fn(),
  setConversationExecutionTargetMock: vi.fn(),
  setConversationProjectLinksMock: vi.fn(),
  appendDetachedUserMessageMock: vi.fn(),
  ensureSessionFileExistsMock: vi.fn(),
  patchSessionManagerPersistenceMock: vi.fn(),
  liveRegistryMock: new Map<string, { cwd: string; session: { isStreaming: boolean; sessionFile?: string; sessionManager?: unknown } }>(),
}));

vi.mock('@personal-agent/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@personal-agent/daemon')>()),
  startBackgroundRun: startBackgroundRunMock,
}));

vi.mock('@personal-agent/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@personal-agent/core')>()),
  getExecutionTarget: getExecutionTargetMock,
  setConversationExecutionTarget: setConversationExecutionTargetMock,
  setConversationProjectLinks: setConversationProjectLinksMock,
}));

vi.mock('../conversations/liveSessions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversations/liveSessions.js')>()),
  appendDetachedUserMessage: appendDetachedUserMessageMock,
  ensureSessionFileExists: ensureSessionFileExistsMock,
  patchSessionManagerPersistence: patchSessionManagerPersistenceMock,
  registry: liveRegistryMock,
}));

import { submitRemoteExecutionRun } from './remoteExecution.js';

const tempDirs: string[] = [];
const REMOTE_EXECUTION_WORKER_PATH = fileURLToPath(new URL('./remoteExecutionWorker.mjs', import.meta.url));

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('submitRemoteExecutionRun', () => {
  beforeEach(() => {
    startBackgroundRunMock.mockReset();
    getExecutionTargetMock.mockReset();
    setConversationExecutionTargetMock.mockReset();
    setConversationProjectLinksMock.mockReset();
    appendDetachedUserMessageMock.mockReset();
    ensureSessionFileExistsMock.mockReset();
    patchSessionManagerPersistenceMock.mockReset();
    liveRegistryMock.clear();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('prefers the live session file when the provided snapshot path is stale', async () => {
    const workspaceDir = createTempDir('pa-remote-submit-workspace-');
    const sessionsDir = createTempDir('pa-remote-submit-sessions-');
    const conversationId = 'conv-remote-submit-123';
    const actualSessionFile = join(sessionsDir, `${conversationId}.jsonl`);
    writeFileSync(actualSessionFile, [
      JSON.stringify({ type: 'session', version: 3, id: conversationId, timestamp: '2026-03-19T16:00:00.000Z', cwd: workspaceDir }),
      JSON.stringify({ type: 'model_change', id: 'm1', parentId: null, timestamp: '2026-03-19T16:00:00.100Z', modelId: 'test-model' }),
      JSON.stringify({
        type: 'message',
        id: 'u1',
        parentId: 'm1',
        timestamp: '2026-03-19T16:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Existing conversation context.' }],
        },
      }),
    ].join('\n') + '\n');

    const staleSessionFile = join(sessionsDir, 'missing-session.jsonl');
    liveRegistryMock.set(conversationId, {
      cwd: workspaceDir,
      session: {
        isStreaming: false,
        sessionFile: actualSessionFile ?? undefined,
        sessionManager: {},
      },
    });

    getExecutionTargetMock.mockReturnValue({
      id: 'gpu-box',
      label: 'GPU Box',
      sshDestination: 'gpu-box',
      cwdMappings: [{ localPrefix: workspaceDir, remotePrefix: '/srv/workspace' }],
    });
    appendDetachedUserMessageMock.mockResolvedValue(undefined);
    startBackgroundRunMock.mockImplementation(async (input: { argv: string[]; source: { filePath: string } }) => {
      expect(input.source.filePath).toBe(actualSessionFile);
      expect(input.argv[1]).toBe(REMOTE_EXECUTION_WORKER_PATH);
      const requestBundlePath = input.argv[2];
      const requestBundle = JSON.parse(readFileSync(requestBundlePath, 'utf-8')) as {
        conversationId: string;
        bootstrapSessionFile: string;
      };
      expect(requestBundle.conversationId).toBe(conversationId);
      expect(readFileSync(requestBundle.bootstrapSessionFile, 'utf-8')).toBe(readFileSync(actualSessionFile as string, 'utf-8'));
      return {
        accepted: true,
        runId: 'run-remote-123',
      };
    });

    const result = await submitRemoteExecutionRun({
      conversationId,
      sessionFile: staleSessionFile,
      text: 'Run this remotely.',
      targetId: 'gpu-box',
      profile: 'datadog',
      repoRoot: workspaceDir,
    });

    expect(result.sessionFile).toBe(actualSessionFile);
    expect(result.runId).toBe('run-remote-123');
    expect(ensureSessionFileExistsMock).toHaveBeenCalledWith({});
    expect(appendDetachedUserMessageMock).toHaveBeenCalledWith(conversationId, 'Run this remotely.');
    expect(setConversationExecutionTargetMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId,
      targetId: 'gpu-box',
    }));
  });
});
