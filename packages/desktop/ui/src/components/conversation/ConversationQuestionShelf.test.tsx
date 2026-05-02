import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConversationQuestionShelf } from './ConversationQuestionShelf';
import type { AskUserQuestionPresentation } from '../../transcript/askUserQuestions';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const presentation: AskUserQuestionPresentation = {
  questions: [
    {
      id: 'q1',
      label: 'Pick one',
      details: 'Choose wisely',
      style: 'radio',
      options: [
        { value: 'a', label: 'Alpha', details: 'First' },
        { value: 'b', label: 'Beta' },
      ],
    },
    {
      id: 'q2',
      label: 'Pick many',
      style: 'check',
      options: [
        { value: 'x', label: 'Xray' },
      ],
    },
  ],
};

describe('ConversationQuestionShelf', () => {
  it('renders active question, progress, and options', () => {
    const html = renderToString(
      <ConversationQuestionShelf
        presentation={presentation}
        activeQuestion={presentation.questions[0]!}
        activeQuestionIndex={0}
        activeOptionIndex={1}
        answers={{ q1: ['a'] }}
        submitting={false}
        answeredCount={1}
        onActivateQuestion={vi.fn()}
        onSelectOption={vi.fn()}
      />,
    );

    expect(html).toContain('Answer below');
    expect(html).toContain('1<!-- -->/<!-- -->2');
    expect(html).toContain('Pick one');
    expect(html).toContain('Choose wisely');
    expect(html).toContain('Alpha');
    expect(html).toContain('First');
    expect(html).toContain('Beta');
    expect(html).toContain('◉');
    expect(html).toContain('Type 1-9 to select');
  });

  it('renders checkbox indicators and disabled options while submitting', () => {
    const html = renderToString(
      <ConversationQuestionShelf
        presentation={presentation}
        activeQuestion={presentation.questions[1]!}
        activeQuestionIndex={1}
        activeOptionIndex={0}
        answers={{ q2: ['x'] }}
        submitting
        answeredCount={1}
        onActivateQuestion={vi.fn()}
        onSelectOption={vi.fn()}
      />,
    );

    expect(html).toContain('Pick many');
    expect(html).toContain('☑');
    expect(html).toContain('disabled=""');
  });
});
