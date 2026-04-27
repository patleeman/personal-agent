import { describe, expect, it } from 'vitest';
import { constrainSelectionContextMenuPosition, type ReplySelectionContextMenuState } from './useChatReplySelection.js';

function menu(overrides: Partial<ReplySelectionContextMenuState> = {}): ReplySelectionContextMenuState {
  return {
    x: 100,
    y: 100,
    text: 'selected text',
    replySelection: null,
    ...overrides,
  };
}

describe('useChatReplySelection helpers', () => {
  it('keeps context menus within the viewport edge padding', () => {
    expect(constrainSelectionContextMenuPosition(menu({ x: 1, y: 2 }), { width: 500, height: 300 })).toMatchObject({ x: 12, y: 12 });
    expect(constrainSelectionContextMenuPosition(menu({ x: 490, y: 290 }), { width: 500, height: 300 })).toMatchObject({ x: 264, y: 245 });
  });

  it('accounts for the taller menu when a reply action is available', () => {
    expect(constrainSelectionContextMenuPosition(menu({ x: 490, y: 290, replySelection: { text: 'selected text', messageIndex: 3 } }), { width: 500, height: 300 })).toMatchObject({ x: 264, y: 211 });
  });
});
