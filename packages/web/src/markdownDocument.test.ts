import { describe, expect, it } from 'vitest';
import { joinMarkdownFrontmatter, normalizeMarkdownValue, splitMarkdownFrontmatter, stripMarkdownFrontmatter } from './markdownDocument';

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

  it('joins edited body content back with preserved frontmatter', () => {
    expect(joinMarkdownFrontmatter('title: Test\nsummary: Example', '# Updated\n\nBody')).toBe('---\ntitle: Test\nsummary: Example\n---\n\n# Updated\n\nBody\n');
  });

  it('strips frontmatter for display-only rendering', () => {
    expect(stripMarkdownFrontmatter('---\ntitle: Test\n---\n\n# Hello\n\nWorld')).toBe('# Hello\n\nWorld');
  });

  it('normalizes markdown values before editor comparisons', () => {
    expect(normalizeMarkdownValue('\n\n# Hello\r\n\r\nWorld\n')).toBe('# Hello\n\nWorld');
  });
});
