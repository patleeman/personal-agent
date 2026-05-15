import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {},
  shell: { openExternal: vi.fn() },
}));
import {
  normalizeWorkbenchBrowserBounds,
  normalizeWorkbenchBrowserCdpCommands,
  normalizeWorkbenchBrowserUrl,
} from './workbench-browser.js';

describe('workbench browser validation', () => {
  it('keeps browser page inspection on the CDP path', () => {
    const source = readFileSync(fileURLToPath(new URL('./workbench-browser.ts', import.meta.url)), 'utf-8');

    expect(source).not.toContain('executeJavaScript(');
    expect(source).toContain('function cdpEvaluate(webContents');
  });

  it('guards CDP-backed browser tools against blank or loading pages', () => {
    const source = readFileSync(fileURLToPath(new URL('./workbench-browser.ts', import.meta.url)), 'utf-8');

    expect(source).toContain('function assertBrowserCommandTargetReady');
    expect(source).toContain("url === 'about:blank'");
    expect(source).toContain('webContents.isLoadingMainFrame()');
    expect(source).toContain('assertBrowserCommandTargetReady(webContents);');
  });

  it('bounds CDP commands so browser tools cannot hang forever', () => {
    const source = readFileSync(fileURLToPath(new URL('./workbench-browser.ts', import.meta.url)), 'utf-8');

    expect(source).toContain('WORKBENCH_BROWSER_CDP_TIMEOUT_MS');
    expect(source).toContain('CDP ${method}');
    expect(source).toContain('timed out after');
  });

  it('keeps closed browser views deactivated across late load events', () => {
    const source = readFileSync(fileURLToPath(new URL('./workbench-browser.ts', import.meta.url)), 'utf-8');

    expect(source).toContain('entry.deactivated = true');
    expect(source).toContain('entry.active = true');
    expect(source).toContain('if (!entry.deactivated)');
    expect(source).toContain('entry.view.webContents.stop();');
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

  it('normalizes single and batched CDP object commands', () => {
    expect(normalizeWorkbenchBrowserCdpCommands({ method: 'Runtime.evaluate', params: { expression: 'document.title' } })).toEqual([
      { method: 'Runtime.evaluate', params: { expression: 'document.title' } },
    ]);
    expect(
      normalizeWorkbenchBrowserCdpCommands([
        { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 1, y: 2 } },
        { method: 'Page.captureScreenshot' },
      ]),
    ).toEqual([{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 1, y: 2 } }, { method: 'Page.captureScreenshot' }]);
  });

  it('rejects invalid CDP object commands', () => {
    expect(() => normalizeWorkbenchBrowserCdpCommands('Runtime.evaluate')).toThrow('object');
    expect(() => normalizeWorkbenchBrowserCdpCommands({ method: 'Runtime.evaluate', params: [] })).toThrow('params');
    expect(() => normalizeWorkbenchBrowserCdpCommands({ method: 'bad' })).toThrow('Domain.command');
  });
});
