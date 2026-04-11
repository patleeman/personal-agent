import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverDurableLiveConversations } from './conversationRecovery.js';
import { syncWebLiveConversationRun } from './conversationRuns.js';

const tempDirs: string[] = [];
const originalEnv = process.env;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('conversation recovery', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('resumes interrupted conversations and replays pending prompt operations', async () => {
    const stateRoot = createTempDir('pa-web-conversation-recovery-state-');
    const daemonSocketDir = createTempDir('pa-web-conversation-recovery-sock-');
    const sessionDir = join(stateRoot, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = join(sessionDir, 'conv-123.jsonl');
    writeFileSync(sessionFile, '{"type":"session","id":"conv-123","timestamp":"2026-03-12T13:00:00.000Z","cwd":"/tmp/workspace"}\n');

    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
      PERSONAL_AGENT_DAEMON_SOCKET_PATH: join(daemonSocketDir, 'personal-agentd.sock'),
    };

    await syncWebLiveConversationRun({
      conversationId: 'conv-123',
      sessionFile,
      cwd: '/tmp/workspace',
      title: 'Recover me',
      profile: 'datadog',
      state: 'running',
      pendingOperation: {
        type: 'prompt',
        text: 'continue working',
        behavior: 'followUp',
        contextMessages: [{ customType: 'referenced_context', content: 'Referenced projects: @foo' }],
        enqueuedAt: '2026-03-12T13:00:01.000Z',
      },
    });

    await syncWebLiveConversationRun({
      conversationId: 'conv-123',
      sessionFile,
      cwd: '/tmp/workspace',
      title: 'Recover me',
      profile: 'datadog',
      state: 'interrupted',
      lastError: 'web process stopped',
    });

    const resumeSession = vi.fn(async () => ({ id: 'conv-123' }));
    const queuePromptContext = vi.fn(async () => undefined);
    const promptSession = vi.fn(async () => undefined);

    const recovered = await recoverDurableLiveConversations({
      isLive: () => false,
      resumeSession,
      queuePromptContext,
      promptSession,
      logger: {
        info: () => undefined,
        warn: () => undefined,
      },
    });

    expect(resumeSession).toHaveBeenCalledWith(sessionFile, undefined);
    expect(queuePromptContext).toHaveBeenCalledWith('conv-123', 'referenced_context', 'Referenced projects: @foo');
    expect(promptSession).toHaveBeenCalledWith('conv-123', 'continue working', 'followUp', undefined);
    expect(recovered).toEqual({
      recovered: [{
        runId: 'conversation-live-conv-123',
        conversationId: 'conv-123',
        replayedPendingOperation: true,
      }],
    });
  });

  it('does not replay the synthetic resume fallback prompt during startup recovery', async () => {
    const stateRoot = createTempDir('pa-web-conversation-recovery-state-');
    const daemonSocketDir = createTempDir('pa-web-conversation-recovery-sock-');
    const sessionDir = join(stateRoot, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = join(sessionDir, 'conv-789.jsonl');
    writeFileSync(sessionFile, '{"type":"session","id":"conv-789","timestamp":"2026-03-12T13:00:00.000Z","cwd":"/tmp/workspace"}\n');

    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
      PERSONAL_AGENT_DAEMON_SOCKET_PATH: join(daemonSocketDir, 'personal-agentd.sock'),
    };

    await syncWebLiveConversationRun({
      conversationId: 'conv-789',
      sessionFile,
      cwd: '/tmp/workspace',
      title: 'Recover me later',
      profile: 'datadog',
      state: 'running',
      pendingOperation: {
        type: 'prompt',
        text: 'Continue from where you left off.',
        enqueuedAt: '2026-03-12T13:00:01.000Z',
      },
    });

    await syncWebLiveConversationRun({
      conversationId: 'conv-789',
      sessionFile,
      cwd: '/tmp/workspace',
      title: 'Recover me later',
      profile: 'datadog',
      state: 'interrupted',
      lastError: 'web process stopped',
    });

    const resumeSession = vi.fn(async () => ({ id: 'conv-789' }));
    const queuePromptContext = vi.fn(async () => undefined);
    const promptSession = vi.fn(async () => undefined);

    const recovered = await recoverDurableLiveConversations({
      isLive: () => false,
      resumeSession,
      queuePromptContext,
      promptSession,
      logger: {
        info: () => undefined,
        warn: () => undefined,
      },
    });

    expect(resumeSession).toHaveBeenCalledWith(sessionFile, undefined);
    expect(queuePromptContext).not.toHaveBeenCalled();
    expect(promptSession).not.toHaveBeenCalled();
    expect(recovered).toEqual({
      recovered: [{
        runId: 'conversation-live-conv-789',
        conversationId: 'conv-789',
        replayedPendingOperation: false,
      }],
    });
  });

  it('skips conversations that are already live', async () => {
    const stateRoot = createTempDir('pa-web-conversation-recovery-state-');
    const daemonSocketDir = createTempDir('pa-web-conversation-recovery-sock-');
    const sessionDir = join(stateRoot, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = join(sessionDir, 'conv-456.jsonl');
    writeFileSync(sessionFile, '{"type":"session","id":"conv-456","timestamp":"2026-03-12T13:00:00.000Z","cwd":"/tmp/workspace"}\n');

    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
      PERSONAL_AGENT_DAEMON_SOCKET_PATH: join(daemonSocketDir, 'personal-agentd.sock'),
    };

    await syncWebLiveConversationRun({
      conversationId: 'conv-456',
      sessionFile,
      cwd: '/tmp/workspace',
      state: 'interrupted',
      pendingOperation: {
        type: 'prompt',
        text: 'continue working',
        enqueuedAt: '2026-03-12T13:00:01.000Z',
      },
    });

    const resumeSession = vi.fn(async () => ({ id: 'conv-456' }));

    const recovered = await recoverDurableLiveConversations({
      isLive: (conversationId) => conversationId === 'conv-456',
      resumeSession,
      queuePromptContext: vi.fn(async () => undefined),
      promptSession: vi.fn(async () => undefined),
    });

    expect(resumeSession).not.toHaveBeenCalled();
    expect(recovered).toEqual({ recovered: [] });
  });
});
