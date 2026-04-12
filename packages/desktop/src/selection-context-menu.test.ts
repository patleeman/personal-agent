import { describe, expect, it, vi } from 'vitest';
import { buildSelectionContextMenuTemplate } from './selection-context-menu.js';

describe('buildSelectionContextMenuTemplate', () => {
  it('includes reply and copy actions when both are available', () => {
    const onSelect = vi.fn();
    expect(buildSelectionContextMenuTemplate({ canReply: true, canCopy: true }, onSelect)).toEqual([
      expect.objectContaining({ label: 'Reply with Selection' }),
      expect.objectContaining({ type: 'separator' }),
      expect.objectContaining({ label: 'Copy' }),
    ]);
  });

  it('returns a single native copy action when only copy is available', () => {
    const onSelect = vi.fn();
    expect(buildSelectionContextMenuTemplate({ canCopy: true }, onSelect)).toEqual([
      expect.objectContaining({ label: 'Copy' }),
    ]);
  });

  it('omits the menu when no actions are available', () => {
    const onSelect = vi.fn();
    expect(buildSelectionContextMenuTemplate({ canReply: false, canCopy: false }, onSelect)).toEqual([]);
    expect(buildSelectionContextMenuTemplate({}, onSelect)).toEqual([]);
  });
});
