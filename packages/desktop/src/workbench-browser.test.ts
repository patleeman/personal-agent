import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {},
  shell: { openExternal: vi.fn() },
}));
import {
  normalizeWorkbenchBrowserCdpCommands,
  normalizeWorkbenchBrowserBounds,
  normalizeWorkbenchBrowserUrl,
} from './workbench-browser.js';

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

  it('normalizes single and batched CDP tuple commands', () => {
    expect(normalizeWorkbenchBrowserCdpCommands(['Runtime.evaluate', { expression: 'document.title' }])).toEqual([
      { method: 'Runtime.evaluate', params: { expression: 'document.title' } },
    ]);
    expect(normalizeWorkbenchBrowserCdpCommands([
      ['Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 2 }],
      ['Page.captureScreenshot'],
    ])).toEqual([
      { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 1, y: 2 } },
      { method: 'Page.captureScreenshot' },
    ]);
  });

  it('rejects invalid CDP tuple commands', () => {
    expect(() => normalizeWorkbenchBrowserCdpCommands({ method: 'Runtime.evaluate' })).toThrow('tuple');
    expect(() => normalizeWorkbenchBrowserCdpCommands(['Runtime.evaluate', []])).toThrow('params');
    expect(() => normalizeWorkbenchBrowserCdpCommands(['bad'])).toThrow('Domain.command');
  });
});
