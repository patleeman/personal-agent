import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RichMarkdownRenderer } from './RichMarkdownRenderer';

vi.mock('../../hooks', () => ({
  useNodeMentionItems: () => ({ data: [], loading: false, refreshing: false, error: null, refetch: vi.fn() }),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('RichMarkdownRenderer', () => {
  it('renders unsupported custom directives as plain markdown text', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RichMarkdownRenderer content={':::fields\nsummary: Durable note\nstatus: active\n:::'} />
      </MemoryRouter>,
    );

    expect(html).toContain(':::fields');
    expect(html).toContain('summary: Durable note');
    expect(html).toContain('status: active');
  });

  it('strips frontmatter when requested', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RichMarkdownRenderer content={'---\ntitle: Test\n---\n\n# Hello'} stripFrontmatter />
      </MemoryRouter>,
    );

    expect(html).toContain('Hello');
    expect(html).not.toContain('title: Test');
  });

  it('renders inline markdown images', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RichMarkdownRenderer content={'Before\n\n![Architecture diagram](data:image/png;base64,abc123)\n\nAfter'} />
      </MemoryRouter>,
    );

    expect(html).toContain('<img');
    expect(html).toContain('alt="Architecture diagram"');
    expect(html).toContain('src="data:image/png;base64,abc123"');
  });
});
