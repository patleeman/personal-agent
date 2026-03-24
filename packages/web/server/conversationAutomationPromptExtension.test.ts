import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { createConversationAutomationTodoItem, writeConversationAutomationState } from './conversationAutomation.js';
import { createConversationAutomationPromptExtension } from './conversationAutomationPromptExtension.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function registerHandlers(stateRoot: string, settingsFile?: string) {
  const handlers: Record<string, ((event: any, ctx: any) => any) | undefined> = {};

  createConversationAutomationPromptExtension({
    stateRoot,
    settingsFile,
    getCurrentProfile: () => 'datadog',
  })({
    on: (event: string, registered: (event: any, ctx: any) => any) => {
      handlers[event] = registered;
    },
  } as unknown as ExtensionAPI);

  return {
    beforeAgentStart: handlers.before_agent_start,
    agentStart: handlers.agent_start,
    context: handlers.context,
    toolExecutionEnd: handlers.tool_execution_end,
    agentEnd: handlers.agent_end,
  };
}

function createContext(options: {
  conversationId?: string;
  entries?: Array<{ type?: string; message?: { role?: string; customType?: string } }>;
} = {}) {
  return {
    sessionManager: {
      getSessionId: () => options.conversationId ?? 'conv-123',
      getEntries: () => options.entries ?? [],
    },
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('conversation automation prompt extension', () => {
  it('appends automation policy and an early reminder to the system prompt when open items exist', () => {
    const stateRoot = createTempDir('pa-web-automation-prompt-');
    const handlers = registerHandlers(stateRoot);

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
          kind: 'instruction',
          text: 'Inspect the todo flow and fix the prompt injection path.',
          now: '2026-03-20T12:00:00.000Z',
        })],
      },
    });

    const result = handlers.beforeAgentStart?.({ systemPrompt: 'base system prompt' }, createContext());

    expect(result?.systemPrompt).toContain('base system prompt');
    expect(result?.systemPrompt).toContain('<conversation-automation-policy>');
    expect(result?.systemPrompt).toContain('Before the final user-facing reply, quickly inspect open todo items');
    expect(result?.systemPrompt).toContain('<system-reminder source="conversation-automation" priority="low">');
    expect(result?.systemPrompt).toContain('item-1');
    expect(result?.systemPrompt).toContain('Inspect the todo flow and fix the prompt injection path.');
  });

  it('keeps the early reminder on later user turns without injecting a stored hidden message', () => {
    const stateRoot = createTempDir('pa-web-automation-prompt-');
    const handlers = registerHandlers(stateRoot);

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
            kind: 'instruction',
            text: 'Inspect the todo flow and fix the prompt injection path.',
            now: '2026-03-20T12:00:00.000Z',
          }),
          status: 'running',
          startedAt: '2026-03-20T12:00:05.000Z',
          updatedAt: '2026-03-20T12:00:05.000Z',
        }],
      },
    });

    const result = handlers.beforeAgentStart?.({ systemPrompt: 'base system prompt' }, createContext({
      entries: [{ type: 'message', message: { role: 'user' } }],
    }));

    expect(result?.systemPrompt).toContain('<conversation-automation-policy>');
    expect(result?.systemPrompt).toContain('<system-reminder source="conversation-automation" priority="low">');
    expect(result?.systemPrompt).toContain('Active itemId: item-1');
    expect(result?.message).toBeUndefined();
  });

  it('inherits default workflow presets from settings for the early reminder when no state file exists', () => {
    const stateRoot = createTempDir('pa-web-automation-prompt-');
    const settingsFile = join(stateRoot, 'settings.json');
    const handlers = registerHandlers(stateRoot, settingsFile);

    writeFileSync(settingsFile, JSON.stringify({
      webUi: {
        conversationAutomation: {
          workflowPresets: {
            presets: [{
              id: 'preset-default',
              name: 'Post-conversation Checklist',
              updatedAt: '2026-03-21T12:00:00.000Z',
              items: [{
                id: 'item-default-1',
                kind: 'instruction',
                label: 'Run workflow-checkpoint if code changed',
                text: 'If you made code changes, run /skill:workflow-checkpoint once complete.',
              }],
            }],
            defaultPresetIds: ['preset-default'],
          },
        },
      },
    }, null, 2));

    const result = handlers.beforeAgentStart?.({ systemPrompt: 'base system prompt' }, createContext());

    expect(result?.systemPrompt).toContain('<conversation-automation-policy>');
    expect(result?.systemPrompt).toContain('<system-reminder source="conversation-automation" priority="low">');
    expect(result?.systemPrompt).toContain('/skill:workflow-checkpoint');
  });

  it('keeps only the policy in the system prompt while automation is waiting for the user', () => {
    const stateRoot = createTempDir('pa-web-automation-prompt-');
    const handlers = registerHandlers(stateRoot);

    writeConversationAutomationState({
      stateRoot,
      profile: 'datadog',
      document: {
        version: 4,
        conversationId: 'conv-123',
        updatedAt: '2026-03-20T12:00:00.000Z',
        enabled: false,
        items: [{
          ...createConversationAutomationTodoItem({
            id: 'item-1',
            kind: 'instruction',
            text: 'Ask the user which deployment target to use.',
            now: '2026-03-20T12:00:00.000Z',
          }),
          status: 'waiting',
          updatedAt: '2026-03-20T12:00:05.000Z',
          resultReason: 'Need the deployment target from the user.',
        }],
        waitingForUser: {
          createdAt: '2026-03-20T12:00:05.000Z',
          updatedAt: '2026-03-20T12:00:05.000Z',
          reason: 'Need the deployment target from the user.',
        },
      },
    });

    const result = handlers.beforeAgentStart?.({ systemPrompt: 'base system prompt' }, createContext({
      entries: [{ type: 'message', message: { role: 'user' } }],
    }));

    expect(result?.systemPrompt).toContain('<conversation-automation-policy>');
    expect(result?.systemPrompt).not.toContain('<system-reminder source="conversation-automation" priority="low">');
  });

  it('injects a one-time mid-turn rescue reminder after tool execution when open items remain', () => {
    const stateRoot = createTempDir('pa-web-automation-prompt-');
    const handlers = registerHandlers(stateRoot);

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
          kind: 'instruction',
          text: 'Inspect the todo flow and fix the prompt injection path.',
          now: '2026-03-20T12:00:00.000Z',
        })],
      },
    });

    const ctx = createContext({
      entries: [{ type: 'message', message: { role: 'user' } }],
    });

    handlers.agentStart?.({ type: 'agent_start' }, ctx);
    expect(handlers.context?.({
      type: 'context',
      messages: [{ role: 'user', content: 'Fix it', timestamp: 1 }],
    }, ctx)).toBeUndefined();

    handlers.toolExecutionEnd?.({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'bash',
      result: {},
      isError: false,
    }, ctx);

    const result = handlers.context?.({
      type: 'context',
      messages: [{ role: 'user', content: 'Fix it', timestamp: 1 }],
    }, ctx);

    expect(result?.messages).toHaveLength(2);
    expect(result?.messages?.[1]).toMatchObject({
      role: 'custom',
      customType: 'conversation_automation_rescue',
      display: false,
      content: expect.stringContaining('item-1'),
    });

    handlers.toolExecutionEnd?.({
      type: 'tool_execution_end',
      toolCallId: 'tool-2',
      toolName: 'read',
      result: {},
      isError: false,
    }, ctx);
    expect(handlers.context?.({
      type: 'context',
      messages: [{ role: 'user', content: 'Fix it', timestamp: 1 }],
    }, ctx)).toBeUndefined();
  });

  it('skips the early reminder and rescue during automation-authored hidden turns', () => {
    const stateRoot = createTempDir('pa-web-automation-prompt-');
    const handlers = registerHandlers(stateRoot);

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
          kind: 'instruction',
          text: 'Inspect the todo flow and fix the prompt injection path.',
          now: '2026-03-20T12:00:00.000Z',
        })],
      },
    });

    const ctx = createContext({
      entries: [{ type: 'message', message: { role: 'custom', customType: 'conversation_automation_item' } }],
    });

    const startResult = handlers.beforeAgentStart?.({ systemPrompt: 'base system prompt' }, ctx);
    expect(startResult?.systemPrompt).toContain('<conversation-automation-policy>');
    expect(startResult?.systemPrompt).not.toContain('<system-reminder source="conversation-automation" priority="low">');

    handlers.agentStart?.({ type: 'agent_start' }, ctx);
    handlers.toolExecutionEnd?.({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'bash',
      result: {},
      isError: false,
    }, ctx);

    expect(handlers.context?.({
      type: 'context',
      messages: [{ role: 'custom', content: 'hidden prompt', customType: 'conversation_automation_item', display: false, timestamp: 1 }],
    }, ctx)).toBeUndefined();
  });
});
