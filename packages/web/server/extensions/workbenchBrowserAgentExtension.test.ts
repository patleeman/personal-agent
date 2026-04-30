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
      'browser_script',
    ]);
  });

  it('routes tools through the desktop host', async () => {
    setWorkbenchBrowserToolHost({
      snapshot: async () => ({ url: 'https://example.com/', title: 'Example', loading: false, text: 'Example text', elements: [] }),
      screenshot: async () => ({ url: 'https://example.com/', title: 'Example', mimeType: 'image/png', dataBase64: 'aW1n', viewport: { width: 1, height: 1 }, capturedAt: 'now' }),
      runScript: async (input) => ({ ok: true, result: input.script, logs: [], snapshot: { url: 'https://example.com/' } }),
    });

    const tools = collectTools();
    const snapshot = await tools[0]!.execute('tool-1' as never, {} as never, undefined as never, undefined as never, ctx as never) as { content: Array<{ text?: string }> };
    expect(snapshot.content[0]?.text).toContain('https://example.com/');

    const script = await tools[1]!.execute('tool-2' as never, { script: 'return 1;' } as never, undefined as never, undefined as never, ctx as never) as { content: Array<{ text?: string }> };
    expect(script.content[0]?.text).toContain('return 1;');

    setWorkbenchBrowserToolHost(null);
  });

  it('can include a screenshot with the structured browser snapshot', async () => {
    setWorkbenchBrowserToolHost({
      snapshot: async () => ({ url: 'https://example.com/', title: 'Example', loading: false, text: 'Example text', elements: [] }),
      screenshot: async () => ({ mimeType: 'image/png', dataBase64: 'aW1n' }),
      runScript: async () => ({}),
    });

    const snapshotTool = collectTools().find((tool) => tool.name === 'browser_snapshot')!;
    const result = await snapshotTool.execute('tool-3' as never, { includeScreenshot: true } as never, undefined as never, undefined as never, ctx as never) as { content: Array<{ type: string; data?: string }> };

    expect(result.content[0]?.type).toBe('text');
    expect(result.content[1]).toMatchObject({ type: 'image', data: 'aW1n' });
    setWorkbenchBrowserToolHost(null);
  });
});
