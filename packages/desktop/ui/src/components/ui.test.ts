import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { cx, Pill } from './ui';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('ui helpers', () => {
  it('joins only truthy class parts', () => {
    expect(cx('base', false && 'hidden', undefined, 'active')).toBe('base active');
  });

  it('renders the shared class for each pill tone', () => {
    expect(renderToStaticMarkup(createElement(Pill, { tone: 'muted' }, 'one'))).toContain('ui-pill-muted');
    expect(renderToStaticMarkup(createElement(Pill, { tone: 'accent' }, 'two'))).toContain('ui-pill-accent');
    expect(renderToStaticMarkup(createElement(Pill, { tone: 'solidAccent' }, 'three'))).toContain('ui-pill-solid-accent');
  });
});
