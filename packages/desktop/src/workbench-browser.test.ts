import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {},
  shell: { openExternal: vi.fn() },
}));
import {
  normalizeWorkbenchBrowserActions,
  normalizeWorkbenchBrowserBounds,
  normalizeWorkbenchBrowserUrl,
} from './workbench-browser.js';
import { compileBrowserScript as compileWorkerBrowserScript } from './workbench-browser-script-worker.js';

describe('workbench browser validation', () => {
  it('keeps browser page inspection on the CDP path', () => {
    const source = readFileSync(fileURLToPath(new URL('./workbench-browser.ts', import.meta.url)), 'utf-8');

    expect(source).not.toContain('executeJavaScript(');
    expect(source).toContain('cdpEvaluate(view.webContents');
  });

  it('accepts safe content bounds', () => {
    expect(normalizeWorkbenchBrowserBounds({ x: 12, y: 48, width: 320, height: 480 })).toEqual({
      x: 12,
      y: 48,
      width: 320,
      height: 480,
    });
  });

  it('rejects invalid content bounds', () => {
    expect(normalizeWorkbenchBrowserBounds({ x: 0, y: 0, width: 0, height: 480 })).toBeNull();
    expect(normalizeWorkbenchBrowserBounds({ x: 0.5, y: 0, width: 320, height: 480 })).toBeNull();
    expect(normalizeWorkbenchBrowserBounds({ x: 0, y: 0, width: 5000, height: 480 })).toBeNull();
  });

  it('normalizes http URLs and rejects non-web protocols', () => {
    expect(normalizeWorkbenchBrowserUrl('example.com/path')).toBe('https://example.com/path');
    expect(normalizeWorkbenchBrowserUrl('http://example.com/')).toBe('http://example.com/');
    expect(() => normalizeWorkbenchBrowserUrl('file:///etc/passwd')).toThrow('http(s)');
  });

  it('normalizes a bounded batch of browser actions', () => {
    expect(normalizeWorkbenchBrowserActions([
      { type: 'click', selector: 'button.submit' },
      { type: 'type', selector: 'input[name=q]', text: 'hello' },
      { type: 'key', key: 'Enter' },
      { type: 'scroll', y: 500 },
      { type: 'wait', ms: 1500.4 },
    ])).toEqual([
      { type: 'click', selector: 'button.submit' },
      { type: 'type', selector: 'input[name=q]', text: 'hello' },
      { type: 'key', key: 'Enter' },
      { type: 'scroll', x: 0, y: 500 },
      { type: 'wait', ms: 1500 },
    ]);
  });

  it('rejects unsafe action batches', () => {
    expect(() => normalizeWorkbenchBrowserActions(new Array(26).fill({ type: 'wait', ms: 1 }))).toThrow('at most 25');
    expect(() => normalizeWorkbenchBrowserActions([{ type: 'click', selector: '' }])).toThrow('selector is required');
    expect(() => normalizeWorkbenchBrowserActions([{ type: 'key', key: '' }])).toThrow('short key');
  });

  it('compiles browser scripts with real or accidentally escaped line breaks', () => {
    expect(() => compileWorkerBrowserScript("await browser.wait(1)\nreturn await browser.url()")).not.toThrow();
    expect(() => compileWorkerBrowserScript("await browser.wait(1)\\nreturn await browser.url()")).not.toThrow();
  });
});
