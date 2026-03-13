import type { DisplayBlock, MessageBlock } from './types';

export function displayBlockToMessageBlock(block: DisplayBlock): MessageBlock {
  switch (block.type) {
    case 'user':
      return { type: 'user', id: block.id, text: block.text, images: block.images, ts: block.ts };
    case 'text':
      return { type: 'text', id: block.id, text: block.text, ts: block.ts };
    case 'thinking':
      return { type: 'thinking', id: block.id, text: block.text, ts: block.ts };
    case 'summary':
      return { type: 'summary', id: block.id, kind: block.kind, title: block.title, text: block.text, ts: block.ts };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        tool: block.tool,
        input: block.input,
        output: block.output,
        durationMs: block.durationMs,
        details: block.details,
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
        ts: block.ts,
      };
    case 'error':
      return { type: 'error', id: block.id, tool: block.tool, message: block.message, ts: block.ts };
  }
}
