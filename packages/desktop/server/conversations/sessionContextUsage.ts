import { readFileSync } from 'node:fs';

import {
  buildSessionContext,
  calculateContextTokens,
  estimateTokens,
  type FileEntry,
  getLatestCompactionEntry,
  migrateSessionEntries,
  parseSessionEntries,
  type SessionEntry,
} from '@mariozechner/pi-coding-agent';

export type ContextUsageSegmentKey = 'system' | 'user' | 'assistant' | 'tool' | 'summary' | 'other';

export interface ContextUsageSegment {
  key: ContextUsageSegmentKey;
  label: string;
  tokens: number;
}

export interface SessionContextUsageSnapshot {
  tokens: number | null;
  modelId?: string;
  segments?: ContextUsageSegment[];
}

type ContextMessage = ReturnType<typeof buildSessionContext>['messages'][number];
type ContextMessageList = ReturnType<typeof buildSessionContext>['messages'];
type SegmentWeights = Record<ContextUsageSegmentKey, number>;

const SEGMENT_LABELS: Record<ContextUsageSegmentKey, string> = {
  system: 'system',
  user: 'user',
  assistant: 'assistant',
  tool: 'tool',
  summary: 'summary',
  other: 'other',
};

const SEGMENT_ORDER: ContextUsageSegmentKey[] = ['system', 'user', 'assistant', 'tool', 'summary', 'other'];

function createEmptyWeights(): SegmentWeights {
  return {
    system: 0,
    user: 0,
    assistant: 0,
    tool: 0,
    summary: 0,
    other: 0,
  };
}

function addWeight(target: SegmentWeights, key: ContextUsageSegmentKey, value: number) {
  if (value <= 0) {
    return;
  }
  target[key] += value;
}

function measureRichContentWeight(content: unknown): number {
  if (typeof content === 'string') {
    return content.length;
  }

  if (!Array.isArray(content)) {
    return 0;
  }

  let weight = 0;
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }

    if ('type' in block && block.type === 'text' && typeof block.text === 'string') {
      weight += block.text.length;
      continue;
    }

    if ('type' in block && block.type === 'image') {
      weight += 4_800;
    }
  }

  return weight;
}

function estimateMessageWeights(message: ContextMessage): SegmentWeights {
  const weights = createEmptyWeights();

  switch (message.role) {
    case 'user': {
      addWeight(weights, 'user', measureRichContentWeight(message.content));
      return weights;
    }

    case 'assistant': {
      for (const block of message.content) {
        if (!block || typeof block !== 'object' || !('type' in block)) {
          continue;
        }

        if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
          addWeight(weights, 'assistant', block.text.length);
        } else if (block.type === 'thinking' && 'thinking' in block && typeof block.thinking === 'string') {
          addWeight(weights, 'assistant', block.thinking.length);
        } else if (block.type === 'toolCall') {
          const args = 'arguments' in block ? JSON.stringify(block.arguments ?? {}) : '{}';
          const name = 'name' in block && typeof block.name === 'string' ? block.name : 'tool';
          addWeight(weights, 'tool', name.length + args.length);
        }
      }
      return weights;
    }

    case 'toolResult': {
      addWeight(weights, 'tool', measureRichContentWeight(message.content));
      return weights;
    }

    case 'bashExecution': {
      addWeight(weights, 'tool', message.command.length + message.output.length);
      return weights;
    }

    case 'compactionSummary': {
      addWeight(weights, 'summary', message.summary.length);
      return weights;
    }

    case 'branchSummary': {
      addWeight(weights, 'summary', message.summary.length);
      return weights;
    }

    case 'custom': {
      addWeight(weights, 'other', measureRichContentWeight(message.content));
      return weights;
    }

    default: {
      addWeight(weights, 'other', estimateTokens(message));
      return weights;
    }
  }
}

function estimateContextWeights(messages: ContextMessageList): SegmentWeights {
  const weights = createEmptyWeights();

  for (const message of messages) {
    const messageWeights = estimateMessageWeights(message);
    for (const key of SEGMENT_ORDER) {
      weights[key] += messageWeights[key];
    }
  }

  return weights;
}

function scaleWeightsToSegments(weights: SegmentWeights, totalTokens: number): ContextUsageSegment[] {
  if (!Number.isSafeInteger(totalTokens) || totalTokens <= 0) {
    return [];
  }

  const weightedEntries = SEGMENT_ORDER.map((key) => ({ key, weight: weights[key] })).filter((entry) => entry.weight > 0);

  if (weightedEntries.length === 0) {
    return [];
  }

  const totalWeight = weightedEntries.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return [];
  }

  const scaled = weightedEntries.map((entry) => {
    const rawTokens = (entry.weight / totalWeight) * totalTokens;
    const baseTokens = Math.floor(rawTokens);
    return {
      key: entry.key,
      rawTokens,
      baseTokens,
      remainder: rawTokens - baseTokens,
    };
  });

  let assigned = scaled.reduce((sum, entry) => sum + entry.baseTokens, 0);
  const remaining = totalTokens - assigned;

  if (remaining > 0) {
    scaled
      .slice()
      .sort((left, right) => right.remainder - left.remainder)
      .slice(0, remaining)
      .forEach((entry) => {
        entry.baseTokens += 1;
        assigned += 1;
      });
  }

  if (assigned < totalTokens && scaled.length > 0) {
    scaled[0].baseTokens += totalTokens - assigned;
  }

  return scaled
    .filter((entry) => entry.baseTokens > 0)
    .map((entry) => ({
      key: entry.key,
      label: SEGMENT_LABELS[entry.key],
      tokens: entry.baseTokens,
    }));
}

export function estimateContextUsageSegments(messages: ContextMessageList, totalTokens: number): ContextUsageSegment[] {
  return scaleWeightsToSegments(estimateContextWeights(messages), totalTokens);
}

function isSessionEntry(entry: FileEntry): entry is SessionEntry {
  return entry.type !== 'session';
}

function getCurrentBranchEntries(entries: SessionEntry[]): SessionEntry[] {
  const leaf = entries[entries.length - 1];
  if (!leaf) {
    return [];
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;

  while (current) {
    branch.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return branch;
}

function hasPostCompactionUsage(branchEntries: SessionEntry[], compactionIndex: number): boolean {
  for (let index = branchEntries.length - 1; index > compactionIndex; index -= 1) {
    const entry = branchEntries[index];
    if (entry?.type !== 'message' || entry.message.role !== 'assistant') {
      continue;
    }

    const assistant = entry.message;
    if (assistant.stopReason === 'aborted' || assistant.stopReason === 'error' || !assistant.usage) {
      continue;
    }

    return calculateContextTokens(assistant.usage) > 0;
  }

  return false;
}

export function estimateSessionContextTokens(messages: ContextMessageList): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant' || !('usage' in message)) {
      continue;
    }

    const assistant = message;
    if (assistant.stopReason === 'aborted' || assistant.stopReason === 'error') {
      continue;
    }

    let trailingTokens = 0;
    for (let trailingIndex = index + 1; trailingIndex < messages.length; trailingIndex += 1) {
      trailingTokens += estimateTokens(messages[trailingIndex]);
    }

    return calculateContextTokens(assistant.usage) + trailingTokens;
  }

  let estimated = 0;
  for (const message of messages) {
    estimated += estimateTokens(message);
  }
  return estimated;
}

export function readSessionContextUsageFromEntries(entries: SessionEntry[]): SessionContextUsageSnapshot | null {
  if (entries.length === 0) {
    return null;
  }

  const context = buildSessionContext(entries);
  const branchEntries = getCurrentBranchEntries(entries);
  const latestCompaction = getLatestCompactionEntry(branchEntries);
  if (latestCompaction) {
    const compactionIndex = branchEntries.lastIndexOf(latestCompaction);
    if (compactionIndex >= 0 && !hasPostCompactionUsage(branchEntries, compactionIndex)) {
      return {
        tokens: null,
        modelId: context.model?.modelId,
      };
    }
  }

  const tokens = estimateSessionContextTokens(context.messages);
  if (!Number.isSafeInteger(tokens) || tokens < 0) {
    return {
      tokens: null,
      modelId: context.model?.modelId,
    };
  }

  return {
    tokens,
    modelId: context.model?.modelId,
    segments: estimateContextUsageSegments(context.messages, tokens),
  };
}

export function readSessionContextUsageFromFile(filePath: string): SessionContextUsageSnapshot | null {
  const fileEntries = parseSessionEntries(readFileSync(filePath, 'utf-8')) as FileEntry[];
  migrateSessionEntries(fileEntries);

  return readSessionContextUsageFromEntries(fileEntries.filter(isSessionEntry));
}
