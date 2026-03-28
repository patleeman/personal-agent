export interface RichMarkdownMentionMenuPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

const MENU_SIDE_INSET_PX = 8;
const MENU_TOP_OFFSET_PX = 8;
const MENU_MAX_WIDTH_PX = 420;
const MENU_MAX_HEIGHT_PX = 288;
const MENU_MIN_WIDTH_PX = 160;

function clamp(value: number, min: number, max: number): number {
  if (max <= min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

export function calculateRichMarkdownMentionMenuPosition({
  containerRect,
  caretRect,
}: {
  containerRect: Pick<DOMRect, 'left' | 'top' | 'width'>;
  caretRect: Pick<DOMRect, 'left' | 'bottom'>;
}): RichMarkdownMentionMenuPosition | null {
  const availableWidth = containerRect.width - (MENU_SIDE_INSET_PX * 2);
  if (availableWidth < MENU_MIN_WIDTH_PX) {
    return null;
  }

  const width = Math.min(MENU_MAX_WIDTH_PX, availableWidth);
  const maxLeft = Math.max(MENU_SIDE_INSET_PX, containerRect.width - width - MENU_SIDE_INSET_PX);
  const left = clamp(caretRect.left - containerRect.left, MENU_SIDE_INSET_PX, maxLeft);

  return {
    left,
    top: Math.max(0, caretRect.bottom - containerRect.top + MENU_TOP_OFFSET_PX),
    width,
    maxHeight: MENU_MAX_HEIGHT_PX,
  };
}
