import { describe, expect, it } from 'vitest';
import { splitMarkdownFrontmatter, stripMarkdownFrontmatter } from './markdownDocument';

describe('markdownDocument helpers', () => {
  it('splits markdown frontmatter from the body', () => {
    expect(splitMarkdownFrontmatter('---\ntitle: Test\nsummary: Example\n---\n\n# Hello\n\nWorld')).toEqual({
      frontmatter: 'title: Test\nsummary: Example',
      body: '# Hello\n\nWorld',
    });
  });

  it('returns the full body when frontmatter is absent', () => {
    expect(splitMarkdownFrontmatter('# Hello\n\nWorld')).toEqual({
      frontmatter: null,
      body: '# Hello\n\nWorld',
    });
  });


  it('strips frontmatter for display-only rendering', () => {
    expect(stripMarkdownFrontmatter('---\ntitle: Test\n---\n\n# Hello\n\nWorld')).toBe('# Hello\n\nWorld');
  });

});
