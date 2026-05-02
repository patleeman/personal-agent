import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChangeWorkingDirectoryAgentExtension } from './changeWorkingDirectoryAgentExtension.js';

const tempDirs: string[] = [];

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-change-cwd-tool-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function registerChangeWorkingDirectoryTool(requestConversationWorkingDirectoryChange = vi.fn()) {
  let registeredTool:
    | {
      execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }>;
      promptGuidelines?: string[];
    }
    | undefined;

  createChangeWorkingDirectoryAgentExtension({
    requestConversationWorkingDirectoryChange: requestConversationWorkingDirectoryChange as never,
  })({
    registerTool: (tool: unknown) => {
      registeredTool = tool as {
        execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }>;
        promptGuidelines?: string[];
      };
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Change working directory tool was not registered.');
  }

  return { tool: registeredTool };
}

function createToolContext(conversationId = 'conv-123', cwd = '/tmp/workspace') {
  return {
    cwd,
    hasUI: false,
    isIdle: () => true,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => '',
    modelRegistry: {},
    model: undefined,
    sessionManager: {
      getSessionId: () => conversationId,
    },
    ui: {},
  };
}

describe('change working directory agent extension', () => {
  it('queues a working directory change and forwards automatic continuation', async () => {
    const repoRoot = createTempRepo();
    const targetDir = join(repoRoot, 'nested-repo');
    const requestConversationWorkingDirectoryChange = vi.fn(async () => ({
      conversationId: 'conv-123',
      cwd: targetDir,
      queued: true,
    }));
    const { tool } = registerChangeWorkingDirectoryTool(requestConversationWorkingDirectoryChange);
    const ctx = createToolContext('conv-123', repoRoot);

    writeFileSync(join(repoRoot, 'README.md'), '# root\n');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, '.gitkeep'), '');

    const result = await tool.execute(
      'tool-1',
      {
        cwd: './nested-repo',
        continuePrompt: 'Continue reviewing the repo from the new working directory.',
      },
      undefined,
      undefined,
      ctx,
    );

    expect(requestConversationWorkingDirectoryChange).toHaveBeenCalledWith({
      conversationId: 'conv-123',
      cwd: targetDir,
      continuePrompt: 'Continue reviewing the repo from the new working directory.',
    });
    expect(result.content[0]?.text).toContain('continue automatically');
    expect(result.details).toMatchObject({
      action: 'queue',
      conversationId: 'conv-123',
      cwd: targetDir,
      queued: true,
      continuePrompt: true,
    });
  });

  it('returns a noop result when the conversation is already in that directory', async () => {
    const repoRoot = createTempRepo();
    const requestConversationWorkingDirectoryChange = vi.fn(async () => ({
      conversationId: 'conv-123',
      cwd: repoRoot,
      queued: false,
      unchanged: true,
    }));
    const { tool } = registerChangeWorkingDirectoryTool(requestConversationWorkingDirectoryChange);
    const ctx = createToolContext('conv-123', repoRoot);

    const result = await tool.execute('tool-1', { cwd: '.' }, undefined, undefined, ctx);

    expect(result.content[0]?.text).toContain('Already using working directory');
    expect(result.details).toMatchObject({
      action: 'noop',
      conversationId: 'conv-123',
      cwd: repoRoot,
      queued: false,
      unchanged: true,
    });
  });

  it('rejects non-directory targets before queueing the change', async () => {
    const repoRoot = createTempRepo();
    const filePath = join(repoRoot, 'notes.txt');
    writeFileSync(filePath, 'not a directory\n');

    const requestConversationWorkingDirectoryChange = vi.fn(async () => ({
      conversationId: 'conv-123',
      cwd: filePath,
      queued: true,
    }));
    const { tool } = registerChangeWorkingDirectoryTool(requestConversationWorkingDirectoryChange);
    const ctx = createToolContext('conv-123', repoRoot);

    await expect(tool.execute('tool-1', { cwd: './notes.txt' }, undefined, undefined, ctx)).rejects.toThrow(`Not a directory: ${filePath}`);
    expect(requestConversationWorkingDirectoryChange).not.toHaveBeenCalled();
  });
});
