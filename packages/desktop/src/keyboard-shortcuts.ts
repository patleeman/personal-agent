export type DesktopKeyboardShortcutId =
  | 'conversationMode'
  | 'workbenchMode'
  | 'zenMode'
  | 'toggleSidebar'
  | 'toggleRightRail';

export type DesktopKeyboardShortcuts = Record<DesktopKeyboardShortcutId, string>;

export const DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS: DesktopKeyboardShortcuts = {
  conversationMode: 'F1',
  workbenchMode: 'F2',
  zenMode: 'F3',
  toggleSidebar: 'CommandOrControl+/',
  toggleRightRail: 'CommandOrControl+\\',
};

export const DESKTOP_KEYBOARD_SHORTCUT_IDS: DesktopKeyboardShortcutId[] = [
  'conversationMode',
  'workbenchMode',
  'zenMode',
  'toggleSidebar',
  'toggleRightRail',
];

export const DESKTOP_KEYBOARD_SHORTCUT_OPTIONS: Record<DesktopKeyboardShortcutId, string[]> = {
  conversationMode: ['F1', 'F4', 'CommandOrControl+1'],
  workbenchMode: ['F2', 'F5', 'CommandOrControl+2'],
  zenMode: ['F3', 'F6', 'CommandOrControl+3'],
  toggleSidebar: ['CommandOrControl+/', 'CommandOrControl+B', 'CommandOrControl+Shift+/'],
  toggleRightRail: ['CommandOrControl+\\', 'CommandOrControl+Shift+\\', 'CommandOrControl+Alt+\\'],
};

export function isDesktopKeyboardShortcutId(value: string): value is DesktopKeyboardShortcutId {
  return (DESKTOP_KEYBOARD_SHORTCUT_IDS as string[]).includes(value);
}

export function normalizeDesktopKeyboardShortcuts(value: unknown): DesktopKeyboardShortcuts {
  const result: DesktopKeyboardShortcuts = { ...DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS };
  if (!value || typeof value !== 'object') {
    return result;
  }

  const input = value as Record<string, unknown>;
  for (const id of DESKTOP_KEYBOARD_SHORTCUT_IDS) {
    const shortcut = typeof input[id] === 'string' ? input[id].trim() : '';
    if (shortcut && DESKTOP_KEYBOARD_SHORTCUT_OPTIONS[id].includes(shortcut)) {
      result[id] = shortcut;
    }
  }

  return result;
}

export function validateDesktopKeyboardShortcuts(input: Partial<Record<DesktopKeyboardShortcutId, string>>): DesktopKeyboardShortcuts {
  const result = normalizeDesktopKeyboardShortcuts(input);
  const seen = new Map<string, DesktopKeyboardShortcutId>();

  for (const id of DESKTOP_KEYBOARD_SHORTCUT_IDS) {
    const shortcut = result[id];
    if (!DESKTOP_KEYBOARD_SHORTCUT_OPTIONS[id].includes(shortcut)) {
      throw new Error(`Unsupported keyboard shortcut for ${id}.`);
    }

    const normalized = shortcut.toLowerCase();
    const previousId = seen.get(normalized);
    if (previousId) {
      throw new Error(`Keyboard shortcut ${shortcut} is already assigned to ${previousId}.`);
    }
    seen.set(normalized, id);
  }

  return result;
}
