import { describe, expect, it, vi } from 'vitest';
import { buildKnowledgeEntryContextMenuTemplate } from './knowledge-entry-context-menu.js';

describe('buildKnowledgeEntryContextMenuTemplate', () => {
  it('groups rename and move before delete with a native separator', () => {
    const template = buildKnowledgeEntryContextMenuTemplate({
      canRename: true,
      canMove: true,
      canDelete: true,
    }, vi.fn());

    expect(template.map((item) => item.type === 'separator' ? 'separator' : item.label)).toEqual([
      'Rename',
      'Move to…',
      'separator',
      'Delete',
    ]);
  });

  it('omits separators when only one section is present', () => {
    const template = buildKnowledgeEntryContextMenuTemplate({ canDelete: true }, vi.fn());

    expect(template).toEqual([
      expect.objectContaining({ label: 'Delete' }),
    ]);
  });

  it('returns an empty template when no actions are available', () => {
    expect(buildKnowledgeEntryContextMenuTemplate({}, vi.fn())).toEqual([]);
  });
});
