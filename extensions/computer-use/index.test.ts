import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import computerUseExtension from './index.js';

type RegisteredTool = Parameters<ExtensionAPI['registerTool']>[0];
type RegisteredHandler = (...args: unknown[]) => unknown;

describe('computer-use extension', () => {
  it('registers a single computer_use tool with internal skill guidance', () => {
    const tools: RegisteredTool[] = [];
    const handlers = new Map<string, RegisteredHandler[]>();

    computerUseExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
      on(event: string, handler: RegisteredHandler) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
    } as unknown as ExtensionAPI);

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('computer_use');
    expect(tools[0]?.promptGuidelines?.join('\n') ?? '').toContain(join('internal-skills', 'computer-use', 'INDEX.md'));
    expect(handlers.has('session_start')).toBe(true);
    expect(handlers.has('session_tree')).toBe(true);
    expect(handlers.has('session_shutdown')).toBe(true);
  });
});
