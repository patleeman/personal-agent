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
  it('registers legacy and structured question schemas and guidance', () => {
    const tool = registerAskUserQuestionTool();
    const guidelines = tool.promptGuidelines?.join('\n') ?? '';

    expect(Value.Check(tool.parameters as never, { question: 'Which environment should I use?' })).toBe(true);
    expect(Value.Check(tool.parameters as never, {
      details: 'Need this before proceeding.',
      questions: [{
        label: 'Choose a target',
        style: 'radio',
        options: ['staging', 'prod'],
      }],
    })).toBe(true);
    expect(Value.Check(tool.parameters as never, { details: 'Need this before proceeding.' })).toBe(true);
    expect(guidelines).toContain('Use questions[] when you need multiple questions or radio/check layouts.');
    expect(guidelines).toContain('wait for the user response');
  });

  it('normalizes structured question details and options in the tool result', async () => {
    const tool = registerAskUserQuestionTool();
    const ctx = createToolContext();

    const result = await tool.execute(
      'tool-1',
      {
        details: ' Answer these before I continue. ',
        questions: [
          {
            id: 'target',
            question: ' Which environment should I deploy to? ',
            details: ' Pick the target so I can continue. ',
            style: 'radio',
            options: [' staging ', 'prod', 'prod', ''],
          },
          {
            label: 'Select notifications',
            style: 'checkbox',
            options: [
              { value: 'email', label: 'Email' },
              { value: 'telegram', label: 'Telegram' },
            ],
          },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    expect(result.content[0]?.text).toContain('Asked the user 2 questions.');
    expect(result.content[0]?.text).toContain('Details: Answer these before I continue.');
    expect(result.content[0]?.text).toContain('1. [radio] Which environment should I deploy to?');
    expect(result.content[0]?.text).toContain('2. [check] Select notifications');
    expect(result.details).toMatchObject({
      action: 'ask_user_question',
      conversationId: 'conv-123',
      details: 'Answer these before I continue.',
      questions: [
        {
          id: 'target',
          label: 'Which environment should I deploy to?',
          details: 'Pick the target so I can continue.',
          style: 'radio',
          options: [
            { value: 'staging', label: 'staging' },
            { value: 'prod', label: 'prod' },
          ],
        },
        {
          id: 'question-2',
          label: 'Select notifications',
          style: 'check',
          options: [
            { value: 'email', label: 'Email' },
            { value: 'telegram', label: 'Telegram' },
          ],
        },
      ],
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
    )).rejects.toThrow('question is required when questions is not provided.');
  });
});
