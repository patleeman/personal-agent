import { describe, expect, it } from 'vitest';

import { buildKnowledgeEntryContextMenuTemplate, normalizeKnowledgeEntryContextMenuCoordinate } from './knowledge-entry-context-menu.js';

// ── knowledge-entry-context-menu — template builder ───────────────────────

describe('buildKnowledgeEntryContextMenuTemplate', () => {
  it('returns empty template when nothing is enabled', () => {
    expect(buildKnowledgeEntryContextMenuTemplate({}, () => {})).toHaveLength(0);
  });

  it('includes new file and new folder', () => {
    const items = buildKnowledgeEntryContextMenuTemplate({ canCreateFile: true, canCreateFolder: true }, () => {});
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'New File'),
    ).toBe(true);
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'New Folder'),
    ).toBe(true);
  });

  it('includes open in finder, rename, move', () => {
    const items = buildKnowledgeEntryContextMenuTemplate({ canOpenInFinder: true, canRename: true, canMove: true }, () => {});
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Open in Finder'),
    ).toBe(true);
    expect(items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Rename')).toBe(
      true,
    );
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Move to…'),
    ).toBe(true);
  });

  it('includes delete in destructive section', () => {
    const items = buildKnowledgeEntryContextMenuTemplate({ canDelete: true }, () => {});
    expect(items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Delete')).toBe(
      true,
    );
  });

  it('invokes onSelect callback on click', () => {
    const actions: string[] = [];
    const items = buildKnowledgeEntryContextMenuTemplate({ canDelete: true }, (action: string) => actions.push(action));
    const deleteItem = items.find(
      (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Delete',
    );
    if (deleteItem && 'click' in deleteItem && typeof deleteItem.click === 'function') {
      deleteItem.click(undefined as unknown as Electron.MenuItem, undefined as unknown as Electron.BrowserWindow, undefined as any);
    }
    expect(actions).toContain('delete');
  });

  it('inserts separators between create, primary, and destructive sections', () => {
    const items = buildKnowledgeEntryContextMenuTemplate({ canCreateFile: true, canOpenInFinder: true, canDelete: true }, () => {});
    const separators = items.filter(
      (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'type' in item && item.type === 'separator',
    );
    expect(separators.length).toBeGreaterThanOrEqual(1);
  });
});

describe('normalizeKnowledgeEntryContextMenuCoordinate', () => {
  it('returns 0 for undefined', () => {
    expect(normalizeKnowledgeEntryContextMenuCoordinate(undefined)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(normalizeKnowledgeEntryContextMenuCoordinate(Number.NaN)).toBe(0);
  });

  it('returns 0 for negative values', () => {
    expect(normalizeKnowledgeEntryContextMenuCoordinate(-10)).toBe(0);
  });

  it('returns safe integer as-is', () => {
    expect(normalizeKnowledgeEntryContextMenuCoordinate(200)).toBe(200);
  });
});
