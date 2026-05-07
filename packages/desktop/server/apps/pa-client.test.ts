import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import { PA_CLIENT_JS } from './pa-client.js';

async function renderAppHtml(html: string, url = 'http://127.0.0.1:9876/'): Promise<Document> {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url,
    runScripts: 'outside-only',
  });
  dom.window.eval(PA_CLIENT_JS);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 5));
  return dom.window.document;
}

describe('PA skill app client components', () => {
  it('exposes extension launch context from iframe query params', async () => {
    const document = await renderAppHtml(
      '<main></main>',
      'http://127.0.0.1:9876/api/extensions/agent-board/files/frontend/index.html?surfaceId=page&route=%2Fext%2Fagent-board&pathname=%2Fext%2Fagent-board%2Ftoday&search=%3Ftab%3Ddoing&hash=%23top&theme=dark',
    );
    const pa = document.defaultView?.PA as { context: { get(): Record<string, unknown> } };

    expect(pa.context.get()).toEqual({
      extensionId: 'agent-board',
      surfaceId: 'page',
      route: '/ext/agent-board',
      pathname: '/ext/agent-board/today',
      search: '?tab=doing',
      hash: '#top',
      theme: 'dark',
    });
  });

  it('exposes extension manifest helpers', async () => {
    const document = await renderAppHtml('<main></main>', 'http://127.0.0.1:9876/api/extensions/agent-board/files/frontend/index.html');
    const pa = document.defaultView?.PA as { extension: { getManifest(): Promise<unknown>; listSurfaces(): Promise<unknown> } };
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    expect(document.defaultView).not.toBeNull();
    document.defaultView!.fetch = fetchMock;

    await pa.extension.getManifest();
    await pa.extension.listSurfaces();

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/extensions/agent-board/manifest', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/extensions/agent-board/surfaces', expect.any(Object));
  });
  it('preserves card children parsed after custom element connection', async () => {
    const document = await renderAppHtml(`
      <pa-card title="Research brief">
        <pa-form id="form">
          <pa-field label="Goal" name="goal" value="ship it"></pa-field>
          <pa-button action="run">Start Research Run</pa-button>
        </pa-form>
      </pa-card>
    `);

    expect(document.querySelector('.pa-card-title')?.textContent).toBe('Research brief');
    expect(document.querySelector('pa-form')).not.toBeNull();
    expect(document.querySelector('pa-field')).not.toBeNull();
    expect(document.querySelector('pa-button .pa-btn-text')?.textContent).toBe('Start Research Run');
  });

  it('collects all explicit pa-field values from a form', async () => {
    const document = await renderAppHtml(`
      <pa-form id="form">
        <pa-field label="Goal" name="goal" value="reduce bundle"></pa-field>
        <pa-field label="Scope" name="scope" value="packages/desktop"></pa-field>
        <pa-field label="Notify" name="notify" type="toggle" value="true"></pa-field>
      </pa-form>
    `);

    const form = document.getElementById('form') as HTMLElement & { getValues: () => Record<string, unknown> };

    expect(form.getValues()).toEqual({
      goal: 'reduce bundle',
      notify: true,
      scope: 'packages/desktop',
    });
  });
});
