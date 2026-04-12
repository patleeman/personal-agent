import { BrowserWindow, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron';

export interface SelectionContextMenuInput {
  x?: number;
  y?: number;
  canCopy?: boolean;
}

function normalizeCoordinate(value: number | undefined): number {
  const numericValue = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.round(numericValue));
}

export function buildSelectionContextMenuTemplate(input: SelectionContextMenuInput): MenuItemConstructorOptions[] {
  if (!input.canCopy) {
    return [];
  }

  return [{
    label: 'Copy',
    role: 'copy',
  }];
}

export async function showSelectionContextMenu(
  sender: WebContents,
  input: SelectionContextMenuInput,
): Promise<{ shown: boolean }> {
  const template = buildSelectionContextMenuTemplate(input);
  if (template.length === 0) {
    return { shown: false };
  }

  const targetWindow = BrowserWindow.fromWebContents(sender) ?? undefined;
  const menu = Menu.buildFromTemplate(template);

  return new Promise((resolve) => {
    menu.popup({
      ...(targetWindow ? { window: targetWindow } : {}),
      x: normalizeCoordinate(input.x),
      y: normalizeCoordinate(input.y),
      callback: () => resolve({ shown: true }),
    });
  });
}
