export type DesktopKeyboardShortcutId =
  | 'showApp'
  | 'newConversation'
  | 'closeTab'
  | 'reopenClosedTab'
  | 'previousConversation'
  | 'nextConversation'
  | 'togglePinned'
  | 'archiveRestoreConversation'
  | 'renameConversation'
  | 'focusComposer'
  | 'editWorkingDirectory'
  | 'findOnPage'
  | 'settings'
  | 'quit'
  | 'conversationMode'
  | 'workbenchMode'
  | 'zenMode'
  | 'toggleSidebar'
  | 'toggleRightRail';

export type DesktopKeyboardShortcuts = Record<DesktopKeyboardShortcutId, string>;

export const DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS: DesktopKeyboardShortcuts = {
  showApp: 'CommandOrControl+Shift+A',
  newConversation: 'CommandOrControl+N',
  closeTab: 'CommandOrControl+W',
  reopenClosedTab: 'Command+Shift+N',
  previousConversation: 'CommandOrControl+[',
  nextConversation: 'CommandOrControl+]',
  togglePinned: 'CommandOrControl+Alt+P',
  archiveRestoreConversation: 'CommandOrControl+Alt+A',
  renameConversation: 'CommandOrControl+Alt+R',
  focusComposer: 'CommandOrControl+L',
  editWorkingDirectory: 'CommandOrControl+Shift+L',
  findOnPage: 'CommandOrControl+F',
  settings: 'CommandOrControl+,',
  quit: 'CommandOrControl+Q',
  conversationMode: 'F1',
  workbenchMode: 'F2',
  zenMode: 'F3',
  toggleSidebar: 'CommandOrControl+/',
  toggleRightRail: 'CommandOrControl+\\',
};

export const DESKTOP_KEYBOARD_SHORTCUT_IDS: DesktopKeyboardShortcutId[] = [
  'showApp',
  'newConversation',
  'closeTab',
  'reopenClosedTab',
  'previousConversation',
  'nextConversation',
  'togglePinned',
  'archiveRestoreConversation',
  'renameConversation',
  'focusComposer',
  'editWorkingDirectory',
  'findOnPage',
  'settings',
  'quit',
  'conversationMode',
  'workbenchMode',
  'zenMode',
  'toggleSidebar',
  'toggleRightRail',
];

export const DESKTOP_KEYBOARD_SHORTCUT_OPTIONS: Record<DesktopKeyboardShortcutId, string[]> = {
  showApp: ['CommandOrControl+Shift+A', 'CommandOrControl+Shift+P', 'CommandOrControl+Alt+Space'],
  newConversation: ['CommandOrControl+N', 'CommandOrControl+Shift+N', 'CommandOrControl+Alt+N'],
  closeTab: ['CommandOrControl+W', 'CommandOrControl+Shift+W', 'CommandOrControl+Alt+W'],
  reopenClosedTab: ['Command+Shift+N', 'CommandOrControl+Shift+W', 'CommandOrControl+Shift+T'],
  previousConversation: ['CommandOrControl+[', 'CommandOrControl+Shift+[', 'CommandOrControl+Alt+['],
  nextConversation: ['CommandOrControl+]', 'CommandOrControl+Shift+]', 'CommandOrControl+Alt+]'],
  togglePinned: ['CommandOrControl+Alt+P', 'CommandOrControl+Shift+P', 'CommandOrControl+Alt+Shift+P'],
  archiveRestoreConversation: ['CommandOrControl+Alt+A', 'CommandOrControl+Shift+A', 'CommandOrControl+Alt+Shift+A'],
  renameConversation: ['CommandOrControl+Alt+R', 'CommandOrControl+Shift+R', 'CommandOrControl+Alt+Shift+R'],
  focusComposer: ['CommandOrControl+L', 'CommandOrControl+Shift+L', 'CommandOrControl+Alt+L'],
  editWorkingDirectory: ['CommandOrControl+Shift+L', 'CommandOrControl+Alt+L', 'CommandOrControl+Alt+Shift+L'],
  findOnPage: ['CommandOrControl+F', 'CommandOrControl+Shift+F', 'CommandOrControl+Alt+F'],
  settings: ['CommandOrControl+,', 'CommandOrControl+Shift+,', 'CommandOrControl+Alt+,'],
  quit: ['CommandOrControl+Q', 'CommandOrControl+Shift+Q', 'Alt+F4'],
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
