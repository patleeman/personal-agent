import { describe, expect, it, vi } from 'vitest';

import { clearThreadColor, cycleThreadColor, getThreadColorStyles } from './backend';

function createContext() {
  const values = new Map<string, unknown>();
  return {
    values,
    ctx: {
      storage: {
        get: vi.fn(async (key: string) => values.get(key) ?? null),
        put: vi.fn(async (key: string, value: unknown) => {
          values.set(key, value);
          return { ok: true as const };
        }),
        delete: vi.fn(async (key: string) => {
          const deleted = values.delete(key);
          return { ok: true as const, deleted };
        }),
      },
      ui: { invalidate: vi.fn() },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as never,
  };
}

describe('thread color backend actions', () => {
  it('cycles and clears stored thread colors', async () => {
    const { ctx, values } = createContext();

    await expect(cycleThreadColor({ conversationId: 'conv-1' }, ctx)).resolves.toEqual({
      ok: true,
      conversationId: 'conv-1',
      color: '#ef4444',
    });
    expect(values.get('thread-color:conv-1')).toBe('#ef4444');

    await expect(cycleThreadColor({ conversationId: 'conv-1' }, ctx)).resolves.toEqual({
      ok: true,
      conversationId: 'conv-1',
      color: '#f97316',
    });
    expect(values.get('thread-color:conv-1')).toBe('#f97316');

    await expect(clearThreadColor({ conversationId: 'conv-1' }, ctx)).resolves.toEqual({ ok: true, conversationId: 'conv-1' });
    expect(values.has('thread-color:conv-1')).toBe(false);
  });

  it('returns activity tree style rows for colored conversations and runs', async () => {
    const { ctx, values } = createContext();
    values.set('thread-color:conv-1', '#3b82f6');

    await expect(
      getThreadColorStyles(
        {
          items: [
            { id: 'conversation:conv-1', kind: 'conversation' },
            { id: 'run:run-1', kind: 'run', metadata: { conversationId: 'conv-1' } },
            { id: 'conversation:conv-2', kind: 'conversation' },
          ],
        },
        ctx,
      ),
    ).resolves.toEqual([
      {
        id: 'conversation:conv-1',
        accentColor: '#3b82f6',
        backgroundColor: 'color-mix(in srgb, #3b82f6 12%, transparent)',
        tooltip: 'Colored thread',
      },
      {
        id: 'run:run-1',
        accentColor: '#3b82f6',
        backgroundColor: 'color-mix(in srgb, #3b82f6 12%, transparent)',
        tooltip: 'Colored thread',
      },
    ]);
  });
});
