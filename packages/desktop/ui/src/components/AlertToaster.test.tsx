import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AlertToaster } from './AlertToaster';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('AlertToaster', () => {
  it('renders nothing', () => {
    expect(renderToString(<AlertToaster />)).toBe('');
  });
});
