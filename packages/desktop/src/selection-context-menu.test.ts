import { describe, expect, it } from 'vitest';
import { buildSelectionContextMenuTemplate } from './selection-context-menu.js';

describe('buildSelectionContextMenuTemplate', () => {
  it('returns a single native copy action when text is selected', () => {
    expect(buildSelectionContextMenuTemplate({ canCopy: true })).toEqual([
      expect.objectContaining({ label: 'Copy', role: 'copy' }),
    ]);
  });

  it('omits the menu when nothing can be copied', () => {
    expect(buildSelectionContextMenuTemplate({ canCopy: false })).toEqual([]);
    expect(buildSelectionContextMenuTemplate({})).toEqual([]);
  });
});
