import { describe, expect, it, vi } from 'vitest';
import { buildConversationCwdGroupContextMenuTemplate } from './conversation-cwd-group-context-menu.js';

describe('buildConversationCwdGroupContextMenuTemplate', () => {
  it('groups primary and removal actions with a separator', () => {
    const template = buildConversationCwdGroupContextMenuTemplate({
      canOpenInFinder: true,
      canEditName: true,
      canArchiveThreads: true,
      canRemove: true,
    }, vi.fn());

    expect(template.map((item) => item.type === 'separator' ? 'separator' : item.label)).toEqual([
      'Open in Finder',
      'Edit Name',
      'separator',
      'Archive Threads',
      'Remove',
    ]);
  });

  it('omits the primary section when only archive and remove are available', () => {
    const template = buildConversationCwdGroupContextMenuTemplate({
      canArchiveThreads: true,
      canRemove: true,
    }, vi.fn());

    expect(template).toEqual([
      expect.objectContaining({ label: 'Archive Threads' }),
      expect.objectContaining({ label: 'Remove' }),
    ]);
  });

  it('returns an empty template when no actions are enabled', () => {
    expect(buildConversationCwdGroupContextMenuTemplate({}, vi.fn())).toEqual([]);
  });
});
