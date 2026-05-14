import { describe, expect, it, vi } from 'vitest';

import { setWorkbenchBrowserToolHost } from '../../../packages/desktop/server/extensions/workbenchBrowserToolHost.js';
import { createWorkbenchBrowserAgentExtension } from './backend.js';

function collectExtension() {
  const tools: Array<{
    name: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    execute: (...args: never[]) => Promise<unknown>;
  }> = [];
  const pi = {
    registerTool: (tool: never) => tools.push(tool),
    on: vi.fn(),
  };
  createWorkbenchBrowserAgentExtension()(pi as never);
  return { tools, pi };
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
    expect(tools.map((tool) => tool.name)).toEqual(['browser_snapshot', 'browser_cdp', 'browser_screenshot']);
  });

  it('makes the workbench-vs-agent-browser distinction explicit in tool prompts', () => {
    const promptText = collectTools()
      .map((tool) => [tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join('\n'))
      .join('\n\n');

    expect(promptText).toContain('shared Workbench Browser');
    expect(promptText).toContain('communication');
    expect(promptText).toContain('development validation');
    expect(promptText).toContain('agent-browser skill');
    expect(promptText).toContain('through bash');
  });

  it('routes tools through the desktop host', async () => {
    setWorkbenchBrowserToolHost({
      isActive: async () => true,
      listTabs: async () => [{ sessionKey: '@global:tab-abc', url: 'https://example.com/', title: 'Example' }],
      snapshot: async () => ({ url: 'https://example.com/', title: 'Example', loading: false, text: 'Example text', elements: [] }),
      cdp: async (input) => ({ ok: true, command: input.command, results: [{}], state: { url: 'https://example.com/' } }),
      screenshot: async () => ({
        url: 'https://example.com/',
        title: 'Example',
        mimeType: 'image/png',
        dataBase64: 'aW1n',
        viewport: { width: 1, height: 1 },
        capturedAt: 'now',
      }),
    });

    const tools = collectTools();
    const snapshot = (await tools[0]!.execute('tool-1' as never, {} as never, undefined as never, undefined as never, ctx as never)) as {
      content: Array<{ text?: string }>;
    };
    expect(snapshot.content[0]?.text).toContain('https://example.com/');

    const cdp = (await tools[1]!.execute(
      'tool-2' as never,
      { command: { method: 'Runtime.evaluate', params: { expression: 'location.href', returnByValue: true } } } as never,
      undefined as never,
      undefined as never,
      ctx as never,
    )) as { content: Array<{ text?: string }> };
    expect(cdp.content[0]?.text).toContain('Runtime.evaluate');

    const screenshot = (await tools[2]!.execute('tool-3' as never, {} as never, undefined as never, undefined as never, ctx as never)) as {
      content: Array<{ type: string; data?: string }>;
    };
    expect(screenshot.content[1]).toMatchObject({ type: 'image', data: 'aW1n' });

    setWorkbenchBrowserToolHost(null);
  });

  it('does not watch browser panel state to mutate the active tool set', () => {
    const { pi } = collectExtension();

    expect(pi.on).not.toHaveBeenCalled();
  });

  it('lets stale tool calls create or reuse a browser session without requiring the panel to be active', async () => {
    setWorkbenchBrowserToolHost({
      isActive: async () => false,
      listTabs: async () => [],
      snapshot: async () => ({ url: 'https://example.com/', title: 'Example', loading: false, text: 'Example text', elements: [] }),
      cdp: async () => ({}),
      screenshot: async () => ({}),
    });

    const tools = collectTools();
    const result = (await tools[0]!.execute('tool-1' as never, {} as never, undefined as never, undefined as never, ctx as never)) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    expect(result.isError).not.toBe(true);
    expect(result.content?.[0]?.text).toContain('https://example.com/');

    setWorkbenchBrowserToolHost(null);
  });
});
