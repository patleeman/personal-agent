import { afterEach, describe, expect, it, vi } from 'vitest';

const mockSetExtensionEnabled = vi.fn();

vi.mock('../../../packages/desktop/server/extensions/extensionRegistry.js', () => ({
  setExtensionEnabled: (...args: unknown[]) => mockSetExtensionEnabled(...args),
}));

import { ensure } from './backend.js';

function createCtx(overrides: Record<string, unknown> = {}) {
  const storage = {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue({ ok: true, deleted: false }),
  };
  const conversations = {
    create: vi.fn().mockResolvedValue({ id: 'conv-1' }),
    setTitle: vi.fn().mockResolvedValue(undefined),
    appendVisibleCustomMessage: vi.fn().mockResolvedValue(undefined),
  };
  const runtime = {
    getRepoRoot: vi.fn(() => '/repo'),
  };
  const ui = {
    invalidate: vi.fn(),
  };

  return {
    extensionId: 'system-onboarding',
    profile: 'test-profile',
    storage,
    conversations,
    runtime,
    ui,
    ...overrides,
  } as never;
}

describe('system-onboarding backend', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('de-duplicates concurrent ensure calls', async () => {
    let resolveCreate: ((value: { id: string }) => void) | null = null;
    const conversations = {
      create: vi.fn().mockImplementation(
        () =>
          new Promise<{ id: string }>((resolve) => {
            resolveCreate = resolve;
          }),
      ),
      setTitle: vi.fn().mockResolvedValue(undefined),
      appendVisibleCustomMessage: vi.fn().mockResolvedValue(undefined),
    };
    const storage = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue({ ok: true }),
      delete: vi.fn().mockResolvedValue({ ok: true, deleted: false }),
    };
    const ctx = createCtx({ conversations, storage });

    const first = ensure(undefined, ctx);
    const second = ensure(undefined, ctx);

    await Promise.resolve();
    await Promise.resolve();
    expect(conversations.create).toHaveBeenCalledTimes(1);

    resolveCreate?.({ id: 'conv-1' });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual({ created: true, conversationId: 'conv-1' });
    expect(secondResult).toEqual({ created: true, conversationId: 'conv-1' });
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(conversations.setTitle).toHaveBeenCalledTimes(1);
    expect(conversations.appendVisibleCustomMessage).toHaveBeenCalledTimes(1);
    expect(mockSetExtensionEnabled).toHaveBeenCalledWith('system-onboarding', false);
  });

  it('returns the existing onboarding conversation once completed', async () => {
    const conversations = {
      create: vi.fn().mockResolvedValue({ id: 'conv-2' }),
      setTitle: vi.fn().mockResolvedValue(undefined),
      appendVisibleCustomMessage: vi.fn().mockResolvedValue(undefined),
    };
    const storage = {
      get: vi.fn().mockResolvedValue({
        completed: true,
        conversationId: 'conv-1',
        completedAt: '2026-05-12T00:00:00.000Z',
      }),
      put: vi.fn().mockResolvedValue({ ok: true }),
      delete: vi.fn().mockResolvedValue({ ok: true, deleted: false }),
    };
    const ui = { invalidate: vi.fn() };
    const ctx = createCtx({ conversations, storage, ui });

    await expect(ensure(undefined, ctx)).resolves.toEqual({
      created: false,
      conversationId: 'conv-1',
      skipped: 'completed',
    });

    expect(conversations.create).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(mockSetExtensionEnabled).toHaveBeenCalledWith('system-onboarding', false);
    expect(ui.invalidate).toHaveBeenCalledWith(['extensions']);
  });
});
