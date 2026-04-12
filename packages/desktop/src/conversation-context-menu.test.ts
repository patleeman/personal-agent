import { describe, expect, it, vi } from 'vitest';
import { buildConversationContextMenuTemplate } from './conversation-context-menu.js';

describe('buildConversationContextMenuTemplate', () => {
  it('groups conversation, creation, and copy actions with native separators', () => {
    const template = buildConversationContextMenuTemplate({
      pinAction: 'pin',
      canArchive: true,
      canDuplicate: true,
      canSummarizeAndNew: true,
      canCopyWorkingDirectory: true,
      canCopyId: true,
      canCopyDeeplink: true,
    }, vi.fn());

    expect(template.map((item) => item.type === 'separator' ? 'separator' : item.label)).toEqual([
      'Pin Chat',
      'Archive Chat',
      'separator',
      'Duplicate Chat',
      'Summarize & New',
      'separator',
      'Copy Working Directory',
      'Copy Session ID',
      'Copy Deeplink',
    ]);
  });

  it('switches to unpin when the conversation is already pinned', () => {
    const template = buildConversationContextMenuTemplate({ pinAction: 'unpin' }, vi.fn());

    expect(template).toEqual([
      expect.objectContaining({ label: 'Unpin Chat' }),
    ]);
  });

  it('disables all actions while a sidebar action is already running', () => {
    const template = buildConversationContextMenuTemplate({
      pinAction: 'pin',
      canArchive: true,
      canDuplicate: true,
      canSummarizeAndNew: true,
      canCopyWorkingDirectory: true,
      canCopyId: true,
      canCopyDeeplink: true,
      busyAction: 'duplicate',
    }, vi.fn());

    expect(template.filter((item) => item.type !== 'separator')).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Pin Chat', enabled: false }),
      expect.objectContaining({ label: 'Archive Chat', enabled: false }),
      expect.objectContaining({ label: 'Duplicating…', enabled: false }),
      expect.objectContaining({ label: 'Summarize & New', enabled: false }),
      expect.objectContaining({ label: 'Copy Working Directory', enabled: false }),
      expect.objectContaining({ label: 'Copy Session ID', enabled: false }),
      expect.objectContaining({ label: 'Copy Deeplink', enabled: false }),
    ]));
  });

  it('omits separators when only one section is present', () => {
    const template = buildConversationContextMenuTemplate({ canCopyWorkingDirectory: true }, vi.fn());

    expect(template).toEqual([
      expect.objectContaining({ label: 'Copy Working Directory' }),
    ]);
  });
});
