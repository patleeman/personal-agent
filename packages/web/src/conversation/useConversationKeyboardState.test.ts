import { describe, expect, it } from 'vitest';
import { resolveVisualViewportKeyboardInset } from './useConversationKeyboardState';

describe('resolveVisualViewportKeyboardInset', () => {
  it('falls back to zero for invalid viewport geometry', () => {
    expect(resolveVisualViewportKeyboardInset({ innerHeight: 900, viewportHeight: Number.NaN, viewportOffsetTop: 0 })).toBe(0);
    expect(resolveVisualViewportKeyboardInset({ innerHeight: 900, viewportHeight: 600, viewportOffsetTop: Number.POSITIVE_INFINITY })).toBe(0);
    expect(resolveVisualViewportKeyboardInset({ innerHeight: 900.5, viewportHeight: 600, viewportOffsetTop: 0 })).toBe(0);
  });
});
