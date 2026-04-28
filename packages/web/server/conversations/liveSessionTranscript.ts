import type { AgentSession } from '@mariozechner/pi-coding-agent';
import { buildDisplayBlocksFromEntries, type DisplayBlock } from './sessions.js';

export function buildLiveStateBlocks(session: AgentSession, options: { omitStreamMessage?: boolean } = {}): DisplayBlock[] {
  const state = session.state;
  const messages = state.messages.slice();
  const streamMessage = state.streamingMessage;

  if (streamMessage && !options.omitStreamMessage) {
    messages.push(streamMessage);
  }

  return buildDisplayBlocksFromEntries(messages.map((message, index) => ({
    id: `live-${index}`,
    timestamp: (message as { timestamp?: string | number }).timestamp ?? index,
    message: {
      role: (message as { role?: string }).role ?? 'unknown',
      content: (message as { content?: unknown }).content,
      toolCallId: (message as { toolCallId?: string }).toolCallId,
      toolName: (message as { toolName?: string }).toolName,
      details: (message as { details?: unknown }).details,
      stopReason: (message as { stopReason?: string }).stopReason,
      errorMessage: (message as { errorMessage?: string }).errorMessage,
      summary: (message as { summary?: string }).summary,
      tokensBefore: (message as { tokensBefore?: number }).tokensBefore,
      fromId: (message as { fromId?: string }).fromId,
      customType: (message as { customType?: string }).customType,
      display: (message as { display?: boolean }).display,
      command: (message as { command?: string }).command,
      output: (message as { output?: string }).output,
      exitCode: (message as { exitCode?: number }).exitCode,
      cancelled: (message as { cancelled?: boolean }).cancelled,
      truncated: (message as { truncated?: boolean }).truncated,
      fullOutputPath: (message as { fullOutputPath?: string }).fullOutputPath,
      excludeFromContext: (message as { excludeFromContext?: boolean }).excludeFromContext,
    },
  })));
}

export function resolveCompactionSummaryTitle(input: {
  mode: 'manual' | 'auto';
  reason?: 'overflow' | 'threshold' | null;
  willRetry?: boolean;
}): string {
  if (input.mode === 'manual') {
    return 'Manual compaction';
  }

  if (input.reason === 'overflow' || input.willRetry) {
    return 'Overflow recovery compaction';
  }

  return 'Proactive compaction';
}

export function applyLatestCompactionSummaryTitle(blocks: DisplayBlock[], title: string | null | undefined): DisplayBlock[] {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle) {
    return blocks;
  }

  let index = -1;
  for (let candidateIndex = blocks.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
    const candidate = blocks[candidateIndex];
    if (candidate?.type === 'summary' && candidate.kind === 'compaction') {
      index = candidateIndex;
      break;
    }
  }

  if (index < 0) {
    return blocks;
  }

  const block = blocks[index];
  if (block.type !== 'summary' || block.title === normalizedTitle) {
    return blocks;
  }

  const next = blocks.slice();
  next[index] = {
    ...block,
    title: normalizedTitle,
  };
  return next;
}

function fingerprintDisplayBlock(block: DisplayBlock): string {
  switch (block.type) {
    case 'user':
      return JSON.stringify({
        type: block.type,
        ts: block.ts,
        text: block.text,
        images: (block.images ?? []).map((image) => ({
          src: fingerprintImageSrc(image.src),
          mimeType: image.mimeType?.trim().toLowerCase() ?? null,
          caption: image.caption ?? null,
          alt: image.alt ?? null,
        })),
      });
    case 'text':
    case 'thinking':
      return JSON.stringify({ type: block.type, ts: block.ts, text: block.text });
    case 'context':
      return JSON.stringify({ type: block.type, ts: block.ts, text: block.text, customType: block.customType ?? null });
    case 'summary':
      return JSON.stringify({ type: block.type, ts: block.ts, kind: block.kind, title: block.title, text: block.text });
    case 'tool_use':
      return JSON.stringify({
        type: block.type,
        ts: block.ts,
        tool: block.tool,
        toolCallId: block.toolCallId,
        output: block.output,
      });
    case 'image':
      return JSON.stringify({
        type: block.type,
        ts: block.ts,
        alt: block.alt,
        mimeType: block.mimeType,
        caption: block.caption,
        src: fingerprintImageSrc(block.src),
      });
    case 'error':
      return JSON.stringify({
        type: block.type,
        ts: block.ts,
        tool: block.tool,
        message: block.message,
      });
  }
}

function fingerprintImageSrc(src: string | undefined): string | null {
  if (typeof src !== 'string') {
    return null;
  }
  return src;
}

function mergeIdentityKey(block: DisplayBlock): string | null {
  switch (block.type) {
    case 'tool_use':
      return block.toolCallId ? `tool:${block.toolCallId}` : null;
    case 'summary':
      return `summary:${block.kind}:${block.title}:${block.text}`;
    default:
      return null;
  }
}

function parseDisplayBlockTimestampMs(block: DisplayBlock): number | null {
  const ms = Date.parse(block.ts);
  return Number.isFinite(ms) ? ms : null;
}

function mergePersistedIdentityBlock(existing: DisplayBlock, liveBlock: DisplayBlock): DisplayBlock {
  if (existing.type !== liveBlock.type) {
    return liveBlock;
  }

  if (existing.type === 'summary' && liveBlock.type === 'summary') {
    return existing;
  }

  if (existing.type === 'tool_use' && liveBlock.type === 'tool_use') {
    const liveHasOutput = liveBlock.output.trim().length > 0;
    const existingHasOutput = existing.output.trim().length > 0;

    if (!liveHasOutput && existingHasOutput && liveBlock.durationMs === undefined && liveBlock.details === undefined) {
      return existing;
    }

    return {
      ...existing,
      ...liveBlock,
      output: liveHasOutput ? liveBlock.output : existing.output,
      durationMs: liveBlock.durationMs ?? existing.durationMs,
      details: liveBlock.details ?? existing.details,
      outputDeferred: liveBlock.outputDeferred ?? existing.outputDeferred,
    };
  }

  return liveBlock;
}

// Live session state only contains the currently-kept context window after compaction.
// Merge it with the persisted snapshot so reconnects/navigation preserve any durable-only blocks while
// still converging on the compacted view once summaries are present.
export function mergeConversationHistoryBlocks(persistedBlocks: DisplayBlock[], liveBlocks: DisplayBlock[]): DisplayBlock[] {
  if (persistedBlocks.length === 0) {
    return liveBlocks;
  }

  if (liveBlocks.length === 0) {
    return persistedBlocks;
  }

  const persistedFingerprints = persistedBlocks.map(fingerprintDisplayBlock);
  const liveFingerprints = liveBlocks.map(fingerprintDisplayBlock);
  const maxOverlap = Math.min(persistedFingerprints.length, liveFingerprints.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    let matches = true;

    for (let index = 0; index < overlap; index += 1) {
      if (persistedFingerprints[persistedFingerprints.length - overlap + index] !== liveFingerprints[index]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return [...persistedBlocks, ...liveBlocks.slice(overlap)];
    }
  }

  const merged = [...persistedBlocks];
  const seenFingerprints = new Set(persistedFingerprints);
  const mergedIndexByIdentity = new Map<string, number>();
  const latestPersistedTimestampMs = parseDisplayBlockTimestampMs(persistedBlocks[persistedBlocks.length - 1]);
  let lastMatchedLiveIndex = -1;

  for (const [index, block] of merged.entries()) {
    const identityKey = mergeIdentityKey(block);
    if (identityKey) {
      mergedIndexByIdentity.set(identityKey, index);
    }
  }

  for (const [liveIndex, liveBlock] of liveBlocks.entries()) {
    const identityKey = mergeIdentityKey(liveBlock);
    if (identityKey) {
      const existingIndex = mergedIndexByIdentity.get(identityKey);
      if (existingIndex !== undefined) {
        const mergedBlock = mergePersistedIdentityBlock(merged[existingIndex], liveBlock);
        merged[existingIndex] = mergedBlock;
        seenFingerprints.add(fingerprintDisplayBlock(mergedBlock));
        lastMatchedLiveIndex = liveIndex;
        continue;
      }
    }

    const fingerprint = fingerprintDisplayBlock(liveBlock);
    if (seenFingerprints.has(fingerprint)) {
      lastMatchedLiveIndex = liveIndex;
    }
  }

  const appendStartIndex = lastMatchedLiveIndex >= 0 ? lastMatchedLiveIndex + 1 : 0;

  for (let liveIndex = appendStartIndex; liveIndex < liveBlocks.length; liveIndex += 1) {
    const liveBlock = liveBlocks[liveIndex];
    const identityKey = mergeIdentityKey(liveBlock);
    if (identityKey) {
      const existingIndex = mergedIndexByIdentity.get(identityKey);
      if (existingIndex !== undefined) {
        const mergedBlock = mergePersistedIdentityBlock(merged[existingIndex], liveBlock);
        merged[existingIndex] = mergedBlock;
        seenFingerprints.add(fingerprintDisplayBlock(mergedBlock));
        continue;
      }
    }

    const fingerprint = fingerprintDisplayBlock(liveBlock);
    if (seenFingerprints.has(fingerprint)) {
      continue;
    }

    if (latestPersistedTimestampMs !== null) {
      const liveTimestampMs = parseDisplayBlockTimestampMs(liveBlock);
      if (liveTimestampMs !== null && liveTimestampMs < latestPersistedTimestampMs) {
        continue;
      }
    }

    merged.push(liveBlock);
    seenFingerprints.add(fingerprint);

    if (identityKey) {
      mergedIndexByIdentity.set(identityKey, merged.length - 1);
    }
  }

  return merged;
}
