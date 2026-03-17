export const RESIZE_HANDLE_WIDTH = 5;

export const RAIL_WIDTH_STORAGE_KEYS = {
  projects: 'pa:rail-width:projects',
  scheduled: 'pa:rail-width:scheduled',
  runs: 'pa:rail-width:runs',
  conversations: 'pa:rail-width:conversations',
  inbox: 'pa:rail-width:inbox',
  memory: 'pa:rail-width:memory',
  memories: 'pa:rail-width:memories',
  tools: 'pa:rail-width:tools',
  default: 'pa:rail-width:default',
} as const;

export interface RailLayoutPrefs {
  storageKey: string;
  initialWidth?: number;
  initialMainWidthRatio?: number;
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
        storageKey: RAIL_WIDTH_STORAGE_KEYS.projects,
        initialWidth: 560,
      };
    case 'scheduled':
    case 'automations':
    case 'tasks':
      return {
        storageKey: RAIL_WIDTH_STORAGE_KEYS.scheduled,
        initialWidth: 380,
      };
    case 'runs':
      return {
        storageKey: RAIL_WIDTH_STORAGE_KEYS.runs,
        initialWidth: 420,
      };
    case 'conversations':
      return {
        storageKey: RAIL_WIDTH_STORAGE_KEYS.conversations,
        initialWidth: 380,
      };
    case 'inbox':
      return {
        storageKey: RAIL_WIDTH_STORAGE_KEYS.inbox,
        initialWidth: 380,
      };
    case 'memory':
      return {
        storageKey: RAIL_WIDTH_STORAGE_KEYS.memory,
        initialWidth: 380,
      };
    case 'memories':
      return {
        storageKey: RAIL_WIDTH_STORAGE_KEYS.memories,
        initialMainWidthRatio: 0.7,
      };
    case 'tools':
      return {
        storageKey: RAIL_WIDTH_STORAGE_KEYS.tools,
        initialMainWidthRatio: 0.7,
      };
    default:
      return {
        storageKey: RAIL_WIDTH_STORAGE_KEYS.default,
        initialWidth: 380,
      };
  }
}

export function getMainViewportWidth(input: {
  viewportWidth: number;
  sidebarWidth: number;
  resizeHandleWidth?: number;
}): number {
  const resizeHandleWidth = input.resizeHandleWidth ?? RESIZE_HANDLE_WIDTH;
  return Math.max(0, input.viewportWidth - input.sidebarWidth - (resizeHandleWidth * 2));
}

export function getRailInitialWidth(input: {
  pathname: string;
  viewportWidth: number;
  sidebarWidth: number;
  railMinWidth: number;
  railMaxWidth: number;
  resizeHandleWidth?: number;
}): number {
  const prefs = getRailLayoutPrefs(input.pathname);
  const initialWidth = prefs.initialMainWidthRatio === undefined
    ? (prefs.initialWidth ?? input.railMinWidth)
    : Math.floor(getMainViewportWidth(input) * prefs.initialMainWidthRatio);

  return clampPanelWidth(initialWidth, input.railMinWidth, input.railMaxWidth);
}

export function getArtifactRailTargetWidth(input: {
  viewportWidth: number;
  sidebarWidth: number;
  resizeHandleWidth?: number;
}): number {
  return Math.floor(getMainViewportWidth(input) / 2);
}

export function getRailMaxWidth(input: {
  viewportWidth: number;
  sidebarWidth: number;
  railMinWidth: number;
  mainMinWidth?: number;
  resizeHandleWidth?: number;
}): number {
  const mainMinWidth = input.mainMinWidth ?? 320;
  const mainViewportWidth = getMainViewportWidth(input);
  const remainingWidthAfterMainMinimum = mainViewportWidth - mainMinWidth;

  return Math.max(input.railMinWidth, remainingWidthAfterMainMinimum);
}
