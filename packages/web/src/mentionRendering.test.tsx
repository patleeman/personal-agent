import React, { Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { buildMentionLookup, renderTextWithMentionLinks } from './mentionRendering';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('mentionRendering', () => {
  it('renders unique node mentions as plain mention pills when page routes are unavailable', () => {
    const lookup = buildMentionLookup([
      { id: '@note-index', label: 'note-index', kind: 'note', title: 'Note index' },
      { id: '@agent-browser', label: 'agent-browser', kind: 'skill', title: 'Agent Browser' },
    ]);

    const html = renderToStaticMarkup(
      <StaticRouter location="/">
        <Fragment>{renderTextWithMentionLinks('See @note-index with @agent-browser.', { lookup, surface: 'main' })}</Fragment>
      </StaticRouter>,
    );

    expect(html).toContain('class="ui-markdown-mention"');
    expect(html).toContain('@note-index');
    expect(html).toContain('@agent-browser');
    expect(html).not.toContain('href=');
  });

  it('falls back to a non-link pill for ambiguous mentions', () => {
    const lookup = buildMentionLookup([
      { id: '@shared-id', label: 'shared-id', kind: 'note', title: 'Shared note' },
      { id: '@shared-id', label: 'shared-id', kind: 'skill', title: 'Shared skill' },
    ]);

    const html = renderToStaticMarkup(
      <StaticRouter location="/">
        <Fragment>{renderTextWithMentionLinks('Keep @shared-id visible.', { lookup, surface: 'main' })}</Fragment>
      </StaticRouter>,
    );

    expect(html).toContain('class="ui-markdown-mention"');
    expect(html).not.toContain('href="/pages?kind=note&amp;page=shared-id"');
    expect(html).not.toContain('href="/pages?kind=skill&amp;page=shared-id"');
  });
});
