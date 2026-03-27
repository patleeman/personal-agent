export interface ReplySelectionRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function toReplySelectionRect(
  rect: {
    left: number;
    top: number;
    right?: number;
    bottom?: number;
    width?: number;
    height?: number;
  } | null | undefined,
): ReplySelectionRectLike | null {
  if (!rect) {
    return null;
  }

  const left = rect.left;
  const top = rect.top;
  const width = typeof rect.width === 'number'
    ? rect.width
    : (typeof rect.right === 'number' ? rect.right - left : NaN);
  const height = typeof rect.height === 'number'
    ? rect.height
    : (typeof rect.bottom === 'number' ? rect.bottom - top : NaN);
  const right = typeof rect.right === 'number' ? rect.right : left + width;
  const bottom = typeof rect.bottom === 'number' ? rect.bottom : top + height;

  if (![left, top, right, bottom, width, height].every(Number.isFinite)) {
    return null;
  }

  return { left, top, right, bottom, width, height };
}

export function isVisibleReplySelectionRect(
  rect: ReplySelectionRectLike | null | undefined,
): rect is ReplySelectionRectLike {
  if (!rect) {
    return false;
  }

  return rect.width > 0 || rect.height > 0 || rect.right > rect.left || rect.bottom > rect.top;
}

export function mergeReplySelectionRects(
  rects: readonly (ReplySelectionRectLike | null | undefined)[],
): ReplySelectionRectLike | null {
  const visibleRects = rects.filter(isVisibleReplySelectionRect);
  if (visibleRects.length === 0) {
    return null;
  }

  const left = Math.min(...visibleRects.map((rect) => rect.left));
  const top = Math.min(...visibleRects.map((rect) => rect.top));
  const right = Math.max(...visibleRects.map((rect) => rect.right));
  const bottom = Math.max(...visibleRects.map((rect) => rect.bottom));

  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
