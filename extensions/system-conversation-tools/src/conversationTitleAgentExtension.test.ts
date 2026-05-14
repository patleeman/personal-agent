import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import { createConversationTitleAgentExtension } from './conversationTitleAgentExtension.js';

type RegisteredTool = Parameters<ExtensionAPI['registerTool']>[0];
type ExecuteContext = Parameters<NonNullable<RegisteredTool['execute']>>[4];

function registerConversationTitleTool() {
  let registeredTool: RegisteredTool | undefined;
  const setSessionName = vi.fn();
  createConversationTitleAgentExtension()({
    registerTool: (tool: RegisteredTool) => {
      registeredTool = tool;
    },
    setSessionName,
  } as never);

  if (!registeredTool) {
    throw new Error('Conversation title tool was not registered.');
  }

  return { registeredTool, setSessionName };
}

function createToolContext(conversationId = 'conv-123'): ExecuteContext {
  return {
    sessionManager: {
      getSessionId: () => conversationId,
    },
  } as ExecuteContext;
}

describe('conversation title agent extension', () => {
  it('registers title-specific guidance', () => {
    const { registeredTool } = registerConversationTitleTool();
    const guidelines = registeredTool.promptGuidelines?.join('\n') ?? '';

    expect(registeredTool.name).toBe('set_conversation_title');
    expect(guidelines).toContain('3-7 word title');
    expect(guidelines).toContain('do not mention the title update');
    expect(guidelines).not.toContain('Fix diff screen layout');
  });

  it('sets the normalized current conversation title', async () => {
    const { registeredTool, setSessionName } = registerConversationTitleTool();

    const result = await registeredTool.execute(
      'tool-1',
      { title: '  Title: "Fix diff screen layout"\nextra junk  ' },
      undefined,
      undefined,
      createToolContext('conv-title'),
    );

    expect(setSessionName).toHaveBeenCalledWith('Fix diff screen layout');
    expect(result.details).toEqual({
      conversationId: 'conv-title',
      title: 'Fix diff screen layout',
    });
  });

  it('rejects blank titles', async () => {
    const { registeredTool, setSessionName } = registerConversationTitleTool();

    await expect(registeredTool.execute('tool-1', { title: '   \n  ' }, undefined, undefined, createToolContext())).rejects.toThrow(
      'Conversation title must not be empty.',
    );

    expect(setSessionName).not.toHaveBeenCalled();
  });
});
