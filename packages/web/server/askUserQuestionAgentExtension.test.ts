import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { createAskUserQuestionAgentExtension } from './askUserQuestionAgentExtension.js';

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

function registerAskUserQuestionTool() {
  let registeredTool:
    | {
      parameters: object;
      promptGuidelines?: string[];
      execute: (...args: unknown[]) => Promise<{ content: Array<{ text?: string }>; details?: Record<string, unknown> }>;
    }
    | undefined;

  createAskUserQuestionAgentExtension()({
    registerTool: (tool: unknown) => {
      registeredTool = tool as {
        parameters: object;
        promptGuidelines?: string[];
        execute: (...args: unknown[]) => Promise<{ content: Array<{ text?: string }>; details?: Record<string, unknown> }>;
      };
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Ask user question tool was not registered.');
  }

  return registeredTool;
}

describe('ask user question agent extension', () => {
  it('registers a focused question schema and guidance', () => {
    const tool = registerAskUserQuestionTool();
    const guidelines = tool.promptGuidelines?.join('\n') ?? '';

    expect(Value.Check(tool.parameters as never, { question: 'Which environment should I use?' })).toBe(true);
    expect(Value.Check(tool.parameters as never, { details: 'Need this before proceeding.' })).toBe(false);
    expect(guidelines).toContain('Ask one focused question at a time.');
    expect(guidelines).toContain('wait for the user response');
  });

  it('normalizes question details and quick-reply options in the tool result', async () => {
    const tool = registerAskUserQuestionTool();
    const ctx = createToolContext();

    const result = await tool.execute(
      'tool-1',
      {
        question: ' Which environment should I deploy to? ',
        details: ' Pick the target so I can continue. ',
        options: [' staging ', 'prod', 'prod', ''],
      },
      undefined,
      undefined,
      ctx,
    );

    expect(result.content[0]?.text).toContain('Asked the user: Which environment should I deploy to?');
    expect(result.content[0]?.text).toContain('Details: Pick the target so I can continue.');
    expect(result.content[0]?.text).toContain('Options: staging | prod');
    expect(result.details).toMatchObject({
      action: 'ask_user_question',
      conversationId: 'conv-123',
      question: 'Which environment should I deploy to?',
      details: 'Pick the target so I can continue.',
      options: ['staging', 'prod'],
    });
  });

  it('rejects blank questions', async () => {
    const tool = registerAskUserQuestionTool();
    const ctx = createToolContext();

    await expect(tool.execute(
      'tool-2',
      {
        question: '   ',
      },
      undefined,
      undefined,
      ctx,
    )).rejects.toThrow('question is required.');
  });
});
