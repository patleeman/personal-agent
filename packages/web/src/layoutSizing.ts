export const RESIZE_HANDLE_WIDTH = 5;

export function clampPanelWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) {
    return min;
  }

  return Math.max(min, Math.min(max, width));
}

export function getRailMaxWidth(input: {
  viewportWidth: number;
  sidebarWidth: number;
  railMinWidth: number;
  resizeHandleWidth?: number;
}): number {
  const resizeHandleWidth = input.resizeHandleWidth ?? RESIZE_HANDLE_WIDTH;
  const mainViewportWidth = input.viewportWidth - input.sidebarWidth - (resizeHandleWidth * 2);
  const halfMainViewport = Math.floor(mainViewportWidth / 2);

  return Math.max(input.railMinWidth, halfMainViewport);
}
