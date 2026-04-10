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
  inlineConversationSessionBlockAssetsCapability,
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
