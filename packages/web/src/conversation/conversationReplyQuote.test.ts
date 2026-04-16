import { describe, expect, it } from 'vitest';
import {
  formatReplyQuoteMarkdown,
  insertReplyQuoteIntoComposer,
  normalizeReplyQuoteSelection,
} from './conversationReplyQuote';

describe('normalizeReplyQuoteSelection', () => {
  it('trims the selection and normalizes newlines and nbsp characters', () => {
    expect(normalizeReplyQuoteSelection('  first\u00a0line\r\nsecond line  ')).toBe('first line\nsecond line');
  });

  it('preserves intentional blank lines inside the selection', () => {
    expect(normalizeReplyQuoteSelection('alpha\n\n beta\n')).toBe('alpha\n\n beta');
  });
});

describe('formatReplyQuoteMarkdown', () => {
  it('formats a multi-line selection as a markdown blockquote', () => {
    expect(formatReplyQuoteMarkdown('alpha\n\nbeta')).toBe('> alpha\n>\n> beta');
  });

  it('returns an empty string for an empty selection', () => {
    expect(formatReplyQuoteMarkdown('   ')).toBe('');
  });
});

describe('insertReplyQuoteIntoComposer', () => {
  it('appends a formatted quote and leaves the caret after it', () => {
    expect(insertReplyQuoteIntoComposer('', 'Important line')).toEqual({
      text: '> Important line\n\n',
      selectionStart: 18,
      selectionEnd: 18,
    });
  });

  it('appends the quote after an existing draft when no insertion range is provided', () => {
    expect(insertReplyQuoteIntoComposer('Existing draft', 'Important line')).toEqual({
      text: 'Existing draft\n\n> Important line\n\n',
      selectionStart: 34,
      selectionEnd: 34,
    });
  });

  it('inserts a quote at the requested caret position', () => {
    expect(insertReplyQuoteIntoComposer('Intro\n\nOutro', 'Important line', { start: 7, end: 7 })).toEqual({
      text: 'Intro\n\n> Important line\n\nOutro',
      selectionStart: 25,
      selectionEnd: 25,
    });
  });

  it('supports inserting multiple quotes one after another', () => {
    const first = insertReplyQuoteIntoComposer('', 'First point');
    const second = insertReplyQuoteIntoComposer(first.text, 'Second point', {
      start: first.selectionStart,
      end: first.selectionEnd,
    });

    expect(second).toEqual({
      text: '> First point\n\n> Second point\n\n',
      selectionStart: 31,
      selectionEnd: 31,
    });
  });
});
