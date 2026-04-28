import type { DisplayBlock, MessageBlock } from '../shared/types';

export function normalizeHistoricalBlockId(blockId: string): string | null {
  const normalized = blockId.trim();
  return normalized.length > 0 ? normalized : null;
}

export function addHydratingHistoricalBlockId(current: string[], blockId: string): string[] {
  const normalized = normalizeHistoricalBlockId(blockId);
  if (!normalized || current.includes(normalized)) {
    return current;
  }

  return [...current, normalized];
}

export function removeHydratingHistoricalBlockId(current: string[], blockId: string): string[] {
  const normalized = normalizeHistoricalBlockId(blockId);
  if (!normalized) {
    return current;
  }

  return current.filter((candidate) => candidate !== normalized);
}

export function buildHydratingHistoricalBlockIdSet(blockIds: string[]): ReadonlySet<string> {
  return new Set(blockIds);
}

export function displayBlockToMessageBlock(block: DisplayBlock): MessageBlock {
  switch (block.type) {
    case 'user':
      return { type: 'user', id: block.id, text: block.text, images: block.images, ts: block.ts };
    case 'text':
      return { type: 'text', id: block.id, text: block.text, ts: block.ts };
    case 'context':
      return { type: 'context', id: block.id, text: block.text, customType: block.customType, ts: block.ts };
    case 'thinking':
      return { type: 'thinking', id: block.id, text: block.text, ts: block.ts };
    case 'summary':
      return { type: 'summary', id: block.id, kind: block.kind, title: block.title, text: block.text, detail: block.detail, ts: block.ts };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        tool: block.tool,
        input: block.input,
        output: block.output,
        durationMs: block.durationMs,
        details: block.details,
        outputDeferred: block.outputDeferred,
        ts: block.ts,
        _toolCallId: block.toolCallId,
      };
    case 'image':
      return {
        type: 'image',
        id: block.id,
        alt: block.alt,
        src: block.src,
        mimeType: block.mimeType,
        width: block.width,
        height: block.height,
        caption: block.caption,
        deferred: block.deferred,
        ts: block.ts,
      };
    case 'error':
      return { type: 'error', id: block.id, tool: block.tool, message: block.message, ts: block.ts };
  }
}

export function mergeHydratedHistoricalBlocks(
  blocks: DisplayBlock[],
  hydratedBlocks: Record<string, MessageBlock>,
): MessageBlock[] {
  return blocks.map((block) => hydratedBlocks[block.id] ?? displayBlockToMessageBlock(block));
}

export function mergeHydratedStreamBlocks(
  blocks: MessageBlock[],
  hydratedBlocks: Record<string, MessageBlock>,
): MessageBlock[] {
  return blocks.map((block) => {
    const normalizedId = block.id?.trim();
    return normalizedId ? (hydratedBlocks[normalizedId] ?? block) : block;
  });
}
