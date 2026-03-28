import { describe, expect, it } from 'vitest';
import { calculateRichMarkdownMentionMenuPosition } from './richMarkdownMentionMenuPosition';

describe('calculateRichMarkdownMentionMenuPosition', () => {
  it('places the menu below the caret inside the editor shell', () => {
    expect(calculateRichMarkdownMentionMenuPosition({
      containerRect: { left: 100, top: 200, width: 640 },
      caretRect: { left: 260, bottom: 340 },
    })).toEqual({
      left: 160,
      top: 148,
      width: 420,
      maxHeight: 288,
    });
  });

  it('clamps the menu so it stays inside the editor width', () => {
    expect(calculateRichMarkdownMentionMenuPosition({
      containerRect: { left: 40, top: 120, width: 320 },
      caretRect: { left: 330, bottom: 220 },
    })).toEqual({
      left: 8,
      top: 108,
      width: 304,
      maxHeight: 288,
    });
  });

  it('returns null when the editor is too narrow for the menu', () => {
    expect(calculateRichMarkdownMentionMenuPosition({
      containerRect: { left: 0, top: 0, width: 150 },
      caretRect: { left: 48, bottom: 48 },
    })).toBeNull();
  });
});
