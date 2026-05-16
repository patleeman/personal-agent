import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

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
  it('registers guidance for structured questionnaires', () => {
    const tool = registerAskUserQuestionTool();
    const guidelines = tool.promptGuidelines?.join('\n') ?? '';

    expect(Value.Check(tool.parameters as never, { question: 'Which environment should I use?' })).toBe(true);
    expect(
      Value.Check(tool.parameters as never, {
        questions: [
          {
            label: 'Which environment should I use?',
            style: 'radio',
            options: ['staging', 'prod'],
          },
        ],
      }),
    ).toBe(true);
    expect(guidelines).toContain('questions[]');
    expect(guidelines).toContain('radio');
    expect(guidelines).toContain('check style');
    expect(guidelines).toContain('queue_followup');
  });

  it('normalizes structured multi-question payloads in the tool result', async () => {
    const tool = registerAskUserQuestionTool();
    const ctx = createToolContext();

    const result = await tool.execute(
      'tool-1',
      {
        details: 'Ask these before continuing.',
        questions: [
          {
            id: 'target',
            label: ' Which environment should I deploy to? ',
            style: 'radio',
            options: [' staging ', 'prod'],
          },
          {
            question: ' Which notifications should I enable? ',
            style: 'checkbox',
            options: [
              { value: 'email', label: 'Email' },
              { value: 'sms', label: 'SMS' },
            ],
          },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    expect(result.content[0]?.text).toContain('Asked the user 2 questions.');
    expect(result.content[0]?.text).toContain('[radio] Which environment should I deploy to?');
    expect(result.content[0]?.text).toContain('[check] Which notifications should I enable?');
    expect(result.details).toMatchObject({
      action: 'ask_user_question',
      conversationId: 'conv-123',
      details: 'Ask these before continuing.',
      questions: [
        {
          id: 'target',
          label: 'Which environment should I deploy to?',
          style: 'radio',
          options: [
            { value: 'staging', label: 'staging' },
            { value: 'prod', label: 'prod' },
          ],
        },
        {
          id: 'question-2',
          label: 'Which notifications should I enable?',
          style: 'check',
          options: [
            { value: 'email', label: 'Email' },
            { value: 'sms', label: 'SMS' },
          ],
        },
      ],
    });
  });

  it('still supports the legacy single-question form', async () => {
    const tool = registerAskUserQuestionTool();
    const ctx = createToolContext();

    const result = await tool.execute(
      'tool-2',
      {
        question: ' Which environment should I deploy to? ',
        details: ' Pick one target so I can continue. ',
        options: [' staging ', 'prod', 'prod'],
      },
      undefined,
      undefined,
      ctx,
    );

    expect(result.details).toMatchObject({
      questions: [
        {
          id: 'question-1',
          label: 'Which environment should I deploy to?',
          details: 'Pick one target so I can continue.',
          style: 'radio',
          options: [
            { value: 'staging', label: 'staging' },
            { value: 'prod', label: 'prod' },
          ],
        },
      ],
    });
  });

  it('rejects invalid structured questions', async () => {
    const tool = registerAskUserQuestionTool();
    const ctx = createToolContext();

    await expect(
      tool.execute(
        'tool-3',
        {
          questions: [
            {
              label: 'Missing options',
              style: 'radio',
              options: [],
            },
          ],
        },
        undefined,
        undefined,
        ctx,
      ),
    ).rejects.toThrow('questions[0] requires at least one option.');
  });
});
