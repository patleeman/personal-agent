import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  readSessionBlockMock,
  readSessionImageAssetMock,
} = vi.hoisted(() => ({
  readSessionBlockMock: vi.fn(),
  readSessionImageAssetMock: vi.fn(),
}));

vi.mock('./sessions.js', () => ({
  readSessionBlock: readSessionBlockMock,
  readSessionImageAsset: readSessionImageAssetMock,
}));

import {
  inlineConversationBootstrapAssetsCapability,
  inlineConversationSessionBlockAssetsCapability,
  inlineConversationSessionBlocksAssetsCapability,
  inlineConversationSessionDetailAppendOnlyAssetsCapability,
  inlineConversationSessionDetailAssetsCapability,
  inlineConversationSessionSnapshotAssetsCapability,
  readConversationSessionBlockWithInlineAssetsCapability,
} from './conversationSessionAssetCapability.js';

beforeEach(() => {
  readSessionBlockMock.mockReset();
  readSessionImageAssetMock.mockReset();
});

describe('conversationSessionAssetCapability', () => {
  it('leaves non-image blocks unchanged', () => {
    const block = { id: 'block-1', type: 'text', text: 'hello', ts: '2026-04-10T12:00:00.000Z' };

    expect(inlineConversationSessionBlockAssetsCapability('conversation-1', block)).toEqual(block);
    expect(readSessionImageAssetMock).not.toHaveBeenCalled();
  });

  it('inlines user-image block assets as data urls', () => {
    readSessionImageAssetMock
      .mockReturnValueOnce({ mimeType: 'image/png', data: Buffer.from('first-image') })
      .mockReturnValueOnce({ mimeType: 'image/jpeg', data: Buffer.from('second-image') });

    const block = {
      id: 'user-block-1',
      type: 'user' as const,
      text: 'with images',
      ts: '2026-04-10T12:00:00.000Z',
      images: [
        { alt: 'First', src: '/api/sessions/conversation-1/blocks/user-block-1/images/0' },
        { alt: 'Second', src: '/api/sessions/conversation-1/blocks/user-block-1/images/1', mimeType: 'image/jpeg' },
      ],
    };

    expect(inlineConversationSessionBlockAssetsCapability('conversation-1', block)).toEqual({
      ...block,
      images: [
        { alt: 'First', src: 'data:image/png;base64,Zmlyc3QtaW1hZ2U=', mimeType: 'image/png' },
        { alt: 'Second', src: 'data:image/jpeg;base64,c2Vjb25kLWltYWdl', mimeType: 'image/jpeg' },
      ],
    });
    expect(readSessionImageAssetMock).toHaveBeenNthCalledWith(1, 'conversation-1', 'user-block-1', 0);
    expect(readSessionImageAssetMock).toHaveBeenNthCalledWith(2, 'conversation-1', 'user-block-1', 1);
  });

  it('uses the inlined session asset mime type over stale user-image metadata', () => {
    readSessionImageAssetMock.mockReturnValueOnce({ mimeType: 'image/png', data: Buffer.from('first-image') });

    const block = {
      id: 'user-block-1',
      type: 'user' as const,
      text: 'with images',
      ts: '2026-04-10T12:00:00.000Z',
      images: [{ alt: 'First', src: '/api/sessions/conversation-1/blocks/user-block-1/images/0', mimeType: 'text/plain' }],
    };

    expect(inlineConversationSessionBlockAssetsCapability('conversation-1', block)).toEqual({
      ...block,
      images: [{ alt: 'First', src: 'data:image/png;base64,Zmlyc3QtaW1hZ2U=', mimeType: 'image/png' }],
    });
  });

  it('inlines tool-result image blocks as data urls', () => {
    readSessionImageAssetMock.mockReturnValueOnce({ mimeType: 'image/png', data: Buffer.from('tool-image') });

    const block = {
      id: 'tool-block-1-i0',
      type: 'image' as const,
      alt: 'Tool image result',
      src: '/api/sessions/conversation-1/blocks/tool-block-1-i0/image',
      ts: '2026-04-10T12:00:00.000Z',
    };

    expect(inlineConversationSessionBlockAssetsCapability('conversation-1', block)).toEqual({
      ...block,
      src: 'data:image/png;base64,dG9vbC1pbWFnZQ==',
      mimeType: 'image/png',
    });
    expect(readSessionImageAssetMock).toHaveBeenCalledWith('conversation-1', 'tool-block-1-i0');
  });

  it('uses the inlined session asset mime type over stale image-block metadata', () => {
    readSessionImageAssetMock.mockReturnValueOnce({ mimeType: 'image/png', data: Buffer.from('tool-image') });

    const block = {
      id: 'tool-block-1-i0',
      type: 'image' as const,
      alt: 'Tool image result',
      src: '/api/sessions/conversation-1/blocks/tool-block-1-i0/image',
      mimeType: 'text/plain',
      ts: '2026-04-10T12:00:00.000Z',
    };

    expect(inlineConversationSessionBlockAssetsCapability('conversation-1', block)).toEqual({
      ...block,
      src: 'data:image/png;base64,dG9vbC1pbWFnZQ==',
      mimeType: 'image/png',
    });
  });

  it('leaves session-image blocks alone when they are already inlined', () => {
    const block = {
      id: 'tool-block-1-i0',
      type: 'image' as const,
      alt: 'Tool image result',
      src: 'data:image/png;base64,abcd',
      ts: '2026-04-10T12:00:00.000Z',
    };

    expect(inlineConversationSessionBlockAssetsCapability('conversation-1', block)).toEqual(block);
    expect(readSessionImageAssetMock).not.toHaveBeenCalled();
  });

  it('falls back to the original block when an image asset cannot be read', () => {
    readSessionImageAssetMock.mockReturnValueOnce(null);

    const block = {
      id: 'tool-block-1-i0',
      type: 'image' as const,
      alt: 'Tool image result',
      src: '/api/sessions/conversation-1/blocks/tool-block-1-i0/image',
      ts: '2026-04-10T12:00:00.000Z',
    };

    expect(inlineConversationSessionBlockAssetsCapability('conversation-1', block)).toEqual(block);
  });

  it('inlines assets across a session-detail block list', () => {
    readSessionImageAssetMock
      .mockReturnValueOnce({ mimeType: 'image/png', data: Buffer.from('first-image') })
      .mockReturnValueOnce({ mimeType: 'image/png', data: Buffer.from('tool-image') });

    const blocks = [
      {
        id: 'user-block-1',
        type: 'user' as const,
        text: 'with images',
        ts: '2026-04-10T12:00:00.000Z',
        images: [{ alt: 'First', src: '/api/sessions/conversation-1/blocks/user-block-1/images/0' }],
      },
      {
        id: 'tool-block-1-i0',
        type: 'image' as const,
        alt: 'Tool image result',
        src: '/api/sessions/conversation-1/blocks/tool-block-1-i0/image',
        ts: '2026-04-10T12:00:00.000Z',
      },
    ];

    expect(inlineConversationSessionBlocksAssetsCapability('conversation-1', blocks)).toEqual([
      {
        id: 'user-block-1',
        type: 'user',
        text: 'with images',
        ts: '2026-04-10T12:00:00.000Z',
        images: [{ alt: 'First', src: 'data:image/png;base64,Zmlyc3QtaW1hZ2U=', mimeType: 'image/png' }],
      },
      {
        id: 'tool-block-1-i0',
        type: 'image',
        alt: 'Tool image result',
        src: 'data:image/png;base64,dG9vbC1pbWFnZQ==',
        mimeType: 'image/png',
        ts: '2026-04-10T12:00:00.000Z',
      },
    ]);
  });

  it('inlines assets across session-detail, append-only, and bootstrap payloads', () => {
    readSessionImageAssetMock
      .mockReturnValueOnce({ mimeType: 'image/png', data: Buffer.from('detail-image') })
      .mockReturnValueOnce({ mimeType: 'image/png', data: Buffer.from('append-image') });

    const detail = inlineConversationSessionDetailAssetsCapability('conversation-1', {
      meta: { id: 'conversation-1' },
      blocks: [{
        id: 'user-block-1',
        type: 'user',
        text: 'detail image',
        ts: '2026-04-10T12:00:00.000Z',
        images: [{ alt: 'Detail', src: '/api/sessions/conversation-1/blocks/user-block-1/images/0' }],
      }],
      blockOffset: 0,
      totalBlocks: 1,
      contextUsage: null,
    } as never);
    const appendOnly = inlineConversationSessionDetailAppendOnlyAssetsCapability('conversation-1', {
      appendOnly: true,
      meta: { id: 'conversation-1' },
      blocks: [{
        id: 'tool-block-1-i0',
        type: 'image',
        alt: 'Append image',
        src: '/api/sessions/conversation-1/blocks/tool-block-1-i0/image',
        ts: '2026-04-10T12:00:00.000Z',
      }],
      blockOffset: 1,
      totalBlocks: 2,
      contextUsage: null,
      signature: 'sig-2',
    });
    const bootstrap = inlineConversationBootstrapAssetsCapability({
      conversationId: 'conversation-1',
      sessionDetail: detail,
      sessionDetailAppendOnly: appendOnly,
      liveSession: { live: false },
      sessionDetailSignature: 'sig-2',
    });

    expect(detail.blocks[0]).toEqual({
      id: 'user-block-1',
      type: 'user',
      text: 'detail image',
      ts: '2026-04-10T12:00:00.000Z',
      images: [{ alt: 'Detail', src: 'data:image/png;base64,ZGV0YWlsLWltYWdl', mimeType: 'image/png' }],
    });
    expect(appendOnly.blocks[0]).toEqual({
      id: 'tool-block-1-i0',
      type: 'image',
      alt: 'Append image',
      src: 'data:image/png;base64,YXBwZW5kLWltYWdl',
      mimeType: 'image/png',
      ts: '2026-04-10T12:00:00.000Z',
    });
    expect(bootstrap.sessionDetail?.blocks[0]).toEqual(detail.blocks[0]);
    expect(bootstrap.sessionDetailAppendOnly?.blocks[0]).toEqual(appendOnly.blocks[0]);
  });

  it('inlines assets in live-session snapshot events', () => {
    readSessionImageAssetMock.mockReturnValueOnce({ mimeType: 'image/png', data: Buffer.from('snapshot-image') });

    expect(inlineConversationSessionSnapshotAssetsCapability('conversation-1', {
      type: 'snapshot',
      blocks: [{
        id: 'tool-block-1-i0',
        type: 'image',
        alt: 'Snapshot image',
        src: '/api/sessions/conversation-1/blocks/tool-block-1-i0/image',
        ts: '2026-04-10T12:00:00.000Z',
      }],
      blockOffset: 0,
      totalBlocks: 1,
    })).toEqual({
      type: 'snapshot',
      blocks: [{
        id: 'tool-block-1-i0',
        type: 'image',
        alt: 'Snapshot image',
        src: 'data:image/png;base64,c25hcHNob3QtaW1hZ2U=',
        mimeType: 'image/png',
        ts: '2026-04-10T12:00:00.000Z',
      }],
      blockOffset: 0,
      totalBlocks: 1,
    });
  });

  it('reads session blocks and inlines their assets for local desktop hydration', () => {
    readSessionBlockMock.mockReturnValueOnce({
      id: 'user-block-1',
      type: 'user',
      text: 'with images',
      ts: '2026-04-10T12:00:00.000Z',
      images: [{ alt: 'First', src: '/api/sessions/conversation-1/blocks/user-block-1/images/0' }],
    });
    readSessionImageAssetMock.mockReturnValueOnce({ mimeType: 'image/png', data: Buffer.from('first-image') });

    expect(readConversationSessionBlockWithInlineAssetsCapability(' conversation-1 ', ' user-block-1 ')).toEqual({
      id: 'user-block-1',
      type: 'user',
      text: 'with images',
      ts: '2026-04-10T12:00:00.000Z',
      images: [{ alt: 'First', src: 'data:image/png;base64,Zmlyc3QtaW1hZ2U=', mimeType: 'image/png' }],
    });
    expect(readSessionBlockMock).toHaveBeenCalledWith('conversation-1', 'user-block-1');
  });

  it('returns null when the block id is blank or not found', () => {
    readSessionBlockMock.mockReturnValueOnce(null);

    expect(readConversationSessionBlockWithInlineAssetsCapability('conversation-1', '   ')).toBeNull();
    expect(readSessionBlockMock).not.toHaveBeenCalled();
    expect(readConversationSessionBlockWithInlineAssetsCapability('conversation-1', 'missing')).toBeNull();
    expect(readSessionBlockMock).toHaveBeenCalledWith('conversation-1', 'missing');
  });
});
