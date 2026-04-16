import { describe, expect, it } from 'vitest';
import { stripMarkdownFrontmatter } from './markdownDocument';

describe('markdownDocument helpers', () => {
  it('strips markdown frontmatter for display-only rendering', () => {
    expect(stripMarkdownFrontmatter('---\ntitle: Test\nsummary: Example\n---\n\n# Hello\n\nWorld')).toBe('# Hello\n\nWorld');
  });

  it('returns the full body when frontmatter is absent', () => {
    expect(stripMarkdownFrontmatter('# Hello\n\nWorld')).toBe('# Hello\n\nWorld');
  });
});
