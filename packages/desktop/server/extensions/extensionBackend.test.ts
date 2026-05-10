import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import { loadExtensionAgentFactory } from './extensionBackend.js';

describe('extension backend agent factory loading', () => {
  it('normalizes factory-builder agent extension exports before registering tools', async () => {
    const factory = await loadExtensionAgentFactory('system-auto-mode', 'createConversationAutoModeAgentExtension');
    const registeredTools: string[] = [];
    const registeredCommands: string[] = [];
    const registeredEvents: string[] = [];

    const pi = {
      registerTool: vi.fn((tool: { name: string }) => {
        registeredTools.push(tool.name);
      }),
      registerCommand: vi.fn((name: string) => {
        registeredCommands.push(name);
      }),
      on: vi.fn((name: string) => {
        registeredEvents.push(name);
      }),
      getActiveTools: vi.fn(() => []),
      setActiveTools: vi.fn(),
    } as unknown as ExtensionAPI;

    await factory(pi);

    expect(registeredTools).toEqual(expect.arrayContaining(['set_goal', 'update_goal']));
    expect(registeredCommands).toContain('goal');
    expect(registeredEvents).toEqual(expect.arrayContaining(['turn_end', 'tool_execution_end', 'session_start']));
  });
});
