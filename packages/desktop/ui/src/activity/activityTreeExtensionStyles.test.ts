import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../client/api';
import type { ExtensionActivityTreeItemStyleRegistration } from '../extensions/useExtensionRegistry';
import type { ActivityTreeItem } from './activityTree';
import { applyActivityTreeItemStyleProviders } from './activityTreeExtensionStyles';

vi.mock('../client/api', () => ({
  api: {
    invokeExtensionAction: vi.fn(),
  },
}));

function item(overrides: Partial<ActivityTreeItem> & Pick<ActivityTreeItem, 'id' | 'title'>): ActivityTreeItem {
  return {
    kind: overrides.kind ?? 'conversation',
    status: overrides.status ?? 'idle',
    ...overrides,
  };
}

const provider: ExtensionActivityTreeItemStyleRegistration = {
  extensionId: 'thread-colors',
  id: 'colors',
  provider: 'getStyles',
};

describe('applyActivityTreeItemStyleProviders', () => {
  beforeEach(() => {
    vi.mocked(api.invokeExtensionAction).mockReset();
  });

  it('applies provider styles by activity item id', async () => {
    vi.mocked(api.invokeExtensionAction).mockResolvedValue({
      result: [{ id: 'conversation:1', accentColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.12)' }],
    } as never);

    const result = await applyActivityTreeItemStyleProviders([item({ id: 'conversation:1', title: 'Thread' })], [provider]);

    expect(result[0]).toEqual(expect.objectContaining({ accentColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.12)' }));
    expect(api.invokeExtensionAction).toHaveBeenCalledWith('thread-colors', 'getStyles', {
      items: [expect.objectContaining({ id: 'conversation:1' })],
    });
  });

  it('keeps existing higher-priority style fields', async () => {
    vi.mocked(api.invokeExtensionAction).mockResolvedValue({ result: [{ id: 'conversation:1', accentColor: '#000' }] } as never);

    const result = await applyActivityTreeItemStyleProviders(
      [item({ id: 'conversation:1', title: 'Thread', accentColor: '#fff' })],
      [provider],
    );

    expect(result[0]?.accentColor).toBe('#fff');
  });

  it('survives provider failures', async () => {
    vi.mocked(api.invokeExtensionAction).mockRejectedValue(new Error('boom'));

    await expect(applyActivityTreeItemStyleProviders([item({ id: 'conversation:1', title: 'Thread' })], [provider])).resolves.toEqual([
      expect.objectContaining({ id: 'conversation:1' }),
    ]);
  });
});
