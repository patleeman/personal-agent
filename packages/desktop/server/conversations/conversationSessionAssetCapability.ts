import type { ReadConversationBootstrapStateResult } from './conversationBootstrap.js';
import type { DisplayBlock, SessionDetail, SessionDetailAppendOnlyResponse } from './sessions.js';
import { readSessionBlock, readSessionImageAsset } from './sessions.js';

function toDataUrl(mimeType: string, data: Buffer): string {
  return `data:${mimeType};base64,${data.toString('base64')}`;
}

function shouldInlineSessionAssetSrc(src: string | undefined): boolean {
  return typeof src === 'string' && src.startsWith('/api/sessions/');
}

function inlineSessionUserBlockImages(sessionId: string, block: Extract<DisplayBlock, { type: 'user' }>): DisplayBlock {
  if (!block.id || !block.images?.length) {
    return block;
  }

  let changed = false;
  const images = block.images.map((image, imageIndex) => {
    if (!shouldInlineSessionAssetSrc(image.src)) {
      return image;
    }

    const asset = readSessionImageAsset(sessionId, block.id, imageIndex);
    if (!asset) {
      return image;
    }

    changed = true;
    return {
      ...image,
      src: toDataUrl(asset.mimeType, asset.data),
      mimeType: asset.mimeType,
    };
  });

  return changed ? { ...block, images } : block;
}

function inlineSessionImageBlock(sessionId: string, block: Extract<DisplayBlock, { type: 'image' }>): DisplayBlock {
  if (!block.id || !shouldInlineSessionAssetSrc(block.src)) {
    return block;
  }

  const asset = readSessionImageAsset(sessionId, block.id);
  if (!asset) {
    return block;
  }

  return {
    ...block,
    src: toDataUrl(asset.mimeType, asset.data),
    mimeType: asset.mimeType,
  };
}

export function inlineConversationSessionBlockAssetsCapability(sessionId: string, block: DisplayBlock): DisplayBlock {
  switch (block.type) {
    case 'user':
      return inlineSessionUserBlockImages(sessionId, block);
    case 'image':
      return inlineSessionImageBlock(sessionId, block);
    default:
      return block;
  }
}

export function inlineConversationSessionBlocksAssetsCapability(sessionId: string, blocks: DisplayBlock[]): DisplayBlock[] {
  let changed = false;
  const nextBlocks = blocks.map((block) => {
    const nextBlock = inlineConversationSessionBlockAssetsCapability(sessionId, block);
    if (nextBlock !== block) {
      changed = true;
    }
    return nextBlock;
  });

  return changed ? nextBlocks : blocks;
}

export function inlineConversationSessionDetailAssetsCapability(sessionId: string, detail: SessionDetail): SessionDetail {
  const blocks = inlineConversationSessionBlocksAssetsCapability(sessionId, detail.blocks);
  return blocks === detail.blocks ? detail : { ...detail, blocks };
}

export function inlineConversationSessionDetailAppendOnlyAssetsCapability(
  sessionId: string,
  detail: SessionDetailAppendOnlyResponse,
): SessionDetailAppendOnlyResponse {
  const blocks = inlineConversationSessionBlocksAssetsCapability(sessionId, detail.blocks);
  return blocks === detail.blocks ? detail : { ...detail, blocks };
}

export function inlineConversationBootstrapAssetsCapability(
  state: ReadConversationBootstrapStateResult['state'],
): ReadConversationBootstrapStateResult['state'] {
  const sessionId = state.conversationId.trim();
  if (!sessionId) {
    return state;
  }

  const sessionDetail = state.sessionDetail
    ? inlineConversationSessionDetailAssetsCapability(sessionId, state.sessionDetail)
    : state.sessionDetail;
  const sessionDetailAppendOnly = state.sessionDetailAppendOnly
    ? inlineConversationSessionDetailAppendOnlyAssetsCapability(sessionId, state.sessionDetailAppendOnly)
    : state.sessionDetailAppendOnly;

  return sessionDetail === state.sessionDetail && sessionDetailAppendOnly === state.sessionDetailAppendOnly
    ? state
    : {
        ...state,
        sessionDetail,
        sessionDetailAppendOnly,
      };
}

export function inlineConversationSessionSnapshotAssetsCapability<T extends {
  type: 'snapshot';
  blocks: DisplayBlock[];
}>(sessionId: string, event: T): T {
  const blocks = inlineConversationSessionBlocksAssetsCapability(sessionId, event.blocks);
  return blocks === event.blocks ? event : { ...event, blocks };
}

export function readConversationSessionBlockWithInlineAssetsCapability(sessionId: string, blockId: string): DisplayBlock | null {
  const normalizedSessionId = sessionId.trim();
  const normalizedBlockId = blockId.trim();
  if (!normalizedSessionId || !normalizedBlockId) {
    return null;
  }

  const block = readSessionBlock(normalizedSessionId, normalizedBlockId);
  if (!block) {
    return null;
  }

  return inlineConversationSessionBlockAssetsCapability(normalizedSessionId, block);
}
