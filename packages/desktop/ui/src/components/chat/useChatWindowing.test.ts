import { describe, expect, it } from 'vitest';
import type { ChatRenderChunk } from './chatWindowing.js';
import { buildChatRenderChunkLayouts, calculateAverageSpanHeight, resolveVisibleChunkRange } from './useChatWindowing.js';

const chunks: ChatRenderChunk[] = [
  {
    key: '0-1-1',
    items: [],
    startItemIndex: 0,
    endItemIndex: 0,
    startMessageIndex: 0,
    endMessageIndex: 1,
    spanCount: 2,
  },
  {
    key: '2-4-1',
    items: [],
    startItemIndex: 1,
    endItemIndex: 1,
    startMessageIndex: 2,
    endMessageIndex: 4,
    spanCount: 3,
  },
  {
    key: '5-5-1',
    items: [],
    startItemIndex: 2,
    endItemIndex: 2,
    startMessageIndex: 5,
    endMessageIndex: 5,
    spanCount: 1,
  },
];

describe('useChatWindowing helpers', () => {
  it('calculates average span height from measured chunks', () => {
    expect(calculateAverageSpanHeight(chunks, {})).toBe(96);
    expect(calculateAverageSpanHeight(chunks, { '0-1-1': 200, '2-4-1': 300 })).toBe(100);
  });

  it('builds chunk layouts using measured and estimated heights', () => {
    expect(buildChatRenderChunkLayouts(chunks, { '0-1-1': 180 }, 100).map(({ key, top, height, bottom }) => ({ key, top, height, bottom }))).toEqual([
      { key: '0-1-1', top: 0, height: 180, bottom: 180 },
      { key: '2-4-1', top: 180, height: 300, bottom: 480 },
      { key: '5-5-1', top: 480, height: 100, bottom: 580 },
    ]);
  });

  it('anchors visible range to the tail before viewport measurements exist', () => {
    const layouts = buildChatRenderChunkLayouts(chunks, {}, 100);
    const range = resolveVisibleChunkRange({ chunkLayouts: layouts, focusMessageIndex: null, overscanChunks: 1, viewport: null });

    expect(range?.chunks.map((chunk) => chunk.key)).toEqual(['2-4-1', '5-5-1']);
    expect(range?.topSpacerHeight).toBe(200);
    expect(range?.bottomSpacerHeight).toBe(0);
  });

  it('rejects fractional overscan chunks instead of letting slice truncate them', () => {
    const layouts = buildChatRenderChunkLayouts(chunks, {}, 100);
    const range = resolveVisibleChunkRange({ chunkLayouts: layouts, focusMessageIndex: null, overscanChunks: 0.5, viewport: null });

    expect(range?.chunks.map((chunk) => chunk.key)).toEqual(['5-5-1']);
  });

  it('rejects absurd overscan chunks instead of mounting the whole transcript', () => {
    const manyChunks: ChatRenderChunk[] = Array.from({ length: 20 }, (_, index) => ({
      key: `${index}-${index}-1`,
      items: [],
      startItemIndex: index,
      endItemIndex: index,
      startMessageIndex: index,
      endMessageIndex: index,
      spanCount: 1,
    }));
    const layouts = buildChatRenderChunkLayouts(manyChunks, {}, 100);
    const range = resolveVisibleChunkRange({ chunkLayouts: layouts, focusMessageIndex: null, overscanChunks: Number.MAX_SAFE_INTEGER, viewport: null });

    expect(range?.chunks.map((chunk) => chunk.key)).toEqual([
      '9-9-1',
      '10-10-1',
      '11-11-1',
      '12-12-1',
      '13-13-1',
      '14-14-1',
      '15-15-1',
      '16-16-1',
      '17-17-1',
      '18-18-1',
      '19-19-1',
    ]);
  });

  it('keeps a focused message mounted even outside the viewport', () => {
    const layouts = buildChatRenderChunkLayouts(chunks, {}, 100);
    const range = resolveVisibleChunkRange({ chunkLayouts: layouts, focusMessageIndex: 0, overscanChunks: 0, viewport: { scrollTop: 500, clientHeight: 40 } });

    expect(range?.chunks.map((chunk) => chunk.key)).toEqual(['0-1-1']);
  });

  it('anchors to the tail while pinned even when the last viewport measurement is stale', () => {
    const layouts = buildChatRenderChunkLayouts(chunks, {}, 100);
    const range = resolveVisibleChunkRange({
      chunkLayouts: layouts,
      focusMessageIndex: null,
      anchorToTail: true,
      overscanChunks: 0,
      viewport: { scrollTop: 0, clientHeight: 40 },
    });

    expect(range?.chunks.map((chunk) => chunk.key)).toEqual(['5-5-1']);
    expect(range?.bottomSpacerHeight).toBe(0);
  });
});
