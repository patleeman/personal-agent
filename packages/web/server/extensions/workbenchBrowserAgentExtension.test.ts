import { describe, expect, it, vi } from 'vitest';
import { createWorkbenchBrowserAgentExtension, setWorkbenchBrowserToolHost } from './workbenchBrowserAgentExtension.js';

function collectExtension() {
  const tools: Array<{ name: string; execute: (...args: never[]) => Promise<unknown> }> = [];
  const handlers = new Map<string, Array<(...args: never[]) => Promise<void>>>();
  const pi = {
    registerTool: (tool: never) => tools.push(tool),
    on: (event: string, handler: never) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    getActiveTools: vi.fn(() => ['read', 'browser_snapshot', 'browser_cdp', 'browser_screenshot', 'bash']),
    setActiveTools: vi.fn(),
  };
  createWorkbenchBrowserAgentExtension()(pi as never);
  return { tools, handlers, pi };
}

function collectTools() {
  return collectExtension().tools;
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
      isActive: async () => true,
      snapshot: async () => ({ url: 'https://example.com/', title: 'Example', loading: false, text: 'Example text', elements: [] }),
      cdp: async (input) => ({ ok: true, command: input.command, results: [{}], state: { url: 'https://example.com/' } }),
      screenshot: async () => ({ url: 'https://example.com/', title: 'Example', mimeType: 'image/png', dataBase64: 'aW1n', viewport: { width: 1, height: 1 }, capturedAt: 'now' }),
    });

    const tools = collectTools();
    const snapshot = await tools[0]!.execute('tool-1' as never, {} as never, undefined as never, undefined as never, ctx as never) as { content: Array<{ text?: string }> };
    expect(snapshot.content[0]?.text).toContain('https://example.com/');

    const cdp = await tools[1]!.execute('tool-2' as never, { command: { method: 'Runtime.evaluate', params: { expression: 'location.href', returnByValue: true } } } as never, undefined as never, undefined as never, ctx as never) as { content: Array<{ text?: string }> };
    expect(cdp.content[0]?.text).toContain('Runtime.evaluate');

    const screenshot = await tools[2]!.execute('tool-3' as never, {} as never, undefined as never, undefined as never, ctx as never) as { content: Array<{ type: string; data?: string }> };
    expect(screenshot.content[1]).toMatchObject({ type: 'image', data: 'aW1n' });

    setWorkbenchBrowserToolHost(null);
  });

  it('keeps browser tools inactive until the workbench browser is active', async () => {
    setWorkbenchBrowserToolHost({
      isActive: async () => false,
      snapshot: async () => ({}),
      cdp: async () => ({}),
      screenshot: async () => ({}),
    });

    const { handlers, pi } = collectExtension();
    await handlers.get('before_agent_start')![0]!({} as never, ctx as never);

    expect(pi.setActiveTools).toHaveBeenCalledWith(['read', 'bash']);

    setWorkbenchBrowserToolHost(null);
  });

  it('activates browser tools for active workbench browser sessions', async () => {
    setWorkbenchBrowserToolHost({
      isActive: async () => true,
      snapshot: async () => ({}),
      cdp: async () => ({}),
      screenshot: async () => ({}),
    });

    const { handlers, pi } = collectExtension();
    pi.getActiveTools.mockReturnValue(['read', 'bash']);
    await handlers.get('before_agent_start')![0]!({} as never, ctx as never);

    expect(pi.setActiveTools).toHaveBeenCalledWith(['read', 'bash', 'browser_snapshot', 'browser_cdp', 'browser_screenshot']);

    setWorkbenchBrowserToolHost(null);
  });

  it('rejects stale tool calls when the workbench browser is inactive', async () => {
    setWorkbenchBrowserToolHost({
      isActive: async () => false,
      snapshot: async () => ({ url: 'https://example.com/' }),
      cdp: async () => ({}),
      screenshot: async () => ({}),
    });

    const tools = collectTools();
    await expect(tools[0]!.execute('tool-1' as never, {} as never, undefined as never, undefined as never, ctx as never))
      .rejects.toThrow('Workbench Browser is not active');

    setWorkbenchBrowserToolHost(null);
  });
});
