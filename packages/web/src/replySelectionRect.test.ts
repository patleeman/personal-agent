import { describe, expect, it } from 'vitest';
import {
  isVisibleReplySelectionRect,
  mergeReplySelectionRects,
  toReplySelectionRect,
} from './replySelectionRect';

describe('replySelectionRect', () => {
  it('rejects empty rectangles', () => {
    expect(isVisibleReplySelectionRect(toReplySelectionRect({ left: 10, top: 20, width: 0, height: 0 }))).toBe(false);
  });

  it('accepts non-empty rectangles', () => {
    expect(isVisibleReplySelectionRect(toReplySelectionRect({ left: 10, top: 20, width: 14, height: 18 }))).toBe(true);
  });

  it('derives width and height from right and bottom when needed', () => {
    expect(toReplySelectionRect({ left: 8, top: 12, right: 28, bottom: 36 })).toEqual({
      left: 8,
      top: 12,
      right: 28,
      bottom: 36,
      width: 20,
      height: 24,
    });
  });

  it('merges multiple client rects into a single bounding rect', () => {
    expect(mergeReplySelectionRects([
      toReplySelectionRect({ left: 100, top: 200, width: 60, height: 16 }),
      toReplySelectionRect({ left: 96, top: 220, width: 84, height: 16 }),
    ])).toEqual({
      left: 96,
      top: 200,
      right: 180,
      bottom: 236,
      width: 84,
      height: 36,
    });
  });
});
