import { describe, expect, it } from 'vitest';
import type { MessageBlock } from './types';
import {
  buildAskUserQuestionReplyText,
  findPendingAskUserQuestion,
  isAskUserQuestionComplete,
  moveAskUserQuestionIndex,
  readAskUserQuestionPresentation,
  resolveAskUserQuestionAnswerLabels,
  resolveAskUserQuestionDefaultOptionIndex,
  resolveAskUserQuestionNavigationHotkey,
  resolveAskUserQuestionOptionHotkey,
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

  it('finds the latest pending question before any later user reply', () => {
    const pending = findPendingAskUserQuestion([
      {
        type: 'tool_use',
        ts: '2026-03-21T00:00:00.000Z',
        tool: 'ask_user_question',
        input: { question: 'First?', options: ['A', 'B'] },
        output: '',
        status: 'ok',
      },
      {
        type: 'tool_use',
        ts: '2026-03-21T00:00:01.000Z',
        tool: 'ask_user_question',
        input: { question: 'Second?', options: ['C', 'D'] },
        output: '',
        status: 'ok',
      },
    ]);

    expect(pending?.messageIndex).toBe(1);
    expect(pending?.presentation.questions[0]?.label).toBe('Second?');
    expect(findPendingAskUserQuestion([
      {
        type: 'tool_use',
        ts: '2026-03-21T00:00:00.000Z',
        tool: 'ask_user_question',
        input: { question: 'Answered?', options: ['Yes', 'No'] },
        output: '',
        status: 'ok',
      },
      {
        type: 'user',
        ts: '2026-03-21T00:00:01.000Z',
        text: 'Yes',
      },
    ])).toBeNull();
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

  it('resolves default option indices and wraps navigation indices', () => {
    const question = {
      id: 'target',
      label: 'Choose a target',
      style: 'radio' as const,
      options: [
        { value: 'staging', label: 'Staging' },
        { value: 'prod', label: 'Production' },
        { value: 'dev', label: 'Development' },
      ],
    };

    expect(resolveAskUserQuestionDefaultOptionIndex(question, {})).toBe(0);
    expect(resolveAskUserQuestionDefaultOptionIndex(question, { target: ['prod'] })).toBe(1);
    expect(moveAskUserQuestionIndex(0, 3, -1)).toBe(2);
    expect(moveAskUserQuestionIndex(2, 3, 1)).toBe(0);
  });

  it('resolves numeric selection and next/previous hotkeys', () => {
    expect(resolveAskUserQuestionOptionHotkey('1')).toBe(0);
    expect(resolveAskUserQuestionOptionHotkey('9')).toBe(8);
    expect(resolveAskUserQuestionOptionHotkey('0')).toBe(-1);
    expect(resolveAskUserQuestionNavigationHotkey('n')).toBe(1);
    expect(resolveAskUserQuestionNavigationHotkey('j')).toBe(1);
    expect(resolveAskUserQuestionNavigationHotkey('p')).toBe(-1);
    expect(resolveAskUserQuestionNavigationHotkey('k')).toBe(-1);
    expect(resolveAskUserQuestionNavigationHotkey('x')).toBe(0);
  });
});
