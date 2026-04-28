import { BrowserWindow, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron';

export type ConversationCwdGroupContextMenuAction =
  | 'open-in-finder'
  | 'edit-name'
  | 'archive-threads'
  | 'remove';

export interface ConversationCwdGroupContextMenuInput {
  x?: number;
  y?: number;
  canOpenInFinder?: boolean;
  canEditName?: boolean;
  canArchiveThreads?: boolean;
  canRemove?: boolean;
}

export function normalizeConversationCwdGroupContextMenuCoordinate(value: number | undefined): number {
  const numericValue = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isSafeInteger(Math.round(numericValue))) {
    return 0;
  }

  return Math.max(0, Math.round(numericValue));
}

function joinMenuSections(sections: MenuItemConstructorOptions[][]): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];

  sections.forEach((section, index) => {
    if (section.length === 0) {
      return;
    }

    if (items.length > 0 && index > 0) {
      items.push({ type: 'separator' });
    }

    items.push(...section);
  });

  return items;
}

export function buildConversationCwdGroupContextMenuTemplate(
  input: ConversationCwdGroupContextMenuInput,
  onSelect: (action: ConversationCwdGroupContextMenuAction) => void,
): MenuItemConstructorOptions[] {
  const primarySection: MenuItemConstructorOptions[] = [];
  const destructiveSection: MenuItemConstructorOptions[] = [];

  if (input.canOpenInFinder) {
    primarySection.push({
      label: 'Open in Finder',
      click: () => onSelect('open-in-finder'),
    });
  }

  if (input.canEditName) {
    primarySection.push({
      label: 'Edit Name',
      click: () => onSelect('edit-name'),
    });
  }

  if (input.canArchiveThreads) {
    destructiveSection.push({
      label: 'Archive Threads',
      click: () => onSelect('archive-threads'),
    });
  }

  if (input.canRemove) {
    destructiveSection.push({
      label: 'Remove',
      click: () => onSelect('remove'),
    });
  }

  return joinMenuSections([primarySection, destructiveSection]);
}

export async function showConversationCwdGroupContextMenu(
  sender: WebContents,
  input: ConversationCwdGroupContextMenuInput,
): Promise<{ action: ConversationCwdGroupContextMenuAction | null }> {
  let selectedAction: ConversationCwdGroupContextMenuAction | null = null;
  const template = buildConversationCwdGroupContextMenuTemplate(input, (nextAction) => {
    selectedAction = nextAction;
  });

  if (template.length === 0) {
    return { action: null };
  }

  const targetWindow = BrowserWindow.fromWebContents(sender) ?? undefined;
  const menu = Menu.buildFromTemplate(template);

  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }

      resolved = true;
      resolve({ action: selectedAction });
    };

    menu.popup({
      ...(targetWindow ? { window: targetWindow } : {}),
      x: normalizeConversationCwdGroupContextMenuCoordinate(input.x),
      y: normalizeConversationCwdGroupContextMenuCoordinate(input.y),
      callback: finish,
    });
  });
}
