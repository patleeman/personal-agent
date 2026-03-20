import { mkdtempSync } from 'node:fs';
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

function registerBeforeAgentStartHandler(stateRoot: string) {
  let handler:
    | ((event: { systemPrompt?: string }, ctx: {
      sessionManager: {
        getSessionId: () => string;
        getEntries?: () => Array<{ type?: string; message?: { role?: string } }>;
      };
    }) => { systemPrompt?: string; message?: { customType: string; content: string; display: boolean } } | undefined)
    | undefined;

  createConversationAutomationPromptExtension({
    stateRoot,
    getCurrentProfile: () => 'datadog',
  })({
    on: (event: string, registered: typeof handler) => {
      if (event === 'before_agent_start') {
        handler = registered;
      }
    },
  } as unknown as ExtensionAPI);

  if (!handler) {
    throw new Error('before_agent_start handler was not registered');
  }

  return handler;
}

function createContext(options: {
  conversationId?: string;
  entries?: Array<{ type?: string; message?: { role?: string } }>;
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
  it('appends automation instructions to the system prompt when automation is active', () => {
    const stateRoot = createTempDir('pa-web-automation-prompt-');
    const handler = registerBeforeAgentStartHandler(stateRoot);

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

    const result = handler({ systemPrompt: 'base system prompt' }, createContext());

    expect(result?.systemPrompt).toContain('base system prompt');
    expect(result?.systemPrompt).toContain('<conversation-automation-policy>');
    expect(result?.systemPrompt).toContain('Conversation automation uses the todo_list tool for secondary bookkeeping behind the user message.');
    expect(result?.systemPrompt).toContain('If more automation work depends on user input, call wait_for_user');
    expect(result?.systemPrompt).not.toContain('item-1');
    expect(result?.message).toBeUndefined();
  });

  it('keeps automation instructions in the system prompt on later user turns without injecting todo state as a message', () => {
    const stateRoot = createTempDir('pa-web-automation-prompt-');
    const handler = registerBeforeAgentStartHandler(stateRoot);

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

    const result = handler({ systemPrompt: 'base system prompt' }, createContext({
      entries: [{ type: 'message', message: { role: 'user' } }],
    }));

    expect(result?.systemPrompt).toContain('<conversation-automation-policy>');
    expect(result?.systemPrompt).not.toContain('item-1');
    expect(result?.message).toBeUndefined();
  });

  it('keeps only the system-prompt instructions while automation is waiting for the user', () => {
    const stateRoot = createTempDir('pa-web-automation-prompt-');
    const handler = registerBeforeAgentStartHandler(stateRoot);

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

    const result = handler({ systemPrompt: 'base system prompt' }, createContext({
      entries: [{ type: 'message', message: { role: 'user' } }],
    }));

    expect(result?.systemPrompt).toContain('<conversation-automation-policy>');
    expect(result?.message).toBeUndefined();
  });
});
