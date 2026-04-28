import { describe, expect, it } from 'vitest';
import { constrainSelectionContextMenuPosition, parseReplySelectionMessageIndex, type ReplySelectionContextMenuState } from './useChatReplySelection.js';

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

  it('falls back when context menu geometry is malformed', () => {
    expect(constrainSelectionContextMenuPosition(menu({ x: Number.NaN, y: Number.POSITIVE_INFINITY }), { width: 500, height: 300 })).toMatchObject({ x: 12, y: 12 });
    expect(constrainSelectionContextMenuPosition(menu({ x: Number.MAX_SAFE_INTEGER + 1, y: 100 }), { width: 500, height: 300 })).toMatchObject({ x: 12, y: 100 });
    expect(constrainSelectionContextMenuPosition(menu({ x: 100.5, y: 120.5 }), { width: 500, height: 300 })).toMatchObject({ x: 12, y: 12 });
  });

  it('accounts for the taller menu when a reply action is available', () => {
    expect(constrainSelectionContextMenuPosition(menu({ x: 490, y: 290, replySelection: { text: 'selected text', messageIndex: 3 } }), { width: 500, height: 300 })).toMatchObject({ x: 264, y: 211 });
  });

  it('rejects malformed reply selection message indexes', () => {
    expect(parseReplySelectionMessageIndex('12')).toBe(12);
    expect(parseReplySelectionMessageIndex('12abc')).toBeNull();
    expect(parseReplySelectionMessageIndex(String(Number.MAX_SAFE_INTEGER + 1))).toBeNull();
  });
});
