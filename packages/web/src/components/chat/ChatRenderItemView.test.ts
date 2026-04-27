import { describe, expect, it } from 'vitest';
import type { MessageBlock } from '../../shared/types';
import { getConversationRailKind } from './ChatRenderItemView.js';

describe('ChatRenderItemView helpers', () => {
  it('classifies rail marker kinds for conversation blocks', () => {
    const user: MessageBlock = { type: 'user', ts: '2026-04-26T00:00:00.000Z', text: 'hi' };
    const text: MessageBlock = { type: 'text', ts: '2026-04-26T00:00:00.000Z', text: 'hello' };
    const question: MessageBlock = { type: 'tool_use', ts: '2026-04-26T00:00:00.000Z', tool: 'ask_user_question', input: {}, output: '' };
    const tool: MessageBlock = { type: 'tool_use', ts: '2026-04-26T00:00:00.000Z', tool: 'bash', input: {}, output: '' };

    expect(getConversationRailKind(user)).toBe('user');
    expect(getConversationRailKind(text)).toBe('assistant');
    expect(getConversationRailKind(question)).toBe('assistant');
    expect(getConversationRailKind(tool)).toBeUndefined();
  });
});
