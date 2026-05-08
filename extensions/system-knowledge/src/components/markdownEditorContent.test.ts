import { describe, expect, it } from 'vitest';

import { readMarkdownFromEditor } from './markdownEditorContent';

describe('readMarkdownFromEditor', () => {
  it('reads markdown through editor.getMarkdown()', () => {
    expect(readMarkdownFromEditor({ getMarkdown: () => '# hello' })).toBe('# hello');
  });

  it('returns an empty string when markdown serialization is unavailable', () => {
    expect(readMarkdownFromEditor(null)).toBe('');
    expect(readMarkdownFromEditor({})).toBe('');
  });
});
