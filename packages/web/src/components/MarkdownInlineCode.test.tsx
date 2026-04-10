import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InlineMarkdownCode } from './MarkdownInlineCode.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('InlineMarkdownCode', () => {
  it('uses wrap-friendly inline code styling for long tokens', () => {
    const html = renderToString(
      <InlineMarkdownCode>packages/web/src/pages/ConversationPage.tsx</InlineMarkdownCode>,
    );

    expect(html).toContain('break-words');
    expect(html).toContain('[overflow-wrap:anywhere]');
    expect(html).toContain('whitespace-pre-wrap');
  });
});
