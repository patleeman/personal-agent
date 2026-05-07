import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getConversationCommitCheckpoint, listConversationCommitCheckpoints } from '@personal-agent/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createCheckpointAgentExtension } from './checkpointAgentExtension.js';

const tempDirs: string[] = [];

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-checkpoint-tool-'));
  tempDirs.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf-8' });
  spawnSync('git', ['config', 'user.email', 'user@example.com'], { cwd: dir, encoding: 'utf-8' });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, encoding: 'utf-8' });
  writeFileSync(join(dir, 'README.md'), '# demo\n');
  spawnSync('git', ['add', 'README.md'], { cwd: dir, encoding: 'utf-8' });
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir, encoding: 'utf-8' });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function registerCheckpointTool(stateRoot: string) {
  let registeredTool:
    | {
        execute: (...args: unknown[]) => Promise<{ content: Array<{ text?: string }>; details?: Record<string, unknown> }>;
      }
    | undefined;

  createCheckpointAgentExtension({
    stateRoot,
    getCurrentProfile: () => 'assistant',
  })({
    registerTool: (tool: unknown) => {
      registeredTool = tool as {
        execute: (...args: unknown[]) => Promise<{ content: Array<{ text?: string }>; details?: Record<string, unknown> }>;
      };
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Checkpoint tool was not registered.');
  }

  return registeredTool;
}

function createToolContext(cwd: string, conversationId = 'conv-123') {
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
      getCwd: () => cwd,
    },
    ui: {},
  };
}

describe('checkpoint agent extension', () => {
  it('creates and stores targeted commit checkpoints', async () => {
    const repoRoot = createTempRepo();
    const stateRoot = join(repoRoot, '.state');
    const checkpointTool = registerCheckpointTool(stateRoot);
    const ctx = createToolContext(repoRoot);

    writeFileSync(join(repoRoot, 'README.md'), '# demo\n\nAdded checkpoint review.\n');
    writeFileSync(join(repoRoot, 'notes.txt'), 'ignore me\n');

    const created = await checkpointTool.execute(
      'tool-1',
      {
        action: 'save',
        message: 'feat: checkpoint review',
        paths: ['README.md'],
      },
      undefined,
      undefined,
      ctx,
    );

    expect(created.content[0]?.text).toContain('Saved checkpoint');
    expect(created.details).toMatchObject({
      action: 'save',
      conversationId: 'conv-123',
      shortSha: expect.any(String),
      fileCount: 1,
      linesAdded: 2,
      linesDeleted: 0,
    });

    const checkpointId = created.details?.checkpointId as string;
    expect(
      getConversationCommitCheckpoint({
        stateRoot,
        profile: 'assistant',
        conversationId: 'conv-123',
        checkpointId,
      }),
    ).toMatchObject({
      commitSha: checkpointId,
      subject: 'feat: checkpoint review',
      fileCount: 1,
      files: [expect.objectContaining({ path: 'README.md', additions: 2, deletions: 0 })],
    });

    const status = spawnSync('git', ['status', '--short'], { cwd: repoRoot, encoding: 'utf-8' });
    expect(status.stdout).toContain('?? notes.txt');
    expect(status.stdout).not.toContain('README.md');
  });

  it('lists and reads saved checkpoints', async () => {
    const repoRoot = createTempRepo();
    const stateRoot = join(repoRoot, '.state');
    const checkpointTool = registerCheckpointTool(stateRoot);
    const ctx = createToolContext(repoRoot);

    writeFileSync(join(repoRoot, 'README.md'), '# demo\n\nOne more line.\n');
    const created = await checkpointTool.execute(
      'tool-1',
      {
        action: 'save',
        message: 'docs: extend readme',
        paths: ['README.md'],
        open: false,
      },
      undefined,
      undefined,
      ctx,
    );

    const checkpointId = created.details?.checkpointId as string;
    const list = await checkpointTool.execute('tool-2', { action: 'list' }, undefined, undefined, ctx);
    expect(list.content[0]?.text).toContain('docs: extend readme');

    const get = await checkpointTool.execute('tool-3', { action: 'get', checkpointId }, undefined, undefined, ctx);
    expect(get.content[0]?.text).toContain('Commit:');
    expect(get.content[0]?.text).toContain('README.md');
    expect(listConversationCommitCheckpoints({ stateRoot, profile: 'assistant', conversationId: 'conv-123' })).toHaveLength(1);
  });
});
