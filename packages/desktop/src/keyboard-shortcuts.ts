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

const MODIFIER_ALIASES: Record<string, string> = {
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  command: 'Command',
  cmd: 'Command',
  control: 'Control',
  ctrl: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Meta',
};

const MODIFIER_ORDER = ['CommandOrControl', 'Command', 'Control', 'Alt', 'Shift', 'Super', 'Meta'];

const NAMED_KEYS = new Set([
  'Space',
  'Tab',
  'Enter',
  'Return',
  'Esc',
  'Escape',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Up',
  'Down',
  'Left',
  'Right',
  'Plus',
]);

const SHIFTED_SYMBOL_KEYS: Record<string, string> = {
  '~': '`',
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  '+': '=',
  '{': '[',
  '}': ']',
  '|': '\\',
  ':': ';',
  '"': "'",
  '<': ',',
  '>': '.',
  '?': '/',
};

function normalizeShortcutKey(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return null;
  const shifted = SHIFTED_SYMBOL_KEYS[trimmed];
  if (shifted) return shifted;
  if (/^[a-z]$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^[0-9]$/.test(trimmed)) return trimmed;
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(trimmed)) return trimmed.toUpperCase();
  if (NAMED_KEYS.has(trimmed)) return trimmed;
  if (NAMED_KEYS.has(trimmed[0]?.toUpperCase() + trimmed.slice(1))) return trimmed[0].toUpperCase() + trimmed.slice(1);
  if (/^[`\-=[\]\\;',./*]$/.test(trimmed)) return trimmed;
  return null;
}

export function normalizeDesktopKeyboardShortcut(value: string): string | null {
  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const modifiers = new Set<string>();
  let key: string | null = null;
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    if (key !== null) return null;
    key = normalizeShortcutKey(part);
    if (!key) return null;
  }

  if (!key) return null;
  if (modifiers.size === 0 && !/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) {
    return null;
  }

  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join('+');
}

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
    const normalizedShortcut = normalizeDesktopKeyboardShortcut(shortcut);
    if (normalizedShortcut) {
      result[id] = normalizedShortcut;
    }
  }

  return result;
}

export function validateDesktopKeyboardShortcuts(input: Partial<Record<DesktopKeyboardShortcutId, string>>): DesktopKeyboardShortcuts {
  const result: DesktopKeyboardShortcuts = { ...DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS };
  const seen = new Map<string, DesktopKeyboardShortcutId>();

  for (const id of DESKTOP_KEYBOARD_SHORTCUT_IDS) {
    if (Object.prototype.hasOwnProperty.call(input, id)) {
      const normalizedShortcut = normalizeDesktopKeyboardShortcut(String(input[id] ?? ''));
      if (!normalizedShortcut) {
        throw new Error(`Unsupported keyboard shortcut for ${id}.`);
      }
      result[id] = normalizedShortcut;
    }

    const shortcut = result[id];
    const normalized = shortcut.toLowerCase();
    const previousId = seen.get(normalized);
    if (previousId) {
      throw new Error(`Keyboard shortcut ${shortcut} is already assigned to ${previousId}.`);
    }
    seen.set(normalized, id);
  }

  return result;
}
