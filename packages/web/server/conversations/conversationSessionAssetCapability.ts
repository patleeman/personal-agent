import type { DisplayBlock } from './sessions.js';
import { readSessionBlock, readSessionImageAsset } from './sessions.js';

function toDataUrl(mimeType: string, data: Buffer): string {
  return `data:${mimeType};base64,${data.toString('base64')}`;
}

function inlineSessionUserBlockImages(sessionId: string, block: Extract<DisplayBlock, { type: 'user' }>): DisplayBlock {
  if (!block.id || !block.images?.length) {
    return block;
  }

  let changed = false;
  const images = block.images.map((image, imageIndex) => {
    if (!image.src) {
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
      mimeType: image.mimeType ?? asset.mimeType,
    };
  });

  return changed ? { ...block, images } : block;
}

function inlineSessionImageBlock(sessionId: string, block: Extract<DisplayBlock, { type: 'image' }>): DisplayBlock {
  if (!block.id || !block.src) {
    return block;
  }

  const asset = readSessionImageAsset(sessionId, block.id);
  if (!asset) {
    return block;
  }

  return {
    ...block,
    src: toDataUrl(asset.mimeType, asset.data),
    mimeType: block.mimeType ?? asset.mimeType,
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
