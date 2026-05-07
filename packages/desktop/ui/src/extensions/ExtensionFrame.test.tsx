// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildExtensionFileSrc, ExtensionFrame } from './ExtensionFrame';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
  document.body.innerHTML = '';
});

describe('buildExtensionFileSrc', () => {
  it('encodes extension file entries and launch context', () => {
    expect(
      buildExtensionFileSrc({
        extensionId: 'agent board',
        entry: 'frontend/rail panel.html',
        surfaceId: 'conversation-rail',
        route: null,
        pathname: '/conversations/session-1',
        search: '?run=run-1',
        hash: '#details',
        conversationId: 'session-1',
        cwd: '/tmp/work repo',
      }),
    ).toBe(
      '/api/extensions/agent%20board/files/frontend/rail%20panel.html?surfaceId=conversation-rail&route=&pathname=%2Fconversations%2Fsession-1&search=%3Frun%3Drun-1&hash=%23details&conversationId=session-1&cwd=%2Ftmp%2Fwork+repo',
    );
  });

  it('renders an iframe pointed at the extension file route', () => {
    const html = renderToString(
      <ExtensionFrame
        title="Agent Board"
        extensionId="agent-board"
        entry="frontend/page.html"
        surfaceId="page"
        route="/ext/agent-board"
        pathname="/ext/agent-board"
        search=""
        hash=""
      />,
    );

    expect(html).toContain('title="Agent Board"');
    expect(html).toContain('/api/extensions/agent-board/files/frontend/page.html?');
  });

  it('inlines PA styles and passes the active theme into html extension frames', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/pa/client.js')) return new Response('window.__clientLoaded = true;', { status: 200 });
      if (url.includes('/pa/components.css')) return new Response(':root { --pa-bg: rgb(var(--color-base)); }', { status: 200 });
      return new Response('<!doctype html><html><head></head><body><main>Extension</main></body></html>', { status: 200 });
    });

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ExtensionFrame
          title="Agent Board"
          extensionId="agent-board"
          entry="frontend/page.html"
          surfaceId="page"
          route="/ext/agent-board"
          pathname="/ext/agent-board"
          search=""
          hash=""
        />,
      );
    });
    await act(async () => Promise.resolve());

    const iframe = host.querySelector('iframe');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/pa/components.css'));
    expect(iframe?.getAttribute('srcdoc')).toContain('<html data-theme="dark">');
    expect(iframe?.getAttribute('srcdoc')).toContain('theme":"dark"');

    await act(async () => {
      root.unmount();
    });
  });
});
