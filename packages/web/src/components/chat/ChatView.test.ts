import { describe, expect, it } from 'vitest';
import type { MessageBlock } from '../../types';
import {
  resolveDisclosureOpen,
  shouldAutoOpenConversationBlock,
  toggleDisclosurePreference,
} from './ChatView.js';

describe('chat view streaming disclosure', () => {
  it('auto-opens running tool blocks', () => {
    const block: MessageBlock = {
      type: 'tool_use',
      ts: '2026-03-11T18:00:00.000Z',
      tool: 'bash',
      input: { command: 'sleep 1' },
      output: '',
      status: 'running',
    };

    expect(shouldAutoOpenConversationBlock(block, 1, 3, true)).toBe(true);
  });

  it('only auto-opens the tail thinking block while the stream is active', () => {
    const thinking: MessageBlock = {
      type: 'thinking',
      ts: '2026-03-11T18:00:00.000Z',
      text: 'Working through the request…',
    };

    expect(shouldAutoOpenConversationBlock(thinking, 2, 3, true)).toBe(true);
    expect(shouldAutoOpenConversationBlock(thinking, 1, 3, true)).toBe(false);
    expect(shouldAutoOpenConversationBlock(thinking, 2, 3, false)).toBe(false);
  });

  it('collapses auto-opened blocks once live streaming ends unless manually overridden', () => {
    expect(resolveDisclosureOpen(true, 'auto')).toBe(true);
    expect(resolveDisclosureOpen(false, 'auto')).toBe(false);

    expect(toggleDisclosurePreference(true, 'auto')).toBe('closed');
    expect(resolveDisclosureOpen(true, 'closed')).toBe(false);

    expect(toggleDisclosurePreference(false, 'closed')).toBe('open');
    expect(resolveDisclosureOpen(false, 'open')).toBe(true);
  });
});
