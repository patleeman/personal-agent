import type { MessageBlock } from '../shared/types';

type ToolBlock = Extract<MessageBlock, { type: 'tool_use' }>;

interface ToolAutoOpenPresentation {
  openRequested: boolean;
}

export interface ToolAutoOpenResult {
  targetId: string | null;
  processedBlockKeys: string[];
}

function getToolAutoOpenBlockKey(block: ToolBlock, index: number, keyPrefix: string): string {
  return block._toolCallId ?? block.id ?? `${keyPrefix}-${index}`;
}

function isCompletedToolBlock(block: ToolBlock): boolean {
  return block.status !== 'running' && !block.running;
}

function parseIsoTimestamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return Number.NaN;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : Number.NaN;
}

export function collectCompletedToolAutoOpenBlockKeys<TPresentation>(
  messages: MessageBlock[],
  readPresentation: (block: ToolBlock) => TPresentation | null,
  keyPrefix: string,
): Set<string> {
  const completedBlockKeys = new Set<string>();

  for (const [index, block] of messages.entries()) {
    if (block.type !== 'tool_use') {
      continue;
    }

    const presentation = readPresentation(block);
    if (presentation && isCompletedToolBlock(block)) {
      completedBlockKeys.add(getToolAutoOpenBlockKey(block, index, keyPrefix));
    }
  }

  return completedBlockKeys;
}

export function findRequestedToolPresentationToOpen<TPresentation extends ToolAutoOpenPresentation>({
  messages,
  processedBlockKeys,
  autoOpenStartedAt,
  readPresentation,
  getTargetId,
  keyPrefix,
}: {
  messages: MessageBlock[];
  processedBlockKeys: ReadonlySet<string>;
  autoOpenStartedAt: string;
  readPresentation: (block: ToolBlock) => TPresentation | null;
  getTargetId: (presentation: TPresentation) => string;
  keyPrefix: string;
}): ToolAutoOpenResult {
  const nextProcessedBlockKeys: string[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const block = messages[index];
    if (block?.type !== 'tool_use') {
      continue;
    }

    const presentation = readPresentation(block);
    if (!presentation || !presentation.openRequested || !isCompletedToolBlock(block)) {
      continue;
    }

    const blockKey = getToolAutoOpenBlockKey(block, index, keyPrefix);
    if (processedBlockKeys.has(blockKey)) {
      continue;
    }

    nextProcessedBlockKeys.push(blockKey);

    const toolCreatedAt = parseIsoTimestamp(block.ts);
    const startedAt = parseIsoTimestamp(autoOpenStartedAt);
    if (!Number.isFinite(toolCreatedAt) || !Number.isFinite(startedAt) || toolCreatedAt < startedAt) {
      continue;
    }

    return {
      targetId: getTargetId(presentation),
      processedBlockKeys: nextProcessedBlockKeys,
    };
  }

  return {
    targetId: null,
    processedBlockKeys: nextProcessedBlockKeys,
  };
}
