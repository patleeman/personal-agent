import { describe, expect, it } from 'vitest';

import type { MessageBlock } from '../../shared/types';
import { describeAskUserQuestionState, summarizeAskUserQuestionAnswer } from './AskUserQuestionToolBlock.js';

const askBlock: Extract<MessageBlock, { type: 'tool_use' }> = {
  type: 'tool_use',
  ts: '2026-04-26T00:00:00.000Z',
  tool: 'ask_user_question',
  input: {},
  output: '',
};

describe('AskUserQuestionToolBlock helpers', () => {
  it('describes pending questions when there is no following answer', () => {
    expect(describeAskUserQuestionState([askBlock], 0)).toEqual({ status: 'pending' });
    expect(describeAskUserQuestionState(undefined, undefined)).toEqual({ status: 'pending' });
  });

  it('describes answered questions from the next user message', () => {
    const answer: Extract<MessageBlock, { type: 'user' }> = {
      type: 'user',
      ts: '2026-04-26T00:00:01.000Z',
      text: 'Ship it',
    };

    expect(describeAskUserQuestionState([askBlock, answer], 0)).toEqual({
      status: 'answered',
      answerBlock: answer,
    });
  });

  it('marks older questions superseded by a newer question', () => {
    expect(describeAskUserQuestionState([askBlock, { ...askBlock, ts: '2026-04-26T00:00:01.000Z' }], 0)).toEqual({
      status: 'superseded',
    });
  });

  it('summarizes text answers and image-only answers', () => {
    expect(summarizeAskUserQuestionAnswer({ type: 'user', ts: '2026-04-26T00:00:00.000Z', text: '  hello\nworld  ' })).toBe('hello world');
    expect(
      summarizeAskUserQuestionAnswer({
        type: 'user',
        ts: '2026-04-26T00:00:00.000Z',
        text: '',
        images: [{ id: 'img', src: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' }],
      }),
    ).toBe('Sent 1 image attachment.');
    expect(summarizeAskUserQuestionAnswer(undefined)).toBeNull();
  });

  it('ignores malformed image-only answers when summarizing', () => {
    expect(
      summarizeAskUserQuestionAnswer({
        type: 'user',
        ts: '2026-04-26T00:00:00.000Z',
        text: '',
        images: [
          { id: 'bad-data', src: 'data:', mimeType: 'image/png' },
          { id: 'bad-mime', src: 'data:text/plain;base64,aGVsbG8=', mimeType: 'text/plain' },
          { id: 'bad-base64', src: 'data:image/png;base64,not-valid-base64!', mimeType: 'image/png' },
        ],
      }),
    ).toBeNull();
  });

  it('truncates long text answers', () => {
    const text = 'x'.repeat(220);
    const summary = summarizeAskUserQuestionAnswer({ type: 'user', ts: '2026-04-26T00:00:00.000Z', text });

    expect(summary).toHaveLength(180);
    expect(summary?.endsWith('…')).toBe(true);
  });
});
