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
  | 'toggleSidebar'
  | 'toggleRightRail';

export type DesktopKeyboardShortcuts = Record<DesktopKeyboardShortcutId, string>;

export interface CoreKeyboardShortcutRegistration {
  id: DesktopKeyboardShortcutId;
  title: string;
  description: string;
  command: string;
  defaultKeys: string[];
  menu: 'file' | 'edit' | 'view' | 'app';
}

export const CORE_KEYBOARD_SHORTCUT_REGISTRATIONS: CoreKeyboardShortcutRegistration[] = [
  {
    id: 'showApp',
    title: 'Show Personal Agent',
    description: 'Bring the desktop window forward.',
    command: 'core.showApp',
    defaultKeys: ['CommandOrControl+Shift+A'],
    menu: 'file',
  },
  {
    id: 'newConversation',
    title: 'New conversation',
    description: 'Start a fresh chat.',
    command: 'core.newConversation',
    defaultKeys: ['CommandOrControl+N'],
    menu: 'file',
  },
  {
    id: 'closeTab',
    title: 'Close tab',
    description: 'Close the active conversation tab.',
    command: 'core.closeTab',
    defaultKeys: ['CommandOrControl+W'],
    menu: 'file',
  },
  {
    id: 'reopenClosedTab',
    title: 'Reopen closed tab',
    description: 'Restore the most recently closed conversation tab.',
    command: 'core.reopenClosedTab',
    defaultKeys: ['Command+Shift+N'],
    menu: 'file',
  },
  {
    id: 'previousConversation',
    title: 'Previous conversation',
    description: 'Move to the previous open conversation.',
    command: 'core.previousConversation',
    defaultKeys: ['CommandOrControl+['],
    menu: 'file',
  },
  {
    id: 'nextConversation',
    title: 'Next conversation',
    description: 'Move to the next open conversation.',
    command: 'core.nextConversation',
    defaultKeys: ['CommandOrControl+]'],
    menu: 'file',
  },
  {
    id: 'togglePinned',
    title: 'Toggle pinned',
    description: 'Pin or unpin the active conversation.',
    command: 'core.togglePinned',
    defaultKeys: ['CommandOrControl+Alt+P'],
    menu: 'file',
  },
  {
    id: 'archiveRestoreConversation',
    title: 'Archive / restore',
    description: 'Archive or restore the active conversation.',
    command: 'core.archiveRestoreConversation',
    defaultKeys: ['CommandOrControl+Alt+A'],
    menu: 'file',
  },
  {
    id: 'renameConversation',
    title: 'Rename conversation',
    description: 'Rename the active conversation.',
    command: 'core.renameConversation',
    defaultKeys: ['CommandOrControl+Alt+R'],
    menu: 'file',
  },
  {
    id: 'focusComposer',
    title: 'Focus composer',
    description: 'Move focus to the message composer.',
    command: 'core.focusComposer',
    defaultKeys: ['CommandOrControl+L'],
    menu: 'file',
  },
  {
    id: 'editWorkingDirectory',
    title: 'Edit working directory',
    description: 'Open the working-directory editor.',
    command: 'core.editWorkingDirectory',
    defaultKeys: ['CommandOrControl+Shift+L'],
    menu: 'file',
  },
  {
    id: 'findOnPage',
    title: 'Find on page',
    description: 'Search text in the current page.',
    command: 'core.findOnPage',
    defaultKeys: ['CommandOrControl+F'],
    menu: 'edit',
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Open this settings page.',
    command: 'core.settings',
    defaultKeys: ['CommandOrControl+,'],
    menu: 'app',
  },
  {
    id: 'quit',
    title: 'Quit',
    description: 'Quit the desktop app.',
    command: 'core.quit',
    defaultKeys: ['CommandOrControl+Q'],
    menu: 'app',
  },
  {
    id: 'conversationMode',
    title: 'Conversation mode',
    description: 'Show the normal chat layout.',
    command: 'layout:compact',
    defaultKeys: ['F1'],
    menu: 'view',
  },
  {
    id: 'workbenchMode',
    title: 'Workbench mode',
    description: 'Show the chat and workbench layout.',
    command: 'layout:workbench',
    defaultKeys: ['F2'],
    menu: 'view',
  },
  {
    id: 'toggleSidebar',
    title: 'Toggle left sidebar',
    description: 'Collapse or restore the conversation sidebar.',
    command: 'core.toggleSidebar',
    defaultKeys: ['CommandOrControl+/'],
    menu: 'view',
  },
  {
    id: 'toggleRightRail',
    title: 'Toggle right rail',
    description: 'Collapse or restore the active workbench rail.',
    command: 'core.toggleRightRail',
    defaultKeys: ['CommandOrControl+\\'],
    menu: 'view',
  },
];

export const DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS: DesktopKeyboardShortcuts = Object.fromEntries(
  CORE_KEYBOARD_SHORTCUT_REGISTRATIONS.map((registration) => [registration.id, registration.defaultKeys[0]]),
) as DesktopKeyboardShortcuts;

const DESKTOP_KEYBOARD_SHORTCUT_IDS: DesktopKeyboardShortcutId[] = CORE_KEYBOARD_SHORTCUT_REGISTRATIONS.map(
  (registration) => registration.id,
);

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

function normalizeDesktopKeyboardShortcut(value: string): string | null {
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
