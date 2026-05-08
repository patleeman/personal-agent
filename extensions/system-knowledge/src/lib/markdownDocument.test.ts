import { describe, expect, it } from 'vitest';

import {
  countMarkdownFrontmatterFields,
  parseMarkdownDocument,
  stringifyMarkdownFrontmatter,
  stripMarkdownFrontmatter,
} from './markdownDocument';

describe('markdownDocument helpers', () => {
  it('strips markdown frontmatter for display-only rendering', () => {
    expect(stripMarkdownFrontmatter('---\ntitle: Test\nsummary: Example\n---\n\n# Hello\n\nWorld')).toBe('# Hello\n\nWorld');
  });

  it('returns the full body when frontmatter is absent', () => {
    expect(stripMarkdownFrontmatter('# Hello\n\nWorld')).toBe('# Hello\n\nWorld');
  });

  it('parses structured yaml frontmatter without dropping nested fields', () => {
    const parsed = parseMarkdownDocument(`---
title: Test
tags:
  - alpha
  - beta
metadata:
  area: research
published: false
---

# Hello`);

    expect(parsed.frontmatter).toEqual({
      title: 'Test',
      tags: ['alpha', 'beta'],
      metadata: { area: 'research' },
      published: false,
    });
    expect(parsed.frontmatterError).toBeNull();
    expect(parsed.body).toBe('# Hello');
    expect(countMarkdownFrontmatterFields(parsed.frontmatter)).toBe(4);
  });

  it('keeps the body visible when yaml frontmatter is invalid', () => {
    const parsed = parseMarkdownDocument('---\ntitle: [oops\n---\n\n# Hello');

    expect(parsed.frontmatter).toBeNull();
    expect(parsed.frontmatterError).toBeTruthy();
    expect(parsed.body).toBe('# Hello');
  });

  it('stringifies frontmatter while omitting empty top-level fields', () => {
    expect(stringifyMarkdownFrontmatter({ title: 'Test', tags: [], published: false }, '# Hello')).toBe(`---
title: Test
published: false
---

# Hello`);
  });
});
