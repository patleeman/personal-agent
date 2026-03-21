import type { MessageBlock } from '../../types';

export type TraceConversationBlock = Extract<MessageBlock, { type: 'thinking' | 'tool_use' | 'subagent' | 'error' }>;

export interface TraceClusterSummaryCategory {
  key: string;
  kind: 'thinking' | 'tool' | 'subagent' | 'error';
  label: string;
  count: number;
  tool?: string;
}

export interface TraceClusterSummary {
  stepCount: number;
  categories: TraceClusterSummaryCategory[];
  durationMs: number | null;
  hasError: boolean;
  hasRunning: boolean;
}

export type ChatRenderItem =
  | { type: 'message'; block: MessageBlock; index: number }
  | { type: 'trace_cluster'; blocks: TraceConversationBlock[]; startIndex: number; endIndex: number; summary: TraceClusterSummary };

function addSummaryCategory(
  categories: Map<string, TraceClusterSummaryCategory>,
  category: Omit<TraceClusterSummaryCategory, 'count'>,
) {
  const current = categories.get(category.key);
  if (current) {
    current.count += 1;
    return;
  }

  categories.set(category.key, { ...category, count: 1 });
}

export function isTraceConversationBlock(block: MessageBlock): block is TraceConversationBlock {
  switch (block.type) {
    case 'thinking':
    case 'subagent':
    case 'error':
      return true;
    case 'tool_use':
      return block.tool !== 'artifact' && block.tool !== 'ask_user_question';
    default:
      return false;
  }
}

export function summarizeTraceCluster(blocks: TraceConversationBlock[]): TraceClusterSummary {
  const categories = new Map<string, TraceClusterSummaryCategory>();
  let durationMs = 0;
  let hasDuration = false;
  let hasError = false;
  let hasRunning = false;

  for (const block of blocks) {
    switch (block.type) {
      case 'thinking':
        addSummaryCategory(categories, { key: 'thinking', kind: 'thinking', label: 'thinking' });
        break;
      case 'subagent':
        addSummaryCategory(categories, { key: 'subagent', kind: 'subagent', label: 'subagent' });
        if (block.status === 'running') {
          hasRunning = true;
        }
        if (block.status === 'failed') {
          hasError = true;
        }
        break;
      case 'error':
        addSummaryCategory(categories, { key: 'error', kind: 'error', label: 'error' });
        hasError = true;
        break;
      case 'tool_use':
        addSummaryCategory(categories, { key: `tool:${block.tool}`, kind: 'tool', label: block.tool, tool: block.tool });
        if (block.status === 'running' || block.running) {
          hasRunning = true;
        }
        if (block.status === 'error' || block.error) {
          hasError = true;
        }
        if (typeof block.durationMs === 'number' && Number.isFinite(block.durationMs) && block.durationMs > 0) {
          durationMs += block.durationMs;
          hasDuration = true;
        }
        break;
    }
  }

  return {
    stepCount: blocks.length,
    categories: [...categories.values()],
    durationMs: hasDuration ? durationMs : null,
    hasError,
    hasRunning,
  };
}

export function buildChatRenderItems(messages: MessageBlock[]): ChatRenderItem[] {
  const items: ChatRenderItem[] = [];
  let pendingTraceBlocks: TraceConversationBlock[] = [];
  let traceStartIndex = -1;

  function flushTraceBlocks() {
    if (pendingTraceBlocks.length === 0 || traceStartIndex < 0) {
      pendingTraceBlocks = [];
      traceStartIndex = -1;
      return;
    }

    items.push({
      type: 'trace_cluster',
      blocks: pendingTraceBlocks,
      startIndex: traceStartIndex,
      endIndex: traceStartIndex + pendingTraceBlocks.length - 1,
      summary: summarizeTraceCluster(pendingTraceBlocks),
    });
    pendingTraceBlocks = [];
    traceStartIndex = -1;
  }

  for (const [index, block] of messages.entries()) {
    if (isTraceConversationBlock(block)) {
      if (pendingTraceBlocks.length === 0) {
        traceStartIndex = index;
      }
      pendingTraceBlocks.push(block);
      continue;
    }

    flushTraceBlocks();
    items.push({ type: 'message', block, index });
  }

  flushTraceBlocks();
  return items;
}

export function getLatestUserMessage(messages: MessageBlock[]): Extract<MessageBlock, { type: 'user' }> | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === 'user') {
      return message;
    }
  }

  return null;
}
