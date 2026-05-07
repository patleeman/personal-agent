import { describe, expect, it } from 'vitest';

import {
  buildConversationCwdGroupContextMenuTemplate,
  normalizeConversationCwdGroupContextMenuCoordinate,
} from './conversation-cwd-group-context-menu.js';

// ── conversation-cwd-group-context-menu — template builder ────────────────

describe('buildConversationCwdGroupContextMenuTemplate', () => {
  it('returns empty template when nothing is enabled', () => {
    expect(buildConversationCwdGroupContextMenuTemplate({}, () => {})).toHaveLength(0);
  });

  it('includes open in finder, edit name in primary section', () => {
    const items = buildConversationCwdGroupContextMenuTemplate({ canOpenInFinder: true, canEditName: true }, () => {});
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Open in Finder'),
    ).toBe(true);
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Edit Name'),
    ).toBe(true);
  });

  it('includes archive threads and remove in destructive section', () => {
    const items = buildConversationCwdGroupContextMenuTemplate({ canArchiveThreads: true, canRemove: true }, () => {});
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Archive Threads'),
    ).toBe(true);
    expect(items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Remove')).toBe(
      true,
    );
  });

  it('inserts separator between primary and destructive sections', () => {
    const items = buildConversationCwdGroupContextMenuTemplate({ canOpenInFinder: true, canArchiveThreads: true }, () => {});
    const separators = items.filter(
      (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'type' in item && item.type === 'separator',
    );
    expect(separators.length).toBe(1);
  });

  it('invokes onSelect callback on click', () => {
    const actions: string[] = [];
    const items = buildConversationCwdGroupContextMenuTemplate({ canRemove: true }, (action: string) => actions.push(action));
    const removeItem = items.find(
      (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Remove',
    );
    if (removeItem && 'click' in removeItem && typeof removeItem.click === 'function') {
      removeItem.click(undefined as unknown as Electron.MenuItem, undefined as unknown as Electron.BrowserWindow, undefined as any);
    }
    expect(actions).toContain('remove');
  });
});

describe('normalizeConversationCwdGroupContextMenuCoordinate', () => {
  it('returns 0 for undefined', () => {
    expect(normalizeConversationCwdGroupContextMenuCoordinate(undefined)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(normalizeConversationCwdGroupContextMenuCoordinate(Number.NaN)).toBe(0);
  });

  it('returns 0 for negative', () => {
    expect(normalizeConversationCwdGroupContextMenuCoordinate(-5)).toBe(0);
  });

  it('passes safe integers', () => {
    expect(normalizeConversationCwdGroupContextMenuCoordinate(50)).toBe(50);
  });
});
