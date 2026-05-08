import type { ExtensionKeybindingRegistration } from './types';

export interface KeybindingEventLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

const MODIFIER_ALIASES: Record<string, 'mod' | 'ctrl' | 'meta' | 'alt' | 'shift'> = {
  mod: 'mod',
  cmd: 'mod',
  command: 'mod',
  commandorcontrol: 'mod',
  cmdorctrl: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  meta: 'meta',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
};

function normalizeKey(value: string): string {
  const key = value.trim();
  if (key.length === 1) return key.toLowerCase();
  return key.toLowerCase().replace(/^arrow/, '');
}

function matchesExtensionKeybinding(event: KeybindingEventLike, shortcut: string): boolean {
  if (event.isComposing) return false;
  const parts = shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;

  const required = new Set<'mod' | 'ctrl' | 'meta' | 'alt' | 'shift'>();
  let key: string | null = null;
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      required.add(modifier);
      continue;
    }
    key = normalizeKey(part);
  }

  if (!key) return false;
  const eventMod = event.metaKey || event.ctrlKey;
  if (required.has('mod') !== eventMod) return false;
  if (!required.has('mod') && required.has('ctrl') !== event.ctrlKey) return false;
  if (!required.has('mod') && required.has('meta') !== event.metaKey) return false;
  if (required.has('alt') !== event.altKey) return false;
  if (required.has('shift') !== event.shiftKey) return false;

  return normalizeKey(event.key) === key || normalizeKey(event.code ?? '') === key;
}

export function findMatchingExtensionKeybinding(
  event: KeybindingEventLike,
  keybindings: ExtensionKeybindingRegistration[],
): ExtensionKeybindingRegistration | null {
  return keybindings.find((keybinding) => keybinding.keys.some((shortcut) => matchesExtensionKeybinding(event, shortcut))) ?? null;
}
