import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FilePathPreformattedText, normalizeDetectedFilePath, renderFilePathTextFragments } from './filePathLinks.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('normalizeDetectedFilePath', () => {
  it('recognizes repo-relative and local filesystem paths', () => {
    expect(normalizeDetectedFilePath('packages/web/src/App.tsx')).toBe('packages/web/src/App.tsx');
    expect(normalizeDetectedFilePath('/Users/patrick/notes.md')).toBe('/Users/patrick/notes.md');
  });

  it('strips git diff prefixes from file tokens', () => {
    expect(normalizeDetectedFilePath('a/packages/web/src/App.tsx')).toBe('packages/web/src/App.tsx');
    expect(normalizeDetectedFilePath('b/packages/web/src/App.tsx')).toBe('packages/web/src/App.tsx');
  });
});

describe('renderFilePathTextFragments', () => {
  it('renders clickable file-path buttons inside inline text', () => {
    const html = renderToStaticMarkup(
      <span>{renderFilePathTextFragments('Touch packages/web/src/App.tsx next.', { onOpenFilePath: () => undefined })}</span>,
    );

    expect(html).toContain('data-file-path-link="packages/web/src/App.tsx"');
    expect(html).toContain('aria-label="Open packages/web/src/App.tsx"');
    expect(html).toContain('Touch ');
  });

  it('uses wrap-friendly inline code styling for clickable file paths', () => {
    const html = renderToStaticMarkup(
      <span>{renderFilePathTextFragments('Touch packages/web/src/App.tsx next.', { onOpenFilePath: () => undefined, variant: 'code' })}</span>,
    );

    expect(html).toContain('break-words');
    expect(html).toContain('[overflow-wrap:anywhere]');
    expect(html).toContain('whitespace-pre-wrap');
  });
});

describe('FilePathPreformattedText', () => {
  it('linkifies git diff headers', () => {
    const html = renderToStaticMarkup(
      <FilePathPreformattedText
        text={'diff --git a/packages/web/src/App.tsx b/packages/web/src/App.tsx\n+++ b/packages/web/src/App.tsx'}
        onOpenFilePath={() => undefined}
      />,
    );

    expect(html).toContain('data-file-path-link="packages/web/src/App.tsx"');
    expect(html).toContain('diff --git');
    expect(html).toContain('+++');
  });
});
