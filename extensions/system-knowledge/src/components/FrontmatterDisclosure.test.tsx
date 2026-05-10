import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FrontmatterDisclosure } from './FrontmatterDisclosure';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('FrontmatterDisclosure', () => {
  it('shows a collapsed summary with the frontmatter field count', () => {
    const html = renderToStaticMarkup(<FrontmatterDisclosure frontmatter={{ title: 'Test', status: 'active' }} />);

    expect(html).toContain('Frontmatter');
    expect(html).toContain('2 fields');
    expect(html).not.toContain('<table');
  });

  it('renders frontmatter rows in a key value table when expanded', () => {
    const html = renderToStaticMarkup(
      <FrontmatterDisclosure frontmatter={{ title: 'Test', status: 'active', tags: ['alpha', 'beta'] }} defaultOpen />,
    );

    expect(html).toContain('<table');
    expect(html).toContain('title');
    expect(html).toContain('Test');
    expect(html).toContain('status');
    expect(html).toContain('active');
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
  });

  it('shows an add-field row when frontmatter is editable', () => {
    const html = renderToStaticMarkup(<FrontmatterDisclosure frontmatter={{}} onChange={() => undefined} defaultOpen />);

    expect(html).toContain('New frontmatter field name');
    expect(html).toContain('New frontmatter field value');
    expect(html).toContain('Add field');
    expect(html).toContain('No tags yet…');
  });

  it('shows raw frontmatter when yaml parsing fails', () => {
    const html = renderToStaticMarkup(
      <FrontmatterDisclosure frontmatter={{}} rawFrontmatter={'title: [oops'} parseError={'Unexpected ]'} defaultOpen />,
    );

    expect(html).toContain('Invalid YAML');
    expect(html).toContain('Unexpected ]');
    expect(html).toContain('title: [oops');
  });
});
