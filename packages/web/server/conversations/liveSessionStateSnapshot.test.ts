import { describe, expect, it, vi } from 'vitest';

const existsSyncMock = vi.fn(() => true);
const readSessionBlocksByFileMock = vi.fn(() => ({
  blocks: [],
  blockOffset: 0,
  totalBlocks: 0,
  contextUsage: null,
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}));

vi.mock('./sessions.js', () => ({
  buildDisplayBlocksFromEntries: () => [],
  readSessionBlocksByFile: readSessionBlocksByFileMock,
}));

describe('liveSessionStateSnapshot', () => {
  it('defaults unsafe live snapshot tail block limits', async () => {
    const { buildLiveSessionSnapshot } = await import('./liveSessionStateSnapshot.js');

    buildLiveSessionSnapshot({
      session: {
        sessionFile: '/tmp/session.jsonl',
        isStreaming: false,
        state: { messages: [] },
      },
    } as never, Number.MAX_SAFE_INTEGER + 1);

    expect(readSessionBlocksByFileMock).toHaveBeenCalledWith('/tmp/session.jsonl', { tailBlocks: 400 });
  });
});
