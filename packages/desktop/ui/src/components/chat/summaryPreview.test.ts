import { describe, expect, it } from 'vitest';

import { buildSummaryPreview, formatSummaryPreviewLine, stripPreviewMarkdownWrappers } from './summaryPreview.js';

describe('summaryPreview', () => {
  it('strips simple markdown wrappers from preview lines', () => {
    expect(stripPreviewMarkdownWrappers('**bold**')).toBe('bold');
    expect(stripPreviewMarkdownWrappers('__bold__')).toBe('bold');
    expect(stripPreviewMarkdownWrappers('*italic*')).toBe('italic');
    expect(stripPreviewMarkdownWrappers('_italic_')).toBe('italic');
    expect(stripPreviewMarkdownWrappers('`code`')).toBe('code');
  });

  it('formats heading and list lines for compact previews', () => {
    expect(formatSummaryPreviewLine('### Heading')).toBe('Heading');
    expect(formatSummaryPreviewLine('- **item**')).toBe('• item');
    expect(formatSummaryPreviewLine('* `command`')).toBe('• command');
  });

  it('builds a non-empty line preview with a line cap', () => {
    expect(buildSummaryPreview('\n# First\n\n- second\nthird', 2)).toBe('First\n• second');
    expect(buildSummaryPreview(Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n'), Number.MAX_SAFE_INTEGER)).toBe(
      ['line 0', 'line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6', 'line 7'].join('\n'),
    );
    expect(buildSummaryPreview('first\nsecond', 1.5)).toBe('first');
  });
});
