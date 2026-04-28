import { describe, expect, it } from 'vitest';
import type { MessageBlock } from '../shared/types';
import {
  buildAskUserQuestionReplyText,
  countAnsweredAskUserQuestions,
  findPendingAskUserQuestion,
  isAskUserQuestionComplete,
  moveAskUserQuestionIndex,
  readAskUserQuestionPresentation,
  resolveAskUserQuestionAnswerSelection,
  resolveAskUserQuestionDefaultOptionIndex,
  resolveAskUserQuestionNavigationHotkey,
  resolveAskUserQuestionOptionHotkey,
  shouldAdvanceAskUserQuestionAfterSelection,
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
            options: ['Email', 'SMS'],
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
            { value: 'SMS', label: 'SMS' },
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
            { value: 'sms', label: 'SMS' },
          ],
        },
      ],
    };

    expect(buildAskUserQuestionReplyText(singleQuestion, { target: ['prod'] })).toBe('Production');
    expect(buildAskUserQuestionReplyText(multiQuestion, {
      target: ['staging'],
      notify: ['email', 'sms'],
    })).toBe([
      'Answers:',
      '- Choose a target: Staging',
      '- Select notifications: Email, SMS',
    ].join('\n'));
  });

  it('tracks completion and formats selected labels', () => {
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
            { value: 'sms', label: 'SMS' },
          ],
        },
      ],
    };

    expect(isAskUserQuestionComplete(presentation, { target: ['prod'] })).toBe(false);
    expect(isAskUserQuestionComplete(presentation, {
      target: ['prod'],
      notify: ['email'],
    })).toBe(true);
    expect(buildAskUserQuestionReplyText({ questions: [presentation.questions[1]!] }, { notify: ['sms', 'email'] }))
      .toBe('Select notifications: SMS, Email');
    expect(countAnsweredAskUserQuestions(presentation, { target: ['prod'] })).toBe(1);
    expect(countAnsweredAskUserQuestions(null, { target: ['prod'] })).toBe(0);
  });

  it('resolves radio and checkbox answer selection updates', () => {
    const radioQuestion = {
      id: 'target',
      label: 'Choose a target',
      style: 'radio' as const,
      options: [
        { value: 'staging', label: 'Staging' },
        { value: 'prod', label: 'Production' },
      ],
    };
    const checkQuestion = {
      id: 'notify',
      label: 'Select notifications',
      style: 'check' as const,
      options: [
        { value: 'email', label: 'Email' },
        { value: 'sms', label: 'SMS' },
      ],
    };

    expect(resolveAskUserQuestionAnswerSelection({
      question: radioQuestion,
      option: radioQuestion.options[1]!,
      answers: { target: ['staging'] },
    })).toEqual({
      selectedValues: ['prod'],
      nextAnswers: { target: ['prod'] },
    });

    expect(resolveAskUserQuestionAnswerSelection({
      question: checkQuestion,
      option: checkQuestion.options[1]!,
      answers: { notify: ['email'] },
    })).toEqual({
      selectedValues: ['email', 'sms'],
      nextAnswers: { notify: ['email', 'sms'] },
    });

    expect(resolveAskUserQuestionAnswerSelection({
      question: checkQuestion,
      option: checkQuestion.options[0]!,
      answers: { notify: ['email', 'sms'] },
    })).toEqual({
      selectedValues: ['sms'],
      nextAnswers: { notify: ['sms'] },
    });
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

  it('only auto-advances checkbox questions after every option is selected', () => {
    const radioQuestion = {
      id: 'target',
      label: 'Choose a target',
      style: 'radio' as const,
      options: [
        { value: 'staging', label: 'Staging' },
        { value: 'prod', label: 'Production' },
      ],
    };
    const checkQuestion = {
      id: 'notify',
      label: 'Select notifications',
      style: 'check' as const,
      options: [
        { value: 'email', label: 'Email' },
        { value: 'sms', label: 'SMS' },
      ],
    };

    expect(shouldAdvanceAskUserQuestionAfterSelection(radioQuestion, ['prod'])).toBe(true);
    expect(shouldAdvanceAskUserQuestionAfterSelection(checkQuestion, ['email'])).toBe(false);
    expect(shouldAdvanceAskUserQuestionAfterSelection(checkQuestion, ['email', 'sms'])).toBe(true);
    expect(shouldAdvanceAskUserQuestionAfterSelection(checkQuestion, [])).toBe(false);
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
