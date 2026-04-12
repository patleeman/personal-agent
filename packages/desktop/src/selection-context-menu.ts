import { BrowserWindow, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron';

export type SelectionContextMenuAction = 'reply' | 'copy';

export interface SelectionContextMenuInput {
  x?: number;
  y?: number;
  canReply?: boolean;
  canCopy?: boolean;
}

function normalizeCoordinate(value: number | undefined): number {
  const numericValue = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.round(numericValue));
}

export function buildSelectionContextMenuTemplate(
  input: SelectionContextMenuInput,
  onSelect: (action: SelectionContextMenuAction) => void,
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];

  if (input.canReply) {
    items.push({
      label: 'Reply with Selection',
      click: () => onSelect('reply'),
    });
  }

  if (input.canCopy) {
    if (items.length > 0) {
      items.push({ type: 'separator' });
    }

    items.push({
      label: 'Copy',
      click: () => onSelect('copy'),
    });
  }

  return items;
}

export async function showSelectionContextMenu(
  sender: WebContents,
  input: SelectionContextMenuInput,
): Promise<{ action: SelectionContextMenuAction | null }> {
  let selectedAction: SelectionContextMenuAction | null = null;
  const template = buildSelectionContextMenuTemplate(input, (nextAction) => {
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
