import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import { createConversationTitleAgentExtension } from './conversationTitleAgentExtension.js';

type RegisteredTool = Parameters<ExtensionAPI['registerTool']>[0];
type ExecuteContext = Parameters<NonNullable<RegisteredTool['execute']>>[4];

function registerConversationTitleTool(setConversationTitle = vi.fn()) {
  let registeredTool: RegisteredTool | undefined;
  createConversationTitleAgentExtension({ setConversationTitle })({
    registerTool: (tool: RegisteredTool) => {
      registeredTool = tool;
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Conversation title tool was not registered.');
  }

  return { registeredTool, setConversationTitle };
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
    expect(guidelines).toContain('3-7 words');
    expect(guidelines).toContain('Do not mention that you set the title');
    expect(guidelines).toContain('Fix diff screen layout');
  });

  it('sets the normalized current conversation title', async () => {
    const { registeredTool, setConversationTitle } = registerConversationTitleTool();

    const result = await registeredTool.execute(
      'tool-1',
      { title: '  Title: "Fix diff screen layout"\nextra junk  ' },
      undefined,
      undefined,
      createToolContext('conv-title'),
    );

    expect(setConversationTitle).toHaveBeenCalledWith('conv-title', 'Fix diff screen layout');
    expect(result.details).toEqual({
      conversationId: 'conv-title',
      title: 'Fix diff screen layout',
    });
  });

  it('rejects blank titles', async () => {
    const { registeredTool, setConversationTitle } = registerConversationTitleTool();

    await expect(registeredTool.execute('tool-1', { title: '   \n  ' }, undefined, undefined, createToolContext())).rejects.toThrow(
      'Conversation title must not be empty.',
    );

    expect(setConversationTitle).not.toHaveBeenCalled();
  });
});
