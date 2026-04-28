import { describe, expect, it, vi } from 'vitest';
import { buildKnowledgeEntryContextMenuTemplate, normalizeKnowledgeEntryContextMenuCoordinate } from './knowledge-entry-context-menu.js';

describe('buildKnowledgeEntryContextMenuTemplate', () => {
  it('drops unsafe menu coordinates', () => {
    expect(normalizeKnowledgeEntryContextMenuCoordinate(12.4)).toBe(0);
    expect(normalizeKnowledgeEntryContextMenuCoordinate(Number.MAX_SAFE_INTEGER + 1)).toBe(0);
  });

  it('groups rename and move before delete with a native separator', () => {
    const template = buildKnowledgeEntryContextMenuTemplate({
      canOpenInFinder: true,
      canCreateFile: true,
      canCreateFolder: true,
      canRename: true,
      canMove: true,
      canDelete: true,
    }, vi.fn());

    expect(template.map((item) => item.type === 'separator' ? 'separator' : item.label)).toEqual([
      'New File',
      'New Folder',
      'separator',
      'Open in Finder',
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
