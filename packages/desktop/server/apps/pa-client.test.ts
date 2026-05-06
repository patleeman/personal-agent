import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { PA_CLIENT_JS } from './pa-client.js';

async function renderAppHtml(html: string): Promise<Document> {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'http://127.0.0.1:9876/',
    runScripts: 'outside-only',
  });
  dom.window.eval(PA_CLIENT_JS);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 5));
  return dom.window.document;
}

describe('PA skill app client components', () => {
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
