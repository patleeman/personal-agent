import { describe, expect, it } from 'vitest';
import { createWorkbenchBrowserAgentExtension, setWorkbenchBrowserToolHost } from './workbenchBrowserAgentExtension.js';

function collectTools() {
  const tools: Array<{ name: string; execute: (...args: never[]) => Promise<unknown> }> = [];
  createWorkbenchBrowserAgentExtension()({
    registerTool: (tool: never) => tools.push(tool),
  } as never);
  return tools;
}

const ctx = {
  sessionManager: {
    getSessionId: () => 'conv-1',
  },
};

describe('workbench browser agent extension', () => {
  it('registers the built-in browser tools', () => {
    const tools = collectTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'browser_snapshot',
      'browser_cdp',
      'browser_screenshot',
    ]);
  });

  it('routes tools through the desktop host', async () => {
    setWorkbenchBrowserToolHost({
      snapshot: async () => ({ url: 'https://example.com/', title: 'Example', loading: false, text: 'Example text', elements: [] }),
      cdp: async (input) => ({ ok: true, method: input.method, result: input.params ?? {}, state: { url: 'https://example.com/' } }),
      screenshot: async () => ({ url: 'https://example.com/', title: 'Example', mimeType: 'image/png', dataBase64: 'aW1n', viewport: { width: 1, height: 1 }, capturedAt: 'now' }),
    });

    const tools = collectTools();
    const snapshot = await tools[0]!.execute('tool-1' as never, {} as never, undefined as never, undefined as never, ctx as never) as { content: Array<{ text?: string }> };
    expect(snapshot.content[0]?.text).toContain('https://example.com/');

    const cdp = await tools[1]!.execute('tool-2' as never, { method: 'Runtime.evaluate', params: { expression: 'location.href', returnByValue: true } } as never, undefined as never, undefined as never, ctx as never) as { content: Array<{ text?: string }> };
    expect(cdp.content[0]?.text).toContain('Runtime.evaluate');

    const screenshot = await tools[2]!.execute('tool-3' as never, {} as never, undefined as never, undefined as never, ctx as never) as { content: Array<{ type: string; data?: string }> };
    expect(screenshot.content[1]).toMatchObject({ type: 'image', data: 'aW1n' });

    setWorkbenchBrowserToolHost(null);
  });
});
