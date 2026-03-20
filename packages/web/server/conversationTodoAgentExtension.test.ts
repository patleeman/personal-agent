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
  it('accepts list as an alias for get', async () => {
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
          skillName: 'workflow-checkpoint',
          now: '2026-03-20T12:00:00.000Z',
        })],
      },
    });

    expect(Value.Check(todoTool.parameters as never, { action: 'list' })).toBe(true);

    const result = await todoTool.execute('tool-1', { action: 'list' }, undefined, undefined, ctx);
    expect(result.content[0]?.text).toContain('Todo list for conversation conv-123');
    expect(result.content[0]?.text).toContain('@item-1');
    expect(result.details).toMatchObject({
      action: 'get',
      conversationId: 'conv-123',
    });
  });

  it('normalizes @-prefixed item ids for explicit completion', async () => {
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
        items: [{
          ...createConversationAutomationTodoItem({
            id: 'item-1',
            label: 'Checkpoint changes',
            skillName: 'workflow-checkpoint',
            now: '2026-03-20T12:00:00.000Z',
          }),
          status: 'completed',
          completedAt: '2026-03-20T12:00:10.000Z',
          updatedAt: '2026-03-20T12:00:10.000Z',
          resultReason: 'Completed.',
        }],
      },
    });

    const result = await todoTool.execute('tool-2', {
      action: 'complete',
      itemId: '@item-1',
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
