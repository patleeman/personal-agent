import { describe, expect, it } from 'vitest';

import type { ChatRenderChunk } from './chatWindowing.js';
import { buildChatRenderChunkLayouts, calculateAverageSpanHeight, resolveVisibleChunkRange } from './useChatWindowing.js';

const chunks: ChatRenderChunk[] = [
  {
    key: 'chunk-0',
    items: [],
    startItemIndex: 0,
    endItemIndex: 0,
    startMessageIndex: 0,
    endMessageIndex: 1,
    spanCount: 2,
  },
  {
    key: 'chunk-2',
    items: [],
    startItemIndex: 1,
    endItemIndex: 1,
    startMessageIndex: 2,
    endMessageIndex: 4,
    spanCount: 3,
  },
  {
    key: 'chunk-5',
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
    expect(calculateAverageSpanHeight(chunks, { 'chunk-0': 200, 'chunk-2': 300 })).toBe(100);
  });

  it('builds chunk layouts using measured and estimated heights', () => {
    expect(
      buildChatRenderChunkLayouts(chunks, { 'chunk-0': 180 }, 100).map(({ key, top, height, bottom }) => ({ key, top, height, bottom })),
    ).toEqual([
      { key: 'chunk-0', top: 0, height: 180, bottom: 180 },
      { key: 'chunk-2', top: 180, height: 300, bottom: 480 },
      { key: 'chunk-5', top: 480, height: 100, bottom: 580 },
    ]);
  });

  it('anchors visible range to the tail before viewport measurements exist', () => {
    const layouts = buildChatRenderChunkLayouts(chunks, {}, 100);
    const range = resolveVisibleChunkRange({ chunkLayouts: layouts, focusMessageIndex: null, overscanChunks: 1, viewport: null });

    expect(range?.chunks.map((chunk) => chunk.key)).toEqual(['chunk-2', 'chunk-5']);
    expect(range?.topSpacerHeight).toBe(200);
    expect(range?.bottomSpacerHeight).toBe(0);
  });

  it('rejects fractional overscan chunks instead of letting slice truncate them', () => {
    const layouts = buildChatRenderChunkLayouts(chunks, {}, 100);
    const range = resolveVisibleChunkRange({ chunkLayouts: layouts, focusMessageIndex: null, overscanChunks: 0.5, viewport: null });

    expect(range?.chunks.map((chunk) => chunk.key)).toEqual(['chunk-5']);
  });

  it('rejects absurd overscan chunks instead of mounting the whole transcript', () => {
    const manyChunks: ChatRenderChunk[] = Array.from({ length: 20 }, (_, index) => ({
      key: `chunk-${index}`,
      items: [],
      startItemIndex: index,
      endItemIndex: index,
      startMessageIndex: index,
      endMessageIndex: index,
      spanCount: 1,
    }));
    const layouts = buildChatRenderChunkLayouts(manyChunks, {}, 100);
    const range = resolveVisibleChunkRange({
      chunkLayouts: layouts,
      focusMessageIndex: null,
      overscanChunks: Number.MAX_SAFE_INTEGER,
      viewport: null,
    });

    expect(range?.chunks.map((chunk) => chunk.key)).toEqual([
      'chunk-9',
      'chunk-10',
      'chunk-11',
      'chunk-12',
      'chunk-13',
      'chunk-14',
      'chunk-15',
      'chunk-16',
      'chunk-17',
      'chunk-18',
      'chunk-19',
    ]);
  });

  it('keeps a focused message mounted even outside the viewport', () => {
    const layouts = buildChatRenderChunkLayouts(chunks, {}, 100);
    const range = resolveVisibleChunkRange({
      chunkLayouts: layouts,
      focusMessageIndex: 0,
      overscanChunks: 0,
      viewport: { scrollTop: 500, clientHeight: 40 },
    });

    expect(range?.chunks.map((chunk) => chunk.key)).toEqual(['chunk-0']);
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

    expect(range?.chunks.map((chunk) => chunk.key)).toEqual(['chunk-5']);
    expect(range?.bottomSpacerHeight).toBe(0);
  });
});
