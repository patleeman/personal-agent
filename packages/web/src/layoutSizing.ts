export const RESIZE_HANDLE_WIDTH = 5;

export interface RailLayoutPrefs {
  storageKey: string;
  initialWidth: number;
}

export function clampPanelWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) {
    return min;
  }

  return Math.max(min, Math.min(max, width));
}

export function getRailLayoutPrefs(pathname: string): RailLayoutPrefs {
  const section = pathname.split('/').filter(Boolean)[0] ?? 'default';

  switch (section) {
    case 'projects':
      return {
        storageKey: 'pa:rail-width:projects',
        initialWidth: 560,
      };
    case 'scheduled':
    case 'automations':
    case 'tasks':
      return {
        storageKey: 'pa:rail-width:scheduled',
        initialWidth: 380,
      };
    case 'conversations':
      return {
        storageKey: 'pa:rail-width:conversations',
        initialWidth: 380,
      };
    case 'inbox':
      return {
        storageKey: 'pa:rail-width:inbox',
        initialWidth: 380,
      };
    case 'memory':
      return {
        storageKey: 'pa:rail-width:memory',
        initialWidth: 380,
      };
    default:
      return {
        storageKey: 'pa:rail-width:default',
        initialWidth: 380,
      };
  }
}

export function getRailMaxWidth(input: {
  viewportWidth: number;
  sidebarWidth: number;
  railMinWidth: number;
  mainMinWidth?: number;
  resizeHandleWidth?: number;
}): number {
  const resizeHandleWidth = input.resizeHandleWidth ?? RESIZE_HANDLE_WIDTH;
  const mainMinWidth = input.mainMinWidth ?? 320;
  const mainViewportWidth = input.viewportWidth - input.sidebarWidth - (resizeHandleWidth * 2);
  const remainingWidthAfterMainMinimum = mainViewportWidth - mainMinWidth;

  return Math.max(input.railMinWidth, remainingWidthAfterMainMinimum);
}
