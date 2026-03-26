import { describe, expect, it } from 'vitest';
import {
  formatReplyQuoteMarkdown,
  normalizeReplyQuoteSelection,
  prependReplyQuoteToPrompt,
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

describe('prependReplyQuoteToPrompt', () => {
  it('prepends the formatted quote before the typed reply', () => {
    expect(prependReplyQuoteToPrompt('Here is my follow-up.', 'Important line')).toBe('> Important line\n\nHere is my follow-up.');
  });

  it('returns only the quote when the prompt body is empty', () => {
    expect(prependReplyQuoteToPrompt('', 'Important line')).toBe('> Important line');
  });

  it('leaves the prompt unchanged when there is no quote', () => {
    expect(prependReplyQuoteToPrompt('Plain reply', null)).toBe('Plain reply');
  });
});
