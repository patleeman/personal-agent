import { BrowserWindow, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron';

export type ConversationContextMenuAction =
  | 'pin'
  | 'unpin'
  | 'archive'
  | 'open-in-new-window'
  | 'duplicate'
  | 'summarize-and-new'
  | 'copy-working-directory'
  | 'copy-id'
  | 'copy-deeplink';

export interface ConversationContextMenuInput {
  x?: number;
  y?: number;
  pinAction?: 'pin' | 'unpin' | null;
  canArchive?: boolean;
  canOpenInNewWindow?: boolean;
  canDuplicate?: boolean;
  canSummarizeAndNew?: boolean;
  canCopyWorkingDirectory?: boolean;
  canCopyId?: boolean;
  canCopyDeeplink?: boolean;
  busyAction?: 'duplicate' | 'summarize' | null;
}

function normalizeCoordinate(value: number | undefined): number {
  const numericValue = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(numericValue)) {
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

export function buildConversationContextMenuTemplate(
  input: ConversationContextMenuInput,
  onSelect: (action: ConversationContextMenuAction) => void,
): MenuItemConstructorOptions[] {
  const menuDisabled = input.busyAction === 'duplicate' || input.busyAction === 'summarize';
  const conversationSection: MenuItemConstructorOptions[] = [];
  const windowSection: MenuItemConstructorOptions[] = [];
  const creationSection: MenuItemConstructorOptions[] = [];
  const copySection: MenuItemConstructorOptions[] = [];

  if (input.pinAction === 'pin') {
    conversationSection.push({
      label: 'Pin Chat',
      enabled: !menuDisabled,
      click: () => onSelect('pin'),
    });
  } else if (input.pinAction === 'unpin') {
    conversationSection.push({
      label: 'Unpin Chat',
      enabled: !menuDisabled,
      click: () => onSelect('unpin'),
    });
  }

  if (input.canArchive) {
    conversationSection.push({
      label: 'Archive Chat',
      enabled: !menuDisabled,
      click: () => onSelect('archive'),
    });
  }

  if (input.canOpenInNewWindow) {
    windowSection.push({
      label: 'Open in Separate Window',
      enabled: !menuDisabled,
      click: () => onSelect('open-in-new-window'),
    });
  }

  if (input.canDuplicate) {
    creationSection.push({
      label: input.busyAction === 'duplicate' ? 'Duplicating…' : 'Duplicate Chat',
      enabled: !menuDisabled,
      click: () => onSelect('duplicate'),
    });
  }

  if (input.canSummarizeAndNew) {
    creationSection.push({
      label: input.busyAction === 'summarize' ? 'Summarizing…' : 'Summarize & New',
      enabled: !menuDisabled,
      click: () => onSelect('summarize-and-new'),
    });
  }

  if (input.canCopyWorkingDirectory) {
    copySection.push({
      label: 'Copy Working Directory',
      enabled: !menuDisabled,
      click: () => onSelect('copy-working-directory'),
    });
  }

  if (input.canCopyId) {
    copySection.push({
      label: 'Copy Session ID',
      enabled: !menuDisabled,
      click: () => onSelect('copy-id'),
    });
  }

  if (input.canCopyDeeplink) {
    copySection.push({
      label: 'Copy Deeplink',
      enabled: !menuDisabled,
      click: () => onSelect('copy-deeplink'),
    });
  }

  return joinMenuSections([conversationSection, windowSection, creationSection, copySection]);
}

export async function showConversationContextMenu(
  sender: WebContents,
  input: ConversationContextMenuInput,
): Promise<{ action: ConversationContextMenuAction | null }> {
  let selectedAction: ConversationContextMenuAction | null = null;
  const template = buildConversationContextMenuTemplate(input, (nextAction) => {
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
      x: normalizeCoordinate(input.x),
      y: normalizeCoordinate(input.y),
      callback: finish,
    });
  });
}
