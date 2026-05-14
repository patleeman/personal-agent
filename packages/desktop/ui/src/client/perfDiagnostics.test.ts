// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('perfDiagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('records chat render timing samples', async () => {
    const { recordChatRenderTiming } = await import('./perfDiagnostics');

    recordChatRenderTiming({
      conversationId: 'conv-1',
      route: '/conversations/conv-1',
      startedAtMs: performance.now() - 12,
      meta: { messageCount: 4, toolBlocks: 1 },
    });

    const perf = (globalThis as typeof globalThis & { __PA_APP_PERF__?: { chatRenderSamples?: unknown[] } }).__PA_APP_PERF__;
    expect(perf?.chatRenderSamples).toEqual([
      expect.objectContaining({
        conversationId: 'conv-1',
        route: '/conversations/conv-1',
        meta: { messageCount: 4, toolBlocks: 1 },
      }),
    ]);
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
