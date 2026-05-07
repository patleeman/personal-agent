import { describe, expect, it } from 'vitest';

import { buildSelectionContextMenuTemplate, normalizeSelectionContextMenuCoordinate } from './selection-context-menu.js';

// ── selection-context-menu — template builder ─────────────────────────────

describe('buildSelectionContextMenuTemplate', () => {
  it('returns empty template when nothing is enabled', () => {
    expect(buildSelectionContextMenuTemplate({}, () => {})).toHaveLength(0);
  });

  it('includes reply with selection when canReply', () => {
    const items = buildSelectionContextMenuTemplate({ canReply: true }, () => {});
    expect(
      items.some(
        (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Reply with Selection',
      ),
    ).toBe(true);
  });

  it('includes copy when canCopy', () => {
    const items = buildSelectionContextMenuTemplate({ canCopy: true }, () => {});
    expect(items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Copy')).toBe(
      true,
    );
  });

  it('includes both when both enabled', () => {
    const items = buildSelectionContextMenuTemplate({ canReply: true, canCopy: true }, () => {});
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it('inserts separator between reply and copy when both present', () => {
    const items = buildSelectionContextMenuTemplate({ canReply: true, canCopy: true }, () => {});
    const separators = items.filter(
      (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'type' in item && item.type === 'separator',
    );
    expect(separators.length).toBe(1);
  });
});

describe('normalizeSelectionContextMenuCoordinate', () => {
  it('returns 0 for undefined', () => {
    expect(normalizeSelectionContextMenuCoordinate(undefined)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(normalizeSelectionContextMenuCoordinate(Number.NaN)).toBe(0);
  });

  it('returns 0 for negative', () => {
    expect(normalizeSelectionContextMenuCoordinate(-1)).toBe(0);
  });

  it('passes safe integers through', () => {
    expect(normalizeSelectionContextMenuCoordinate(42)).toBe(42);
  });
});
