import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { createConversationAutomationTodoItem, getConversationAutomationState, writeConversationAutomationState } from './conversationAutomation.js';
import { createConversationTodoAgentExtension } from './conversationTodoAgentExtension.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createToolContext(conversationId = 'conv-123') {
  return {
    cwd: '/tmp/workspace',
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

function registerTodoTool(stateRoot: string) {
  let registeredTool:
    | { parameters: object; execute: (...args: unknown[]) => Promise<{ content: Array<{ text?: string }>; details?: Record<string, unknown> }> }
    | undefined;

  createConversationTodoAgentExtension({
    stateRoot,
    getCurrentProfile: () => 'datadog',
  })({
    registerTool: (tool: unknown) => {
      registeredTool = tool as { parameters: object; execute: (...args: unknown[]) => Promise<{ content: Array<{ text?: string }>; details?: Record<string, unknown> }> };
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Todo tool was not registered.');
  }

  return registeredTool;
}

describe('conversation todo agent extension', () => {
  it('uses list as the only inspect action and returns structured output', async () => {
    const stateRoot = createTempDir('pa-web-todo-tool-');
    const todoTool = registerTodoTool(stateRoot);
    const ctx = createToolContext();

    writeConversationAutomationState({
      stateRoot,
      profile: 'datadog',
      document: {
        version: 4,
        conversationId: 'conv-123',
        updatedAt: '2026-03-20T12:00:00.000Z',
        enabled: true,
        items: [createConversationAutomationTodoItem({
          id: 'item-1',
          label: 'Checkpoint changes',
          skillName: 'checkpoint',
          now: '2026-03-20T12:00:00.000Z',
        })],
      },
    });

    expect(Value.Check(todoTool.parameters as never, { action: 'list' })).toBe(true);
    expect(Value.Check(todoTool.parameters as never, { action: 'get' })).toBe(false);

    const result = await todoTool.execute('tool-1', { action: 'list' }, undefined, undefined, ctx);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('"conversationId": "conv-123"');
    expect(text).toContain('"id": "item-1"');
    expect(text).not.toContain('@item-1');
    expect(result.details).toMatchObject({
      action: 'list',
      conversationId: 'conv-123',
      items: [expect.objectContaining({ id: 'item-1', status: 'pending' })],
    });
  });

  it('requires an explicit raw itemId for completion and gives a helpful error', async () => {
    const stateRoot = createTempDir('pa-web-todo-tool-');
    const todoTool = registerTodoTool(stateRoot);
    const ctx = createToolContext();

    writeConversationAutomationState({
      stateRoot,
      profile: 'datadog',
      document: {
        version: 4,
        conversationId: 'conv-123',
        updatedAt: '2026-03-20T12:00:00.000Z',
        enabled: true,
        activeItemId: 'item-1',
        items: [{
          ...createConversationAutomationTodoItem({
            id: 'item-1',
            label: 'Checkpoint changes',
            skillName: 'checkpoint',
            now: '2026-03-20T12:00:00.000Z',
          }),
          status: 'running',
          startedAt: '2026-03-20T12:00:05.000Z',
          updatedAt: '2026-03-20T12:00:05.000Z',
        }],
      },
    });

    await expect(todoTool.execute('tool-2', {
      action: 'complete',
    }, undefined, undefined, ctx)).rejects.toThrow('itemId is required for action "complete"');

    await expect(todoTool.execute('tool-3', {
      action: 'complete',
      itemId: '@item-1',
    }, undefined, undefined, ctx)).rejects.toThrow('Unknown itemId "@item-1"');
  });

  it('completes an item when given the exact raw itemId from list', async () => {
    const stateRoot = createTempDir('pa-web-todo-tool-');
    const todoTool = registerTodoTool(stateRoot);
    const ctx = createToolContext();

    writeConversationAutomationState({
      stateRoot,
      profile: 'datadog',
      document: {
        version: 4,
        conversationId: 'conv-123',
        updatedAt: '2026-03-20T12:00:00.000Z',
        enabled: true,
        items: [createConversationAutomationTodoItem({
          id: 'item-1',
          label: 'Checkpoint changes',
          skillName: 'checkpoint',
          now: '2026-03-20T12:00:00.000Z',
        })],
      },
    });

    const result = await todoTool.execute('tool-4', {
      action: 'complete',
      itemId: 'item-1',
    }, undefined, undefined, ctx);

    expect(result.content[0]?.text).toContain('Marked todo item item-1 completed.');
    expect(result.details).toMatchObject({
      action: 'complete',
      itemId: 'item-1',
    });

    const updated = getConversationAutomationState({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-123',
    });
    expect(updated.items[0]).toMatchObject({
      id: 'item-1',
      status: 'completed',
      resultReason: 'Completed.',
    });
  });
});
