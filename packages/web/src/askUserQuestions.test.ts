import { describe, expect, it } from 'vitest';
import type { MessageBlock } from './types';
import {
  buildAskUserQuestionReplyText,
  isAskUserQuestionComplete,
  readAskUserQuestionPresentation,
  resolveAskUserQuestionAnswerLabels,
} from './askUserQuestions';

describe('ask user questions', () => {
  it('normalizes legacy single-question tool blocks', () => {
    const block: Extract<MessageBlock, { type: 'tool_use' }> = {
      type: 'tool_use',
      ts: '2026-03-21T00:00:00.000Z',
      tool: 'ask_user_question',
      input: {
        question: ' Which environment should I use? ',
        details: ' Pick one target. ',
        options: [' staging ', 'prod', 'prod'],
      },
      output: '',
      status: 'ok',
    };

    expect(readAskUserQuestionPresentation(block)).toEqual({
      questions: [{
        id: 'question-1',
        label: 'Which environment should I use?',
        details: 'Pick one target.',
        style: 'radio',
        options: [
          { value: 'staging', label: 'staging' },
          { value: 'prod', label: 'prod' },
        ],
      }],
    });
  });

  it('normalizes structured multi-question payloads with radio and check styles', () => {
    const block: Extract<MessageBlock, { type: 'tool_use' }> = {
      type: 'tool_use',
      ts: '2026-03-21T00:00:00.000Z',
      tool: 'ask_user_question',
      input: {},
      output: '',
      status: 'ok',
      details: {
        action: 'ask_user_question',
        conversationId: 'conv-123',
        details: 'Answer these before I continue.',
        questions: [
          {
            id: 'target',
            label: 'Choose a target',
            style: 'radio',
            options: [
              { value: 'staging', label: 'Staging' },
              { value: 'prod', label: 'Production' },
            ],
          },
          {
            question: 'Select notifications',
            type: 'checkbox',
            options: ['Email', 'Telegram'],
          },
        ],
      },
    };

    expect(readAskUserQuestionPresentation(block)).toEqual({
      details: 'Answer these before I continue.',
      questions: [
        {
          id: 'target',
          label: 'Choose a target',
          style: 'radio',
          options: [
            { value: 'staging', label: 'Staging' },
            { value: 'prod', label: 'Production' },
          ],
        },
        {
          id: 'question-2',
          label: 'Select notifications',
          style: 'check',
          options: [
            { value: 'Email', label: 'Email' },
            { value: 'Telegram', label: 'Telegram' },
          ],
        },
      ],
    });
  });

  it('formats single radio answers as a direct reply and multiple answers as a structured list', () => {
    const singleQuestion = {
      questions: [{
        id: 'target',
        label: 'Choose a target',
        style: 'radio' as const,
        options: [
          { value: 'staging', label: 'Staging' },
          { value: 'prod', label: 'Production' },
        ],
      }],
    };
    const multiQuestion = {
      questions: [
        {
          id: 'target',
          label: 'Choose a target',
          style: 'radio' as const,
          options: [
            { value: 'staging', label: 'Staging' },
            { value: 'prod', label: 'Production' },
          ],
        },
        {
          id: 'notify',
          label: 'Select notifications',
          style: 'check' as const,
          options: [
            { value: 'email', label: 'Email' },
            { value: 'telegram', label: 'Telegram' },
          ],
        },
      ],
    };

    expect(buildAskUserQuestionReplyText(singleQuestion, { target: ['prod'] })).toBe('Production');
    expect(buildAskUserQuestionReplyText(multiQuestion, {
      target: ['staging'],
      notify: ['email', 'telegram'],
    })).toBe([
      'Answers:',
      '- Choose a target: Staging',
      '- Select notifications: Email, Telegram',
    ].join('\n'));
  });

  it('tracks completion and resolves selected labels', () => {
    const presentation = {
      questions: [
        {
          id: 'target',
          label: 'Choose a target',
          style: 'radio' as const,
          options: [
            { value: 'staging', label: 'Staging' },
            { value: 'prod', label: 'Production' },
          ],
        },
        {
          id: 'notify',
          label: 'Select notifications',
          style: 'check' as const,
          options: [
            { value: 'email', label: 'Email' },
            { value: 'telegram', label: 'Telegram' },
          ],
        },
      ],
    };

    expect(isAskUserQuestionComplete(presentation, { target: ['prod'] })).toBe(false);
    expect(isAskUserQuestionComplete(presentation, {
      target: ['prod'],
      notify: ['email'],
    })).toBe(true);
    expect(resolveAskUserQuestionAnswerLabels(presentation.questions[1]!, ['telegram', 'email'])).toEqual(['Telegram', 'Email']);
  });
});
