import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { navigateSpy } = vi.hoisted(() => ({
  navigateSpy: vi.fn((props: { to: string; replace?: boolean }) => <div data-to={props.to}>Redirecting…</div>),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    Navigate: navigateSpy,
  };
});

import { SystemPage } from './SystemPage.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('SystemPage', () => {
  it('redirects the legacy system route to settings', () => {
    const html = renderToString(<SystemPage />);

    expect(html).toContain('Redirecting…');
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/settings', replace: true }, expect.anything());
  });
});
