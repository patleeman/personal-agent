import { BrowserWindow } from 'electron';
import { describe, expect, it } from 'vitest';

import { buildConversationContextMenuTemplate, normalizeConversationContextMenuCoordinate } from './conversation-context-menu.js';

// ── conversation-context-menu — template builder ──────────────────────────

describe('buildConversationContextMenuTemplate', () => {
  it('returns pin chat when pinAction is pin', () => {
    const items = buildConversationContextMenuTemplate({ pinAction: 'pin' }, () => {});
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Pin Chat'),
    ).toBe(true);
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Unpin Chat'),
    ).toBe(false);
  });

  it('returns unpin chat when pinAction is unpin', () => {
    const items = buildConversationContextMenuTemplate({ pinAction: 'unpin' }, () => {});
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Unpin Chat'),
    ).toBe(true);
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Pin Chat'),
    ).toBe(false);
  });

  it('includes archive when canArchive is true', () => {
    const items = buildConversationContextMenuTemplate({ canArchive: true }, () => {});
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Archive Chat'),
    ).toBe(true);
  });

  it('includes open in separate window', () => {
    const items = buildConversationContextMenuTemplate({ canOpenInNewWindow: true }, () => {});
    expect(
      items.some(
        (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Open in Separate Window',
      ),
    ).toBe(true);
  });

  it('includes duplicate chat', () => {
    const items = buildConversationContextMenuTemplate({ canDuplicate: true }, () => {});
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Duplicate Chat'),
    ).toBe(true);
  });

  it('disables duplicate when busyAction is duplicate', () => {
    const items = buildConversationContextMenuTemplate({ canDuplicate: true, busyAction: 'duplicate' }, () => {});
    const duplicate = items.find(
      (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Duplicating…',
    );
    expect(duplicate).toBeDefined();
    expect(duplicate && 'enabled' in duplicate ? duplicate.enabled : true).toBe(false);
  });

  it('includes attach to gateway', () => {
    const items = buildConversationContextMenuTemplate({ canAttachToGateway: true }, () => {});
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Attach to Gateway'),
    ).toBe(true);
  });

  it('includes copy items', () => {
    const items = buildConversationContextMenuTemplate({ canCopyWorkingDirectory: true, canCopyId: true, canCopyDeeplink: true }, () => {});
    expect(
      items.some(
        (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Copy Working Directory',
      ),
    ).toBe(true);
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Copy Session ID'),
    ).toBe(true);
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Copy Deeplink'),
    ).toBe(true);
  });

  it('returns empty template when nothing is enabled', () => {
    const items = buildConversationContextMenuTemplate({}, () => {});
    expect(items.length).toBe(0);
  });

  it('inserts separators between sections', () => {
    const items = buildConversationContextMenuTemplate(
      { pinAction: 'pin', canArchive: true, canOpenInNewWindow: true, canCopyId: true },
      () => {},
    );
    const separatorCount = items.filter(
      (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'type' in item && item.type === 'separator',
    ).length;
    expect(separatorCount).toBeGreaterThanOrEqual(1);
  });

  it('invokes onSelect when an item is clicked', () => {
    const actions: string[] = [];
    const items = buildConversationContextMenuTemplate({ pinAction: 'pin' }, (action: string) => actions.push(action));
    const pinItem = items.find(
      (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Pin Chat',
    );
    expect(pinItem).toBeDefined();
    if (pinItem && 'click' in pinItem && typeof pinItem.click === 'function') {
      pinItem.click(undefined as unknown as Electron.MenuItem, undefined as unknown as BrowserWindow, undefined as any);
    }
    expect(actions).toContain('pin');
  });
});

describe('normalizeConversationContextMenuCoordinate', () => {
  it('returns 0 for undefined', () => {
    expect(normalizeConversationContextMenuCoordinate(undefined)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(normalizeConversationContextMenuCoordinate(Number.NaN)).toBe(0);
  });

  it('returns 0 for negative numbers', () => {
    expect(normalizeConversationContextMenuCoordinate(-5)).toBe(0);
  });

  it('returns a safe integer as-is', () => {
    expect(normalizeConversationContextMenuCoordinate(100)).toBe(100);
  });

  it('clamps large non-integer values to 0', () => {
    expect(normalizeConversationContextMenuCoordinate(1.5)).toBe(0);
  });
});
