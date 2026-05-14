import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invokeExtensionAction: vi.fn(),
}));

vi.mock('@personal-agent/extensions/data', () => ({
  api: {
    invokeExtensionAction: mocks.invokeExtensionAction,
  },
}));

import { knowledgeApi } from './knowledgeApi';

describe('knowledgeApi', () => {
  beforeEach(() => {
    mocks.invokeExtensionAction.mockReset();
  });

  it('returns action results', async () => {
    mocks.invokeExtensionAction.mockResolvedValue({ ok: true, result: { root: '/vault', files: [] } });

    await expect(knowledgeApi.listFiles()).resolves.toEqual({ root: '/vault', files: [] });
    expect(mocks.invokeExtensionAction).toHaveBeenCalledWith('system-knowledge', 'vaultListFiles', {});
  });

  it('throws extension action errors instead of returning undefined results', async () => {
    mocks.invokeExtensionAction.mockResolvedValue({ ok: false, error: 'Knowledge backend unavailable' });

    await expect(knowledgeApi.listFiles()).rejects.toThrow('Knowledge backend unavailable');
  });
});
