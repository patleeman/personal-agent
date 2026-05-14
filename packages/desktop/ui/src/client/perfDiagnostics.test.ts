// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('perfDiagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('records conversation extension-open phase timing', async () => {
    const { completeConversationOpenPhase, ensureConversationOpenStart } = await import('./perfDiagnostics');

    ensureConversationOpenStart('conv-1', 'route');
    completeConversationOpenPhase('conv-1', 'extensions', { extensionCount: 3 });

    const perf = (globalThis as typeof globalThis & { __PA_APP_PERF__?: { conversationOpenSamples?: unknown[] } }).__PA_APP_PERF__;
    expect(perf?.conversationOpenSamples).toEqual([
      expect.objectContaining({
        conversationId: 'conv-1',
        source: 'route',
        phase: 'extensions',
        meta: { extensionCount: 3 },
      }),
    ]);
  });
});
