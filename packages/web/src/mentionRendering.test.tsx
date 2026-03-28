import React, { Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { buildMentionLookup, renderTextWithMentionLinks } from './mentionRendering';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('mentionRendering', () => {
  it('renders unique node mentions as links for the main app surface', () => {
    const lookup = buildMentionLookup([
      { id: '@web-ui', label: 'web-ui', kind: 'project', title: 'Web UI' },
      { id: '@note-index', label: 'note-index', kind: 'note', title: 'Note index' },
      { id: '@tool-agent-browser', label: 'tool-agent-browser', kind: 'skill', title: 'Tool Agent Browser' },
    ]);

    const html = renderToStaticMarkup(
      <StaticRouter location="/">
        <Fragment>{renderTextWithMentionLinks('See @web-ui with @note-index and @tool-agent-browser.', { lookup, surface: 'main' })}</Fragment>
      </StaticRouter>,
    );

    expect(html).toContain('href="/nodes?kind=project&amp;node=web-ui"');
    expect(html).toContain('href="/nodes?kind=note&amp;node=note-index"');
    expect(html).toContain('href="/nodes?kind=skill&amp;node=tool-agent-browser"');
  });

  it('falls back to a non-link pill for ambiguous mentions', () => {
    const lookup = buildMentionLookup([
      { id: '@shared-id', label: 'shared-id', kind: 'project', title: 'Shared project' },
      { id: '@shared-id', label: 'shared-id', kind: 'note', title: 'Shared note' },
    ]);

    const html = renderToStaticMarkup(
      <StaticRouter location="/">
        <Fragment>{renderTextWithMentionLinks('Keep @shared-id visible.', { lookup, surface: 'main' })}</Fragment>
      </StaticRouter>,
    );

    expect(html).toContain('class="ui-markdown-mention"');
    expect(html).not.toContain('href="/nodes?kind=project&amp;node=shared-id"');
    expect(html).not.toContain('href="/nodes?kind=note&amp;node=shared-id"');
  });
});
