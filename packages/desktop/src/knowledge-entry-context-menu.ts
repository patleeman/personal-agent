import { BrowserWindow, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron';

export type KnowledgeEntryContextMenuAction = 'rename' | 'move' | 'delete';

export interface KnowledgeEntryContextMenuInput {
  x?: number;
  y?: number;
  canRename?: boolean;
  canMove?: boolean;
  canDelete?: boolean;
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

export function buildKnowledgeEntryContextMenuTemplate(
  input: KnowledgeEntryContextMenuInput,
  onSelect: (action: KnowledgeEntryContextMenuAction) => void,
): MenuItemConstructorOptions[] {
  const primarySection: MenuItemConstructorOptions[] = [];
  const destructiveSection: MenuItemConstructorOptions[] = [];

  if (input.canRename) {
    primarySection.push({
      label: 'Rename',
      click: () => onSelect('rename'),
    });
  }

  if (input.canMove) {
    primarySection.push({
      label: 'Move to…',
      click: () => onSelect('move'),
    });
  }

  if (input.canDelete) {
    destructiveSection.push({
      label: 'Delete',
      click: () => onSelect('delete'),
    });
  }

  return joinMenuSections([primarySection, destructiveSection]);
}

export async function showKnowledgeEntryContextMenu(
  sender: WebContents,
  input: KnowledgeEntryContextMenuInput,
): Promise<{ action: KnowledgeEntryContextMenuAction | null }> {
  let selectedAction: KnowledgeEntryContextMenuAction | null = null;
  const template = buildKnowledgeEntryContextMenuTemplate(input, (nextAction) => {
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
